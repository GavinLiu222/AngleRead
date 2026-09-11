import { getConfig, getSections, reportLanguageDirective } from './config.js';
import { pdfToImages } from './pdfProcessor.js';
import { callLLM, estimateAnalysisTokens } from './llmClient.js';

const CONCURRENCY = 3;

function buildPrompt(sections, { autoSuggest, language } = {}) {
  const active = sections.filter((s) => s.enabled);
  const lines = active.map((s, i) => `${i + 1}. "${s.id}" (${s.title}): ${s.prompt}`);
  const autoSuggestSpec = autoSuggest
    ? [
        '',
        'Additional self-proposed sections (important):',
        'Beyond the user-defined sections above, look at the paper and propose 2-4 further angles the reader is likely to care about but that the sections above do not cover (a pivotal technical detail, reproducibility, the relationship to a hot line of work, potential applications, ethical or safety considerations, and so on). Tailor them to this specific paper instead of reusing a fixed template. Put them in a JSON array under the key `ai_suggested`, where each element is an object with `"title"` (a short section title) and `"content"` (Markdown content, held to the same standards of depth, formulas, tables and page citations as the sections above). If there is genuinely nothing worth adding, set `ai_suggested` to an empty array `[]`.',
      ]
    : [];
  const baseRule1 =
    '1. Return one **valid JSON object**. Its top-level keys are the section ids quoted above. **Each section value must be a single string**; Markdown is allowed inside that string, so a list of points is written inside the same string using `- ` bullets or numbering. **Never write a section value as a JSON array or object** (`[{"point": ...}]` is wrong).';
  const firstFormatRule = autoSuggest
    ? baseRule1 +
      ' It may additionally contain the reserved key `ai_suggested` (see "Additional self-proposed sections" above), whose value is an array of objects; the `content` of each element must likewise be a single Markdown string.'
    : baseRule1;
  return [
    'You are a rigorous and experienced academic-paper reading assistant. Study the screenshots of every page of the following paper PDF carefully — including its figures, equations and tables — and produce a deep, well-grounded reading for each requested section.',
    '',
    'Sections to produce:',
    ...lines,
    ...autoSuggestSpec,
    '',
    'Output format and style:',
    firstFormatRule,
    '2. **Depth and logic**: develop each section according to the specific instructions attached to it — detailed, accurate and logically ordered. Prefer a "conclusion first, then the supporting argument" structure so causality and progression stay clear. Ground every judgement in concrete evidence from the paper (terminology, model names, dataset names, numbers, page references) and avoid filler. Stay strictly faithful to the paper: when it does not supply enough information, say so rather than speculating, and when you make an inference that goes beyond what the paper states, mark it explicitly as your own analysis. Let length follow information density — do not sacrifice substance for brevity.',
    '3. **Mathematics**: whenever a derivation, loss function or non-trivial expression is involved, give the LaTeX — inline `$...$`, display `$$...$$`. Note that backslashes in LaTeX commands must be **double-escaped** inside a JSON string (write `\\\\alpha`, not `\\alpha`), otherwise JSON parsing fails.',
    '4. **Tables**: use Markdown table syntax (`| col1 | col2 |\\n|---|---|\\n| ... |`) for structured information such as result comparisons, hyper-parameter lists and metric breakdowns.',
    '5. **Figures, diagrams and photos in the paper**: **never try to embed an image**. If a passage refers to a figure, describe it in 1-2 sentences and cite the page as `(see page N)` or `(see Figure X on page N)` so the reader can look it up.',
    '6. **Markdown elements**: bullets `- `, sub-headings `### `, bold `**...**` and inline code `` ` ` `` are all available to improve structure and readability.',
    '7. If the paper contains no information for a section, write `(not covered in the paper)`.',
    '8. Output nothing but the JSON, and do not wrap it in a ```code block```.',
    '',
    `9. **Language**: ${reportLanguageDirective(language)} This applies to every value in the JSON, including any \`ai_suggested\` titles and content. The JSON keys themselves always stay as the English section ids given above.`,
    '',
    'Now analyse the paper images below, which are ordered by page:',
  ].join('\n');
}

function parseJsonLoose(text) {
  if (!text) throw new Error('The model returned an empty response.');
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error('Could not parse the JSON returned by the model. Raw output: ' + text.slice(0, 300));
}

export async function analyzeOne(file, { onProgress } = {}) {
  const config = getConfig();
  const sections = getSections();
  onProgress?.({ stage: 'pdf-loading' });
  const { images, includedPages, pageCount } = await pdfToImages(file, {
    maxPages: config.maxPages,
    onPage: (i, total) => onProgress?.({ stage: 'pdf-rendering', page: i, total }),
  });
  const prompt = buildPrompt(sections, {
    autoSuggest: config.autoSuggestSections,
    language: config.reportLanguage,
  });
  const estimatedTokens = estimateAnalysisTokens(prompt, images.length);
  onProgress?.({ stage: 'llm-calling', includedPages, pageCount, estimatedTokens });
  if (config.contextLimit && estimatedTokens > config.contextLimit) {
    throw new Error(
      `Estimated input of ${estimatedTokens.toLocaleString()} tokens exceeds the configured context limit of ${config.contextLimit.toLocaleString()}. Raise the limit in Settings, or lower the max page count.`,
    );
  }
  const { text: responseText, usage } = await callLLM(config, prompt, images);
  const parsed = parseJsonLoose(responseText);
  return {
    sectionsUsed: sections.filter((s) => s.enabled),
    result: parsed,
    aiSuggested: config.autoSuggestSections ? normalizeAiSuggested(parsed.ai_suggested) : [],
    rawText: responseText,
    pageCount,
    includedPages,
    pageImages: images,
    estimatedTokens,
    usage,
  };
}

function normalizeAiSuggested(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim() : '',
      // Keep the raw value (string / array / object); valueToMarkdown normalises it at render time.
      content: item.content,
    }))
    .filter((item) => item.title)
    .slice(0, 6);
}

export async function analyzeAll(files, handlers = {}) {
  const { onItemStart, onItemDone, onItemError, onProgressItem } = handlers;
  const queue = files.map((file, index) => ({ file, index }));
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const { file, index } = queue[cursor++];
      onItemStart?.(index, file);
      try {
        const result = await analyzeOne(file, {
          onProgress: (info) => onProgressItem?.(index, info),
        });
        onItemDone?.(index, result);
      } catch (err) {
        onItemError?.(index, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);
}

import { getConfig, getSections, reportLanguageDirective } from './config.js';
import { prepareCached } from './docProcessor.js';
import { callLLM, estimateAnalysisTokens } from './llmClient.js';

const CONCURRENCY = 3;

/** 通用并发池（analyzeAll 与 suggestAll 共用） */
export async function runPool(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/** 模型偶尔会加代码围栏或前后缀，逐层退让地解析 JSON（suggester 也在用） */
export function parseJsonLoose(text) {
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

function buildPrompt(sections, { autoSuggest, language, hasImages, docType } = {}) {
  const lines = sections.map((s, i) => `${i + 1}. "${s.id}" (${s.title}): ${s.prompt}`);
  const autoSuggestSpec = autoSuggest
    ? [
        '',
        'Additional self-proposed sections (important):',
        'Beyond the sections requested above, look at the document and propose 2-4 further angles the reader is likely to care about but that the sections above do not cover (a pivotal technical or financial detail, reproducibility, the relationship to a hot line of work or a live market debate, potential applications, ethical, regulatory or safety considerations, and so on). Tailor them to this specific document instead of reusing a fixed template. Put them in a JSON array under the key `ai_suggested`, where each element is an object with `"title"` (a short section title) and `"content"` (Markdown content, held to the same standards of depth, formulas, tables and source citations as the sections above). If there is genuinely nothing worth adding, set `ai_suggested` to an empty array `[]`.',
      ]
    : [];
  const baseRule1 =
    '1. Return one **valid JSON object**. Its top-level keys are the section ids quoted above. **Each section value must be a single string**; Markdown is allowed inside that string, so a list of points is written inside the same string using `- ` bullets or numbering. **Never write a section value as a JSON array or object** (`[{"point": ...}]` is wrong).';
  const firstFormatRule = autoSuggest
    ? baseRule1 +
      ' It may additionally contain the reserved key `ai_suggested` (see "Additional self-proposed sections" above), whose value is an array of objects; the `content` of each element must likewise be a single Markdown string.'
    : baseRule1;
  const intro = hasImages
    ? 'You are a rigorous, experienced reading assistant for dense professional documents — academic papers, sell-side analyst research, quantitative trading strategy reports, long-form journalism, technical whitepapers and corporate filings. Study the screenshots of every page of the document below carefully — including its figures, equations, charts and tables — and produce a deep, well-grounded reading for each requested section.'
    : 'You are a rigorous, experienced reading assistant for dense professional documents — academic papers, sell-side analyst research, quantitative trading strategy reports, long-form journalism, technical whitepapers and corporate filings. Study the full text of the document below carefully — including its tables, figures captions and numbers — and produce a deep, well-grounded reading for each requested section.';
  const figureRule = hasImages
    ? '5. **Figures, diagrams and photos in the document**: **never try to embed an image**. If a passage refers to a figure, describe it in 1-2 sentences and cite the page as `(see page N)` or `(see Figure X on page N)` so the reader can look it up.'
    : '5. **Figures and tables referred to in the text**: **never try to embed an image**. Describe what the referenced exhibit shows in 1-2 sentences and cite where it sits (section heading, table number) so the reader can look it up.';
  const closing = hasImages
    ? 'Now analyse the document images below, which are ordered by page:'
    : 'Now analyse the document text below:';
  return [
    intro,
    ...(docType ? ['', `The document has been identified as: ${docType}. Read it the way a specialist in that genre would.`] : []),
    '',
    'Sections to produce:',
    ...lines,
    ...autoSuggestSpec,
    '',
    'Output format and style:',
    firstFormatRule,
    '2. **Depth and logic**: develop each section according to the specific instructions attached to it — detailed, accurate and logically ordered. Prefer a "conclusion first, then the supporting argument" structure so causality and progression stay clear. Ground every judgement in concrete evidence from the document (terminology, names, dataset or ticker names, numbers, page or section references) and avoid filler. Stay strictly faithful to the document: when it does not supply enough information, say so rather than speculating, and when you make an inference that goes beyond what the document states, mark it explicitly as your own analysis. Let length follow information density — do not sacrifice substance for brevity.',
    '3. **Mathematics**: whenever a derivation, loss function, valuation formula or non-trivial expression is involved, give the LaTeX — inline `$...$`, display `$$...$$`. Note that backslashes in LaTeX commands must be **double-escaped** inside a JSON string (write `\\\\alpha`, not `\\alpha`), otherwise JSON parsing fails.',
    '4. **Tables**: use Markdown table syntax (`| col1 | col2 |\\n|---|---|\\n| ... |`) for structured information such as result comparisons, forecast and valuation breakdowns, hyper-parameter lists and metric breakdowns.',
    figureRule,
    '6. **Markdown elements**: bullets `- `, sub-headings `### `, bold `**...**` and inline code `` ` ` `` are all available to improve structure and readability.',
    '7. If the document contains no information for a section, write `(not covered in the document)`.',
    '8. Output nothing but the JSON, and do not wrap it in a ```code block```.',
    '',
    `9. **Language**: ${reportLanguageDirective(language)} This applies to every value in the JSON, including any \`ai_suggested\` titles and content. The JSON keys themselves always stay as the English section ids given above.`,
    '',
    closing,
  ].join('\n');
}

/** 用户在 Reading plan 里勾选的建议角度 → 额外的分析维度（id 加前缀，避免和标准维度撞车） */
function normalizeFocusSections(focusSections, baseSections) {
  const taken = new Set(baseSections.map((s) => s.id));
  const out = [];
  for (const s of focusSections || []) {
    if (!s?.title || !s?.prompt) continue;
    let id = 'focus_' + String(s.id || s.title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!id || id === 'focus_') id = 'focus_' + out.length;
    while (taken.has(id)) id += '_x';
    taken.add(id);
    out.push({ id, title: s.title, prompt: s.prompt, enabled: true, ai: true });
  }
  return out;
}

export async function analyzeOne(file, { focusSections = [], docType = '', onProgress } = {}) {
  const config = getConfig();
  const baseSections = getSections().filter((s) => s.enabled);
  const sectionsUsed = [...baseSections, ...normalizeFocusSections(focusSections, baseSections)];
  if (!sectionsUsed.length) {
    throw new Error('No analysis section is enabled. Pick at least one in the Reading plan view.');
  }
  onProgress?.({ stage: 'doc-loading' });
  const prepared = await prepareCached(file, {
    maxPages: config.maxPages,
    onProgress,
  });
  const hasImages = prepared.parts.some((p) => p.type === 'image');
  const prompt = buildPrompt(sectionsUsed, {
    autoSuggest: config.autoSuggestSections,
    language: config.reportLanguage,
    hasImages,
    docType,
  });
  const estimatedTokens = estimateAnalysisTokens(prompt, prepared.parts);
  onProgress?.({
    stage: 'llm-calling',
    kind: prepared.kind,
    includedPages: prepared.includedPages,
    pageCount: prepared.pageCount,
    textChars: prepared.textChars,
    estimatedTokens,
  });
  if (config.contextLimit && estimatedTokens > config.contextLimit) {
    throw new Error(
      `Estimated input of ${estimatedTokens.toLocaleString()} tokens exceeds the configured context limit of ${config.contextLimit.toLocaleString()}. Raise the limit in Model & API, or lower the max page count.`,
    );
  }
  const { text: responseText, usage } = await callLLM(config, prompt, prepared.parts);
  const parsed = parseJsonLoose(responseText);
  return {
    sectionsUsed,
    result: parsed,
    aiSuggested: config.autoSuggestSections ? normalizeAiSuggested(parsed.ai_suggested) : [],
    rawText: responseText,
    kind: prepared.kind,
    pageCount: prepared.pageCount,
    includedPages: prepared.includedPages,
    textChars: prepared.textChars,
    docParts: prepared.parts,
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
  const { onItemStart, onItemDone, onItemError, onProgressItem, focusFor } = handlers;
  await runPool(files, CONCURRENCY, async (file, index) => {
    onItemStart?.(index, file);
    try {
      const result = await analyzeOne(file, {
        ...(focusFor?.(index) || {}),
        onProgress: (info) => onProgressItem?.(index, info),
      });
      onItemDone?.(index, result);
    } catch (err) {
      onItemError?.(index, err);
    }
  });
}

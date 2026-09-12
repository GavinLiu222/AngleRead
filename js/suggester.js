/* 建议阅读角度：上传后先让模型读一遍（默认只读抽样），猜用户想从这份文档里
   学到什么、这份文档有哪些真正值得了解的方面，返回候选角度供用户勾选。 */

import { getConfig, getSections, reportLanguageDirective } from './config.js';
import { prepareCached, sampleParts } from './docProcessor.js';
import { callLLM, estimateAnalysisTokens } from './llmClient.js';
import { parseJsonLoose, runPool } from './analyzer.js';

const CONCURRENCY = 3;
const MAX_SUGGESTIONS = 8;

const GENRE_HINTS = [
  '- Academic paper: the pivotal design choice and why it works, the assumption the result really hinges on, how the evaluation could flatter the method, what a reader could reuse elsewhere.',
  '- Sell-side / analyst research report: the valuation method and the assumptions that drive the target price, where the analyst departs from consensus and why, catalysts and their timing, sensitivity of the forecast to the key drivers, the bear case and what would break the thesis.',
  '- Quantitative trading strategy report: how the signal is actually constructed, the data and the universe it was built on, the backtest protocol and its look-ahead / overfitting exposure, turnover, capacity and transaction-cost assumptions, regime dependence and drawdown behaviour, what it would take to reproduce or falsify the result.',
  '- Long-form journalism or investigation: the timeline and the parties involved, the quality and independence of the sourcing, which claims are actually evidenced versus asserted, the incentives of everyone quoted, and what is still unresolved.',
  '- Technical whitepaper or documentation: the architecture and its failure modes, the operational constraints, what is deliberately left unspecified.',
  '- Filing, earnings material or corporate disclosure: the numbers that moved and why, the accounting or definitional choices behind them, guidance versus delivery, the risk language that changed since last time.',
];

function buildSuggestPrompt({ language, existingSections, hasImages, sampleNote, filename }) {
  const covered = existingSections.length
    ? existingSections.map((s) => `- ${s.title}`).join('\n')
    : '- (the reader has no sections configured yet)';
  const source = hasImages
    ? 'The document is given below as page screenshots, ordered by page.'
    : 'The document is given below as plain text.';
  return [
    'You are an expert reading coach. Your job right now is NOT to summarise the document. It is to work out **what this particular reader would most want to get out of it**, and what is genuinely worth learning from it, so they can pick the angles they care about before a deep analysis is run.',
    '',
    `Source file: ${filename}`,
    source,
    ...(sampleNote ? [sampleNote + ' Judge the document as a whole from that sample, and say so if the sample leaves you uncertain.'] : []),
    '',
    'Work in three steps:',
    '',
    '**Step 1 — identify the genre.** Decide what kind of document this is: academic paper, sell-side / analyst research report, quantitative trading strategy report, long-form journalism or investigation, technical whitepaper or documentation, filing / earnings material, or something else. Base it on concrete evidence (structure, disclaimers, tables, citation style, vocabulary), not on the file name alone.',
    '',
    '**Step 2 — infer what the reader wants.** From the document itself — its title, its structure, where it spends its pages, which numbers it emphasises, who it was written for — infer what a reader who opened this document is most likely trying to learn. Pay particular attention to what is non-obvious here: the parts that carry the most information, the parts a hurried reader would skim past, and the parts where this document differs from others of its genre.',
    '',
    `**Step 3 — propose reading angles.** Give between 4 and ${MAX_SUGGESTIONS} candidate angles, ordered by how much value they give this reader. They must be specific to THIS document — mention its actual subject, method, ticker, dataset, market or claim. Generic angles that could be pasted onto any document of the same genre are worthless here; do not produce them.`,
    '',
    'Genre-specific angles worth considering (adapt them, do not copy them blindly):',
    ...GENRE_HINTS,
    '',
    'The reader already has these sections configured, and they will be produced anyway — **do not propose anything that duplicates them**:',
    covered,
    '',
    'Output format:',
    'Return one **valid JSON object** and nothing else — no prose around it, no ```code block```:',
    '{',
    '  "doc_type": "a short genre label, e.g. Sell-side equity research report",',
    '  "doc_summary": "one sentence on what this document actually is and what it covers",',
    '  "suggestions": [',
    '    {',
    '      "id": "lowercase_ascii_slug",',
    '      "title": "a section title of at most 6 words",',
    '      "why": "one sentence: what the reader gets out of this angle, and why it matters for this specific document",',
    '      "prompt": "a detailed instruction for the model that will later write this section"',
    '    }',
    '  ]',
    '}',
    '',
    'Requirements on each `prompt` field (this is the important one):',
    '1. Write it as an instruction addressed to the analysing model, in the same register as a well-written analysis brief: one opening sentence stating what to produce, then 3-5 numbered, concrete requirements.',
    '2. Say what evidence to ground it in — specific numbers, formulas, table rows, quotes, dates, page references from this document.',
    '3. Where the angle involves mathematics or a valuation / backtest formula, require LaTeX (inline `$...$`, display `$$...$$`); where it involves a comparison, require a Markdown table.',
    '4. Require the model to separate what the document states from inference it adds itself, and to say plainly when the document does not contain enough information.',
    '5. Keep each prompt self-contained — it will be sent without the rest of this conversation.',
    '',
    `**Language**: ${reportLanguageDirective(language)} This applies to \`doc_type\`, \`doc_summary\`, \`title\`, \`why\` and \`prompt\`. The \`id\` field always stays a lowercase ASCII slug.`,
    '',
    'Now read the document below:',
  ].join('\n');
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function normalizeSuggestions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!title || !prompt) return;
    let id = slugify(item.id || title, `angle_${i + 1}`);
    while (seen.has(id)) id += '_x';
    seen.add(id);
    out.push({
      id,
      title,
      why: typeof item.why === 'string' ? item.why.trim() : '',
      prompt,
    });
  });
  return out.slice(0, MAX_SUGGESTIONS);
}

/**
 * 为单份文档生成候选阅读角度。
 * @returns {Promise<{docType:string, docSummary:string, sampled:boolean, items:Array, usage:object|null}>}
 */
export async function suggestForDocument(file, { full = false, onProgress } = {}) {
  const config = getConfig();
  onProgress?.({ stage: 'doc-loading' });
  const prepared = await prepareCached(file, { maxPages: config.maxPages, onProgress });
  const { parts, sampled, note } = sampleParts(prepared.parts, { full });
  const hasImages = parts.some((p) => p.type === 'image');
  const prompt = buildSuggestPrompt({
    language: config.reportLanguage,
    existingSections: getSections().filter((s) => s.enabled),
    hasImages,
    sampleNote: note,
    filename: file.name,
  });
  const estimatedTokens = estimateAnalysisTokens(prompt, parts);
  onProgress?.({ stage: 'llm-calling', estimatedTokens, sampled });
  if (config.contextLimit && estimatedTokens > config.contextLimit) {
    throw new Error(
      `Estimated input of ${estimatedTokens.toLocaleString()} tokens exceeds the configured context limit of ${config.contextLimit.toLocaleString()}. Turn off "use the full document", lower the max page count, or raise the limit in Model & API.`,
    );
  }
  const { text, usage } = await callLLM(config, prompt, parts);
  const parsed = parseJsonLoose(text);
  const items = normalizeSuggestions(parsed.suggestions);
  if (!items.length) {
    throw new Error('The model returned no usable suggestions. Raw output: ' + String(text).slice(0, 200));
  }
  return {
    docType: typeof parsed.doc_type === 'string' ? parsed.doc_type.trim() : '',
    docSummary: typeof parsed.doc_summary === 'string' ? parsed.doc_summary.trim() : '',
    sampled,
    items,
    usage: usage || null,
  };
}

export async function suggestAll(files, handlers = {}) {
  const { onItemStart, onItemDone, onItemError, onProgressItem, full } = handlers;
  await runPool(files, CONCURRENCY, async (file, index) => {
    onItemStart?.(index, file);
    try {
      const payload = await suggestForDocument(file, {
        full,
        onProgress: (info) => onProgressItem?.(index, info),
      });
      onItemDone?.(index, payload);
    } catch (err) {
      onItemError?.(index, err);
    }
  });
}

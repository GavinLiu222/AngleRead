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
/* 模型输出的 JSON 有两种常见的坏法，都不是「模型不听话」而是格式本身容易踩的坑：
   1. 字符串里写 LaTeX —— `$\Delta$` / `$\text{IC}$` 里的反斜杠不是合法的 JSON 转义，
      `\t` 甚至会被悄悄解释成制表符。我们要求模型用 LaTeX 写公式，这几乎必然发生。
   2. 输出被 max_tokens 截断 —— 半个字符串、没闭合的数组。
   下面这个修复器按字符扫一遍：补转义、补闭合，能救回多少是多少。 */
function repairJsonText(raw) {
  let out = '';
  let inString = false;
  let inMath = false; // 字符串里的 $...$：这段里的反斜杠一律当 LaTeX
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '$') {
        inMath = !inMath;
        out += ch;
        continue;
      }
      if (ch === '\\') {
        const next = raw[i + 1];
        if (next === undefined) {
          out += '\\\\';
          continue;
        }
        // 这三个在数学环境里也仍是转义
        if (next === '"' || next === '\\' || next === '/') {
          out += ch + next;
          i++;
          continue;
        }
        // \text \times \beta \frac \nabla \rho —— 常用 LaTeX 命令的首字母恰好都是
        // 合法转义符，直接放过会被解释成制表符 / 换行 / 退格，所以数学环境里一律当字面反斜杠
        if (inMath) {
          out += '\\\\';
          continue;
        }
        if ('bfnrt'.includes(next)) {
          out += ch + next;
          i++;
          continue;
        }
        if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
          out += raw.slice(i, i + 6);
          i += 5;
          continue;
        }
        out += '\\\\'; // 落单的反斜杠：LaTeX 命令、Windows 路径……
        continue;
      }
      if (ch === '"') {
        inString = false;
        inMath = false;
        out += ch;
        continue;
      }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (ch < ' ') continue; // 其余控制字符直接丢掉
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      out += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) stack.pop();
      out += ch;
      continue;
    }
    out += ch;
  }
  if (inString) {
    out += '"';                      // 截断在字符串中间
    // 截断点落在键名里时补出来的是 `…,"prompt"`——有键没冒号，整个对象都会解析失败，
    // 把这半个键去掉，前面已经写完的字段就能留下
    out = out.replace(/,\s*"(?:[^"\\]|\\.)*"\s*$/, '');
  }
  out = out.replace(/,\s*$/, '');    // 悬空逗号
  if (/:\s*$/.test(out)) out += 'null'; // 有键没值
  while (stack.length) out += stack.pop(); // 补齐没闭合的 } ]
  return out;
}

/* 更阴险的一种坏法：LaTeX 命令的首字母恰好是合法的 JSON 转义符——
   `\text` `\times` `\tau` 会被解析成制表符，`\nabla` `\neq` 成换行，`\beta` `\bar` 成退格，
   `\frac` `\forall` 成换页，`\rho` `\right` 成回车。这种 JSON **能解析成功**，
   只是内容被悄悄毁掉，所以必须在 JSON.parse 之前先补一道反斜杠。 */
const LATEX_CMD_AFTER_ESCAPE =
  /\\(textbf|textit|text|times|tau|theta|tilde|tfrac|nabla|neq|beta|bar|binom|begin|boldsymbol|bmatrix|frac|forall|rho|rightarrow|right|rangle)(?![a-zA-Z])/g;

/* 只在 `$...$` / `$$...$$` 里动手。散文里 "…\ntop 10 holdings" 的 `\n` 是真换行，
   不是 `\top`——限定在数学环境内可以避开这类误伤（我们的 prompt 也要求公式写在 $ 里）。
   行内公式还要求「里面至少有一个 \命令」且不太长，免得把 "$42 vs $38" 这种货币区间当成公式。 */
const MATH_SPAN = /\$\$[\s\S]{1,800}?\$\$|\$[^$\n]{0,200}?\\[a-zA-Z][^$\n]{0,200}?\$/g;

function fixLatexEscapes(text) {
  const s = String(text);
  return s.replace(MATH_SPAN, (span, spanOffset) =>
    span.replace(LATEX_CMD_AFTER_ESCAPE, (match, name, innerOffset) => {
      // 前面若已有奇数个反斜杠，说明这根反斜杠本身就是转义出来的，别再动它
      let slashes = 0;
      for (let i = spanOffset + innerOffset - 1; i >= 0 && s[i] === '\\'; i--) slashes++;
      return slashes % 2 === 1 ? match : '\\\\' + name;
    }),
  );
}

/** 看起来像被 max_tokens 截断：开了 { 却没有以 } / ] 收尾 */
function looksTruncated(text) {
  const t = String(text).trim();
  return t.includes('{') && !/[}\]]\s*$/.test(t);
}

/* 推理模型常把思考过程包在 <think> 里一起吐出来 */
const THINK_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi;

/* 只有「非空对象」才算真解析出了东西：散文里的孤立 `{` 被宽松修复器啃一遍，
   也可能侥幸变成 `{}` 或一个数组，那种结果比解析失败更难排查 */
function usableObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

/** 一段回复里所有「可能是那个 JSON」的切片，按可信度从高到低 */
function jsonCandidates(text) {
  const out = [];
  const push = (chunk) => {
    const t = String(chunk || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(text);
  push(text.replace(THINK_BLOCK, ''));
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) push(fenced[1]);
  // 被截断时收尾的 ``` 也没了，围栏之后的全部内容同样是候选
  const openFence = text.match(/```(?:json)?\s*([\s\S]*)$/i);
  if (openFence) push(openFence[1]);

  // 模型常常先写一段「让我先通读一遍这份文档……」再给 JSON。那段散文里但凡出现一个
  // `{`（LaTeX 的 `\frac{}`、代码片段……），只认「第一个 {」就会把真正的 JSON 挡在外面。
  // `{` 后面紧跟 `"` 是对象开头最可靠的信号，每个这样的位置都试一遍。
  const lastBrace = text.lastIndexOf('}');
  const starts = [];
  const re = /\{\s*"/g;
  let m;
  while ((m = re.exec(text)) !== null && starts.length < 12) starts.push(m.index);
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1 && !starts.includes(firstBrace)) starts.push(firstBrace); // 兜底放最后
  for (const start of starts) {
    if (lastBrace > start) push(text.slice(start, lastBrace + 1));
    push(text.slice(start));
  }
  return out;
}

/**
 * @param {string} text 模型回复原文
 * @param {object} [options]
 * @param {boolean} [options.hitOutputLimit] 服务商是否明说这次回复被 max_tokens 截断
 * @param {boolean} [options.reasoningOnly] 正文是空的，手上这段其实是思考链
 */
export function parseJsonLoose(text, { hitOutputLimit = false, reasoningOnly = false } = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) throw new Error('The model returned an empty response.');
  const candidates = jsonCandidates(raw);
  // 先修 LaTeX 转义再解析：那种 JSON 本身合法，直接解析只会拿到被毁掉的内容
  const passes = [
    (c) => JSON.parse(fixLatexEscapes(c)),
    (c) => JSON.parse(c),
    (c) => JSON.parse(repairJsonText(fixLatexEscapes(c))),
  ];
  let fallback; // 解析成功但空洞的结果：全都没戏时才拿它顶上
  // 外层必须是候选、内层才是解析方式：候选已按可信度排好，而「整段回复修一修能读」
  // 永远优于「里面某个子对象恰好能严格解析」。反过来写的话，一份写到一半被截断的
  // 回复会被它内部某条 suggestion 抢先解析成功，最外层的 doc_type / suggestions 全丢。
  for (const candidate of candidates) {
    for (const parse of passes) {
      let value;
      try {
        value = parse(candidate);
      } catch {
        continue;
      }
      if (usableObject(value)) return value;
      if (fallback === undefined) fallback = value;
    }
  }
  if (fallback !== undefined) return fallback;

  const shown = raw.length > 400 ? raw.slice(0, 240) + ' […] ' + raw.slice(-120) : raw;
  const startedJson = /\{\s*"/.test(raw);
  // looksTruncated 只看「有 { 却没收尾」，散文里的 $\frac{a}{b}$ 也会中招，
  // 所以启发式判断仅在确实开了 JSON 的头时才作数；服务商明说截断了则一律采信
  const cut =
    hitOutputLimit || (startedJson && looksTruncated(raw))
      ? ' The answer hit the output limit — raise “Max output tokens” in Model & API, or ask for fewer sections.'
      : '';
  if (!startedJson) {
    const lead = reasoningOnly
      ? 'The model sent back only its chain of thought and never wrote an answer — the whole output budget went into thinking.'
      : 'The model narrated its reasoning instead of returning JSON.';
    const advice =
      cut ||
      (reasoningOnly
        ? ' Raise “Max output tokens” in Model & API so it has room to answer after thinking, or pick a non-reasoning model.'
        : ' Ask for fewer sections, or try a model that supports JSON output mode.');
    throw new Error(lead + advice + ' Raw output: ' + shown);
  }
  throw new Error('Could not parse the JSON returned by the model.' + cut + ' Raw output: ' + shown);
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
    '8. **Output nothing but the JSON.** The very first character of your reply must be `{` and the last must be `}`. Do not wrap it in a ```code block```, and do not write any preamble — no restatement of the task, no plan, no "let me read the document first", no commentary after the JSON. Do all of your thinking silently; a reply that opens with prose is discarded in full.',
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
  const { text: responseText, usage, truncated, reasoningOnly } = await callLLM(config, prompt, prepared.parts, {
    json: true,
  });
  const parsed = parseJsonLoose(responseText, { hitOutputLimit: truncated, reasoningOnly });
  return {
    sectionsUsed,
    result: parsed,
    aiSuggested: config.autoSuggestSections ? normalizeAiSuggested(parsed.ai_suggested) : [],
    rawText: responseText,
    truncated: Boolean(truncated),
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

/* 建议阅读角度：上传后先让模型读一遍（默认只读抽样），猜用户想从这份文档里
   学到什么、这份文档有哪些真正值得了解的方面，返回候选角度供用户勾选。 */

import { getConfig, getSections, reportLanguageDirective } from './config.js';
import { prepareCached, sampleParts } from './docProcessor.js';
import { callLLM, estimateAnalysisTokens } from './llmClient.js';
import { parseJsonLoose, runPool } from './analyzer.js';

const CONCURRENCY = 3;

/* 题材会越来越杂，所以这里不靠"给每类文档写死一张清单"，而是让模型自己推：
   这类东西是给谁看的、为什么有人读它、读完要拿去干什么，再由这个动机反推读者必须知道哪些事。
   下面四类只是这套推理在最常见题材上的样板——遇到没列出的题材，照样子现推一份。
   问题可以是套路的，答案不许套路。 */

const GENRES = [
  {
    key: 'A',
    label: 'Sell-side / analyst research report',
    tells:
      'a rating and a target price, earnings forecast tables, a named analyst with a licence number, compliance disclaimers, company or sector coverage language',
    motive:
      'to decide whether to act on an investment recommendation — to follow it, fade it, or ignore it — and to borrow the analyst’s homework on a company they cannot cover themselves.',
    questions: [
      'How the target price is actually derived: the valuation method (DCF, comparable multiples, SOTP), the multiple or discount rate chosen and why, and whether that method suits this company.',
      'The two or three assumptions the entire conclusion rests on, and how far the target price moves if each one is wrong.',
      'The earnings forecast itself, line by line: what revenue growth and margin path is assumed, on what drivers, and how that compares with the last few reported periods.',
      'Where the analyst departs from market consensus, by how much, and what they claim to see that the market does not.',
      'Catalysts and their timing: which specific events are supposed to close the gap to the target price, and when.',
      'The bear case: what the report concedes could go wrong, what it declines to discuss, and what evidence would falsify the thesis.',
      'Which claims rest on the analyst’s own work (channel checks, field research, proprietary data, management access) versus restated company guidance.',
    ],
  },
  {
    key: 'B',
    label: 'Quantitative trading strategy report',
    tells:
      'factor construction, backtest equity curves, IC / IR / Sharpe / drawdown tables, a defined stock universe, rebalance rules, turnover and transaction-cost discussion',
    motive:
      'to learn a strategy well enough to judge whether it really works and, very often, to rebuild it — so the reader is reading like an engineer who will have to implement it and like a sceptic who expects the backtest to flatter it.',
    questions: [
      'The economic logic of the edge: what behavioural, structural or risk-premium mechanism is supposed to make this signal pay, and whether the report argues it or merely asserts it.',
      'The raw data: which datasets and vendors, which market and universe, what period and frequency, how the sample was filtered, and any point-in-time, survivorship, restatement or coverage problem.',
      'How the factor is constructed, step by step and in formulas: the raw variable, the lookback window, winsorisation, standardisation, industry / size / style neutralisation, and how multiple factors are combined into one score.',
      'The pipeline end to end: universe screening → signal computation → ranking or weighting → portfolio construction and constraints → rebalance frequency → execution and cost model.',
      'Performance with the actual numbers: annualised and excess return against the stated benchmark, IC and ICIR, Sharpe, maximum drawdown, win rate, turnover — and how these break down year by year, across market regimes, and long-only versus long-short.',
      'How much the backtest can be trusted: in-sample versus out-of-sample split, look-ahead and survivorship exposure, how many parameters were tuned over how many trials, whether cost and slippage assumptions are realistic, and capacity at the stated turnover.',
      'What reproducing or deploying this would take: the data and infrastructure required, and where live results would most likely diverge from the backtest.',
    ],
  },
  {
    key: 'C',
    label: 'Long-form news report or investigation',
    tells:
      'narrative reporting, named and anonymous sources, quotes, a byline and dateline, obtained documents or records, an absence of formal methodology',
    motive:
      'to find out what actually happened and how much of it is established rather than alleged — usually because the reader has to form a view on the people, the company or the market involved.',
    questions: [
      'The timeline: what happened in what order, with dates, and who the parties are and how they relate to each other.',
      'The central claim, stated plainly, and the evidence actually offered for it: documents, records, data, on-the-record witnesses — as opposed to what is asserted or implied.',
      'Sourcing quality: who is on the record, who is anonymous and on what grounds, what the reporters saw or obtained directly, and which key claims rest on a single source.',
      'The money and the numbers: amounts, counterparties, ownership, who gains and who is out of pocket.',
      'Everyone’s incentives, sources and publication included: who benefits from the story reading this way, and how the accused respond.',
      'What the piece does not establish: the denials, the gaps, the questions it raises and leaves open.',
      'What follows from it: market, regulatory, legal or competitive consequences, and who is exposed to them.',
    ],
  },
  {
    key: 'D',
    label: 'Academic finance or economics paper',
    tells:
      'an abstract, numbered sections, a literature review, hypotheses, regression tables with standard errors and significance stars, formal citations',
    motive:
      'to find out whether a finding actually holds up and whether anything can be done with it — the reader is deciding whether to trust it, cite it, or build on it.',
    questions: [
      'The research question and hypothesis in plain terms, why it was still open, and what the paper claims to settle.',
      'Data and sample: market, period, source, construction filters, how many observations survive them, and any survivorship or coverage bias that introduces.',
      'Identification and method: the actual specification in formulas, what variation identifies the effect, and how endogeneity, confounding or selection is handled.',
      'The main results with the numbers, and their economic significance rather than just their t-statistics: how large the effect is in return, basis-point or dollar terms.',
      'Robustness and researcher degrees of freedom: subsample and alternative specifications, multiple-testing or data-snooping exposure, and whether the result survives transaction costs.',
      'How it sits against the existing literature: which prior findings it confirms, contradicts or reinterprets.',
      'Whether it is actually actionable — what implementing it would require, and what stands between the paper’s result and a live strategy or a policy decision.',
    ],
  },
];

function genreBlock(g) {
  return [
    `**${g.key}. ${g.label}** — recognise it by: ${g.tells}.`,
    `   *Why anyone reads one:* ${g.motive}`,
    '   *So the reader wants to know:*',
  ]
    .concat(g.questions.map((q, i) => `   ${i + 1}. ${q}`))
    .join('\n');
}

function buildSuggestPrompt({ language, existingSections, hasImages, sampleNote, filename, retry }) {
  const covered = existingSections.length
    ? existingSections.map((s) => `- ${s.title}`).join('\n')
    : '- (the reader has no sections configured yet)';
  const source = hasImages
    ? 'The document is given below as page screenshots, ordered by page.'
    : 'The document is given below as plain text.';
  return [
    'You are helping someone decide what to read for in a document they have just uploaded. Your job right now is NOT to summarise it. It is to work out what a person opens a document like this **for**, and which of those things this particular document can actually deliver, so the reader can tick the angles they care about before a deep analysis is run.',
    '',
    `Source file: ${filename}`,
    source,
    ...(sampleNote ? [sampleNote + ' Judge the document as a whole from that sample, and say so if the sample leaves you uncertain.'] : []),
    '',
    'Work in four steps.',
    '',
    '**Step 1 — name the genre.** Say what kind of document this is, judged on evidence inside it — structure, tables, disclaimers, vocabulary, citation style, who it addresses — and never on the file name. These four turn up most often, and each is followed by why people read it and what that makes them want to know:',
    '',
    ...GENRES.map(genreBlock).flatMap((block) => [block, '']),
    'If the document is none of these, **do not force it into one of them**. Name the genre in your own words — earnings call transcript, regulatory filing, technical whitepaper, industry survey, policy paper, prospectus, patent, product documentation, textbook chapter, whatever it honestly is — and carry on to Step 2, which is where the real work happens for a genre nobody listed.',
    '',
    '**Step 2 — work out why anyone reads this genre.** Before hunting for angles, answer this plainly, in one or two sentences: what does a person open a document of this kind *for*, and what are they going to do once they have finished it — decide something, build something, defend a position, brief someone else, avoid a mistake? Who are they: a practitioner, an investor, a researcher, an operator? That motive is the thing every angle has to serve. For the four genres above the motive is already stated; for anything else, reason it out from first principles: who reads this, what task waits on the other side of the reading, what they could not act without, and what they would be embarrassed to have missed.',
    '',
    '**Step 3 — turn that motive into the questions it demands.** For the four genres above, start from the questions listed with them: reorder them by what this document is really about, and drop the ones it has no material for. For any other genre, write the equivalent list yourself, derived from the motive you just stated — not from a general idea of what is interesting.',
    'Whatever the genre, a reader who has been served well comes away with five things. Use them as a coverage test on your list, not as an outline:',
    '  (a) **The claim** — what this document asserts, recommends, reports or offers, stated without hedging.',
    '  (b) **The machinery** — how it got there, in enough detail to judge it or rebuild it: the method, the model, the data, the formula, the sourcing, the chain of reasoning.',
    '  (c) **The evidence** — how well it works and how strongly it is supported, in the document’s own numbers.',
    '  (d) **The weak points** — the assumptions it stands on, what it leaves out, what would make it wrong.',
    '  (e) **The use** — what the reader can now do, decide or build, and what still stands in the way.',
    'If your list leaves one of those five with nothing against it, either the document genuinely has no material there — which is fine, say nothing — or you have missed a question the reader wanted. Do not, however, produce five angles named after (a) to (e); they are a check, not a template.',
    '',
    '**Step 4 — instantiate the questions on THIS document.** Take the questions in the order you settled on and turn each into a reading angle, rewritten around this document’s own content: name the factor, the dataset, the ticker, the company, the model, the market, the date range, the metric. A reader should be able to tell from the title alone which document it belongs to. If the document holds nothing substantive on a question, skip it — an angle that would come back empty is worse than no angle. After the list, add further angles for anything this document devotes real space to that the reasoning above missed: an unusual method, an extended case study, a dataset nobody else has.',
    '**How many angles to give is your decision — there is no target number and no ceiling.** Let the document set it: as many as it genuinely supports, and no more. A dense report that rewards a dozen separate questions should get a dozen; a one-page note that honestly holds two good angles should get two. Never pad the list with weak entries to look thorough, and never drop a question the reader would want just to keep the list short. Order them by how much they serve the motive from Step 2.',
    '',
    '**The questions are meant to be predictable; the answers are not.** The core questions of a genre are what readers of it almost always want, so never skip one because it feels obvious or unoriginal. What must never be generic is the content: every `title`, `why` and `prompt` has to be written against this document specifically. If an angle’s `prompt` could be sent unchanged with a different document of the same genre attached, it is wrong; rewrite it until it could not.',
    '',
    'The reader already has these sections configured, and they will be produced anyway:',
    covered,
    'Those titles are broad and written mainly with academic papers in mind. Do not propose an angle that would simply produce one of them again at the same level of detail. Do propose one whenever a question goes materially deeper or narrower than the configured section would — a section called “Method” does not cover a step-by-step reconstruction of how one factor is built, and “Key findings” does not cover a year-by-year performance and drawdown breakdown — and when you do, write the `prompt` so that the extra depth is unmistakable.',
    '',
    'Output format:',
    'Return one **valid JSON object** and nothing else — no prose around it, no ```code block```:',
    '{',
    '  "doc_type": "the genre from Step 1 as a short label, and nothing else",',
    '  "reader_goal": "one sentence: why someone reads a document of this kind and what they do next — the motive you settled on in Step 2",',
    '  "doc_summary": "one or two sentences: what this document is, what it covers, and the evidence behind your genre call",',
    '  "suggestions": [',
    '    {',
    '      "id": "lowercase_ascii_slug",',
    '      "title": "a section title of at most 6 words, naming something from this document",',
    '      "why": "one sentence: what the reader gets out of this angle, and why it matters for this specific document",',
    '      "prompt": "a detailed instruction for the model that will later write this section"',
    '    }',
    '  ]',
    '}',
    '',
    'Write plain JSON — no comments, no trailing commas. The `suggestions` array holds however many angles you decided on.',
    '',
    'Requirements on each `prompt` field (this is the important one):',
    '1. Write it as an instruction addressed to the analysing model, in the same register as a well-written analysis brief: one opening sentence stating what to produce, then 3-5 numbered, concrete requirements.',
    '2. Say what evidence to ground it in — specific numbers, formulas, table rows, quotes, dates, page references from this document. Where the document reports results in a table, require the analysis to reproduce the relevant rows rather than describe them in prose.',
    '3. Where the angle involves mathematics or a valuation / factor / backtest formula, require LaTeX (inline `$...$`, display `$$...$$`); where it involves a comparison, require a Markdown table.',
    '4. Require the model to separate what the document states from inference it adds itself, and to say plainly when the document does not contain enough information.',
    '5. Keep each prompt self-contained — it will be sent without the rest of this conversation.',
    '',
    `**Language**: ${reportLanguageDirective(language)} This applies to \`doc_type\`, \`reader_goal\`, \`doc_summary\`, \`title\`, \`why\` and \`prompt\`. The \`id\` field always stays a lowercase ASCII slug.`,
    '',
    ...(retry
      ? [
          '**This is a second attempt.** Your previous answer came back with no usable angles at all — the `suggestions` array was empty or missing, or every entry lacked a title. Return the same JSON object again with that array properly filled: every entry needs a `title`, and a `prompt` wherever you can write one. However thin this document is, there is something in it worth reading for — its numbers, its framing, its assumptions, its conclusions, what it conspicuously leaves out. Decide the count yourself, but do not come back empty again.',
          '',
        ]
      : []),
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

function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/* 输出被截断时，最后一条角度常常只写到 title / why 就没了；偶尔模型也会把键名写成
   instruction / name。整条丢掉的代价太大——标题还在就用它现编一条指令顶上。 */
function fallbackPrompt(title, why) {
  return [
    `Produce a section titled “${title}” for this document.`,
    why ? `What the reader should get out of it: ${why}` : '',
    'Ground every claim in specific evidence from the document — numbers, formulas, table rows, dates and page references. Use LaTeX (inline `$...$`, display `$$...$$`) for any mathematics and a Markdown table for any comparison. Separate what the document states from inference you add yourself, and say plainly where the document does not contain enough information.',
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeSuggestions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const title = pickString(item.title, item.name, item.section_title);
    if (!title) return;
    const why = pickString(item.why, item.reason);
    const prompt = pickString(item.prompt, item.instruction, item.section_prompt);
    let id = slugify(item.id || title, `angle_${i + 1}`);
    while (seen.has(id)) id += '_x';
    seen.add(id);
    out.push({
      id,
      title,
      why,
      prompt: prompt || fallbackPrompt(title, why),
    });
  });
  return out;
}

/** 解析成功却一条角度都没留下时，说清楚是哪一环没对上，别让用户对着一句空话猜 */
function diagnoseEmptySuggestions(parsed) {
  const raw = parsed?.suggestions;
  if (raw === undefined) return 'The reply carried no `suggestions` key at all.';
  if (!Array.isArray(raw)) return `\`suggestions\` came back as ${typeof raw}, not an array.`;
  if (!raw.length) return 'The `suggestions` array was empty.';
  return `None of the ${raw.length} entries under \`suggestions\` had a usable title.`;
}

function sumUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const add = (x, y) => (x == null && y == null ? null : (x || 0) + (y || 0));
  return { input: add(a.input, b.input), output: add(a.output, b.output), total: add(a.total, b.total) };
}

/* doc_type / reader_goal / doc_summary 取第一次的，缺了才用补问那次的 */
function pickField(primary, fallback, key) {
  const take = (o) => (o && typeof o[key] === 'string' ? o[key].trim() : '');
  return take(primary) || take(fallback);
}

/**
 * 为单份文档生成候选阅读角度。
 * @returns {Promise<{docType:string, readerGoal:string, docSummary:string, sampled:boolean, items:Array, usage:object|null}>}
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
  const ask = async (retry) => {
    const body = retry
      ? buildSuggestPrompt({
          language: config.reportLanguage,
          existingSections: getSections().filter((s) => s.enabled),
          hasImages,
          sampleNote: note,
          filename: file.name,
          retry: true,
        })
      : prompt;
    const { text, usage, truncated, reasoningOnly } = await callLLM(config, body, parts, { json: true });
    const parsed = parseJsonLoose(text, { hitOutputLimit: truncated, reasoningOnly });
    return { parsed, items: normalizeSuggestions(parsed.suggestions), text, usage, truncated };
  };

  const first = await ask(false);
  let { parsed, items, text, truncated } = first;
  let usage = first.usage;

  // 给几条由模型自己定，不足不补；只有一条可用的都没有才重问一次
  if (!items.length) {
    onProgress?.({ stage: 'llm-retrying' });
    const second = await ask(true);
    usage = sumUsage(usage, second.usage);
    if (second.items.length) {
      items = second.items;
      parsed = {
        doc_type: pickField(parsed, second.parsed, 'doc_type'),
        reader_goal: pickField(parsed, second.parsed, 'reader_goal'),
        doc_summary: pickField(parsed, second.parsed, 'doc_summary'),
      };
    } else {
      ({ parsed, text, truncated } = second);
    }
  }

  if (!items.length) {
    const cut = truncated
      ? ' The reply was cut off at the output limit before the angles were written — raise “Max output tokens” in Model & API.'
      : '';
    throw new Error(
      'The model returned no usable reading angles, twice. ' +
        diagnoseEmptySuggestions(parsed) +
        cut +
        ' Raw output: ' +
        String(text).slice(0, 600),
    );
  }
  return {
    docType: pickField(parsed, null, 'doc_type'),
    readerGoal: pickField(parsed, null, 'reader_goal'),
    docSummary: pickField(parsed, null, 'doc_summary'),
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

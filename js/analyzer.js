import { getConfig, getSections } from './config.js';
import { pdfToImages } from './pdfProcessor.js';
import { callLLM, estimateAnalysisTokens } from './llmClient.js';

const CONCURRENCY = 3;

function buildPrompt(sections, { autoSuggest } = {}) {
  const active = sections.filter((s) => s.enabled);
  const lines = active.map(
    (s, i) => `${i + 1}. "${s.id}"（${s.title}）：${s.prompt}`,
  );
  const autoSuggestSpec = autoSuggest
    ? [
        '',
        '额外推测维度（重要）：',
        '在上述用户指定维度之外，请你结合论文内容，主动推测 2-4 个用户很可能想深入了解、但上面维度尚未覆盖的分析角度（例如某个关键技术细节、可复现性、与某热点工作的关系、潜在应用场景、伦理/安全考量等，请因论文而异，不要套用固定模板）。将它们放入 JSON 中名为 `ai_suggested` 的数组：数组每个元素是一个对象，含 `"title"`（简洁的中文维度标题）与 `"content"`（Markdown 内容，遵循与上述维度相同的深度、公式、表格、页码注明等要求）。若确实没有合适的额外维度，则令 `ai_suggested` 为空数组 `[]`。',
      ]
    : [];
  const baseRule1 =
    '1. 整体返回一个**合法的 JSON 对象**，顶层键为各维度对应的英文 id（上面引号内）。**每个维度的值必须是单个字符串**，值内允许使用 Markdown：即使内容是要点列表，也要写在同一个字符串里用 Markdown 的 `- ` 项目符号或编号呈现，**绝对不要把维度的值写成 JSON 数组或对象**（如 `[{"point": ...}]` 是错误的）。';
  const firstFormatRule = autoSuggest
    ? baseRule1 +
      '此外可包含保留键 `ai_suggested`（见上方「额外推测维度」说明），其值为对象数组，数组每个元素的 `content` 同样必须是单个 Markdown 字符串。'
    : baseRule1;
  return [
    '你是一位严谨且经验丰富的学术论文阅读助手。请仔细查看以下论文 PDF 每一页的截图（包括其中的图表、公式与表格），针对各维度给出有深度、有依据的解读。',
    '',
    '需要输出的分析维度：',
    ...lines,
    ...autoSuggestSpec,
    '',
    '输出格式与风格要求：',
    firstFormatRule,
    '2. **内容深度与逻辑**：每个维度按各自提示中的具体要求充分展开，做到详细、准确、有逻辑。优先采用「先结论、后展开论证」的结构，让因果与递进关系清晰；多用论文中的具体证据（术语、模型名、数据集名、数值、页码）支撑每个判断，避免空话套话。务必严格基于论文内容作答：当论文未提供足够信息时如实说明，不要臆测或编造；当你做出超出论文明述的推断时，请明确标注这是你的分析判断。长度按信息量自适应，不要为了简短而牺牲信息密度。',
    '3. **数学公式**：当涉及数学推导/损失函数/复杂表达式时务必给出 LaTeX 公式——行内 `$...$`，独立 `$$...$$`。注意：LaTeX 命令中的反斜杠在 JSON 字符串里必须**双重转义**（写成 `\\\\alpha` 而非 `\\alpha`），否则 JSON 解析会失败。',
    '4. **表格**：当涉及数据对比、超参数列表、实验指标对照等结构化信息时，使用 Markdown 表格语法（`| 列1 | 列2 |\\n|---|---|\\n| ... |`）。',
    '5. **论文中的图/示意图/流程图/照片**：**不要尝试嵌入图片**。若某段解读涉及论文中的图，请用 1-2 句简要描述图的内容，并以 `（详见原文第 N 页）` 或 `（见原文第 N 页 Figure X）` 的形式注明页码，让读者自行查阅。',
    '6. **Markdown 元素**：可使用项目符号 `- `、子标题 `### `、加粗 `**...**`、行内代码 `` ` ` ``，以提升结构与可读性。',
    '7. 若某维度在论文中没有相关信息，写 `（论文未提及）`。',
    '8. 不要输出 JSON 以外的任何文字，不要把 JSON 包在 ```代码块``` 中。',
    '',
    '现在请基于下面按页码顺序排列的论文图片开始分析：',
  ].join('\n');
}

function parseJsonLoose(text) {
  if (!text) throw new Error('模型返回为空');
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
  throw new Error('无法解析模型返回的 JSON，原文：' + text.slice(0, 300));
}

export async function analyzeOne(file, { onProgress } = {}) {
  const config = getConfig();
  const sections = getSections();
  onProgress?.({ stage: 'pdf-loading' });
  const { images, includedPages, pageCount } = await pdfToImages(file, {
    maxPages: config.maxPages,
    onPage: (i, total) => onProgress?.({ stage: 'pdf-rendering', page: i, total }),
  });
  const prompt = buildPrompt(sections, { autoSuggest: config.autoSuggestSections });
  const estimatedTokens = estimateAnalysisTokens(prompt, images.length);
  onProgress?.({ stage: 'llm-calling', includedPages, pageCount, estimatedTokens });
  if (config.contextLimit && estimatedTokens > config.contextLimit) {
    throw new Error(
      `预估输入 token ${estimatedTokens} 已超出设置的上下文上限 ${config.contextLimit}。建议在「设置」中调高上限，或减少最大页数。`,
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
      // 保留原始值（字符串/数组/对象），由渲染层 valueToMarkdown 统一兜底转换
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

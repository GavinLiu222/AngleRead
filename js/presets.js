/* 主流服务商与多模态模型的预置清单。
   两处输入框仍是自由文本，这里只提供下拉建议；清单之外的地址 / 模型照常可用。 */

/**
 * API base URLs. `url` 是「版本号之前」的基地址——llmClient 会按需补上
 * `/v1/chat/completions`（或 `/v1/messages`）。若地址本身已含版本号段则不再重复补。
 */
export const API_PRESETS = [
  {
    key: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com',
    format: 'openai',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    url: 'https://api.anthropic.com',
    format: 'anthropic',
  },
  {
    key: 'google',
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    format: 'openai',
    note: 'OpenAI-compatible endpoint',
  },
  {
    key: 'xai',
    label: 'xAI Grok',
    url: 'https://api.x.ai',
    format: 'openai',
  },
  {
    key: 'mistral',
    label: 'Mistral AI',
    url: 'https://api.mistral.ai',
    format: 'openai',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    url: 'https://api.deepseek.com',
    format: 'openai',
    note: 'Flash reads images · V4-Pro does not',
  },
  {
    key: 'qwen',
    label: 'Alibaba Qwen',
    url: 'https://dashscope.aliyuncs.com/compatible-mode',
    format: 'openai',
    note: 'DashScope compatible mode',
  },
  {
    key: 'zhipu',
    label: 'Zhipu GLM',
    url: 'https://open.bigmodel.cn/api/paas/v4',
    format: 'openai',
  },
  {
    key: 'moonshot',
    label: 'Moonshot Kimi',
    url: 'https://api.moonshot.cn',
    format: 'openai',
  },
  {
    key: 'stepfun',
    label: 'StepFun',
    url: 'https://api.stepfun.com',
    format: 'openai',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api',
    format: 'openai',
    note: 'Router for most of the models below',
  },
  {
    key: 'siliconflow',
    label: 'SiliconFlow',
    url: 'https://api.siliconflow.cn',
    format: 'openai',
  },
  {
    key: 'together',
    label: 'Together AI',
    url: 'https://api.together.xyz',
    format: 'openai',
  },
  {
    key: 'groq',
    label: 'Groq',
    url: 'https://api.groq.com/openai',
    format: 'openai',
  },
  {
    key: 'ollama',
    label: 'Ollama',
    url: 'http://localhost:11434',
    format: 'ollama',
    note: 'Local · no API key',
  },
  {
    key: 'lmstudio',
    label: 'LM Studio',
    url: 'http://localhost:1234',
    format: 'openai',
    note: 'Local · no API key',
  },
];

/**
 * 以**支持视觉输入**的模型为主——本工具把 PDF 与图片逐页渲染成图片喂给模型，
 * 纯文本模型无法解读图表与公式截图。少数纯文本模型（如 DeepSeek-V4-Pro）也一并收录，
 * 用 `vision: false` 标记、条目注记里写明 no vision：它们能读 Word / Markdown / 纯文本，读不了 PDF 与图片。
 */
export const MODEL_PRESETS = [
  {
    key: 'openai',
    group: 'OpenAI',
    items: [
      { id: 'gpt-4o', note: 'Flagship multimodal' },
      { id: 'gpt-4o-mini', note: 'Cheaper, faster' },
      { id: 'gpt-4.1', note: 'Long context' },
      { id: 'gpt-4.1-mini' },
      { id: 'o4-mini', note: 'Reasoning + vision' },
    ],
  },
  {
    key: 'anthropic',
    group: 'Anthropic Claude',
    items: [
      { id: 'claude-opus-5', note: 'Most capable' },
      { id: 'claude-sonnet-5', note: 'Balanced' },
      { id: 'claude-haiku-4-5-20251001', note: 'Fastest' },
      { id: 'claude-sonnet-4-5' },
      { id: 'claude-3-5-sonnet-latest' },
    ],
  },
  {
    key: 'google',
    group: 'Google Gemini',
    items: [
      { id: 'gemini-2.5-pro', note: 'Strong on dense PDFs' },
      { id: 'gemini-2.5-flash', note: 'Cheaper, faster' },
      { id: 'gemini-2.0-flash' },
    ],
  },
  {
    key: 'xai',
    group: 'xAI Grok',
    items: [{ id: 'grok-4' }, { id: 'grok-2-vision-1212' }],
  },
  {
    key: 'mistral',
    group: 'Mistral',
    items: [{ id: 'pixtral-large-latest' }, { id: 'pixtral-12b-2409' }],
  },
  {
    key: 'deepseek',
    group: 'DeepSeek',
    items: [
      { id: 'deepseek-flash', note: 'DeepSeek-V4.1-Flash · vision · 1M context' },
      { id: 'deepseek-v4-pro', note: 'DeepSeek-V4-Pro-0813 · no vision · 1M context', vision: false },
    ],
  },
  {
    key: 'qwen',
    group: 'Alibaba Qwen',
    items: [
      { id: 'qwen-vl-max', note: 'Best Qwen vision tier' },
      { id: 'qwen-vl-plus' },
      { id: 'qwen2.5-vl-72b-instruct', note: 'Open weights' },
    ],
  },
  {
    key: 'zhipu',
    group: 'Zhipu GLM',
    items: [{ id: 'glm-4v-plus' }, { id: 'glm-4v' }],
  },
  {
    key: 'moonshot',
    group: 'Moonshot Kimi',
    items: [{ id: 'moonshot-v1-32k-vision-preview' }, { id: 'moonshot-v1-8k-vision-preview' }],
  },
  {
    key: 'stepfun',
    group: 'StepFun',
    items: [{ id: 'step-1o-turbo-vision' }, { id: 'step-1v-8k' }],
  },
  {
    key: 'meta',
    group: 'Meta Llama · via OpenRouter / Together',
    items: [
      { id: 'meta-llama/llama-3.2-90b-vision-instruct' },
      { id: 'meta-llama/llama-3.2-11b-vision-instruct' },
    ],
  },
  {
    key: 'ollama',
    group: 'Ollama · local',
    items: [
      { id: 'llama3.2-vision', note: 'ollama pull llama3.2-vision' },
      { id: 'qwen2.5vl' },
      { id: 'minicpm-v' },
      { id: 'llava' },
    ],
  },
];

/* 已知的纯文本模型。只写有把握的规则——误报会让提示变成噪音，
   拿不准时返回 'unknown'，界面就不提示。

   这里曾经按家族名整片地猜（mistral / qwen / glm-4 / llama / gemma / phi / yi…），
   但这些家族后来陆续出了多模态版本，规则就成了反的：glm-4.5v、llama-4-scout、
   gemma-3、phi-4-multimodal、mistral-small-3.2、qwen3-omni 全被判成读不了图，
   于是用户会在三个地方被告知「你的 PDF 会是空的」，而实际上人家读得好好的。
   按名字猜家族这条路走不通——每出一代模型就得回来改一次，改慢了就是误报。
   所以只留下确有把握的个例，其余交给 MODEL_PRESETS 里人工标注的 `vision: false`；
   都没命中就老实返回 'unknown'，界面不提示。 */
const TEXT_ONLY_HINTS = [
  /^deepseek-v4-pro/, // DeepSeek 只有 V4-Pro 不读图，Flash 读图
  /^gpt-3\.5/,
];

/**
 * 猜某个模型是否支持视觉输入。PDF 与图片是逐页喂图的，纯文本模型读不出来。
 * @returns {'yes'|'no'|'unknown'} 清单内按清单判断，清单外用上面的规则，再拿不准就 'unknown'
 */
export function modelVisionSupport(model) {
  const id = String(model || '').trim().toLowerCase();
  if (!id) return 'unknown';
  for (const group of MODEL_PRESETS) {
    for (const item of group.items) {
      if (item.id.toLowerCase() === id) return item.vision === false ? 'no' : 'yes';
    }
  }
  return TEXT_ONLY_HINTS.some((re) => re.test(id)) ? 'no' : 'unknown';
}

/** 根据当前的 API 地址 / 接口格式猜出服务商，用于把对应的模型分组置顶。 */
export function guessProviderKey({ apiUrl, apiFormat } = {}) {
  if (apiFormat === 'ollama') return 'ollama';
  if (apiFormat === 'anthropic') return 'anthropic';
  const url = String(apiUrl || '').toLowerCase();
  if (!url) return '';
  let best = '';
  for (const p of API_PRESETS) {
    if (p.format === 'ollama') continue;
    const host = p.url.toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0];
    if (host && url.includes(host)) best = p.key;
  }
  return best;
}

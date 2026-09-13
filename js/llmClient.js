import { stripBase64Prefix, dataUrlMediaType } from './docProcessor.js';

const IMAGE_TOKEN_ESTIMATE = 1500;
/* 推理模型把思考链也算进输出额度里，而且往往会在思考里把每个章节都先草拟一遍——
   8192 根本不够它想完再写，正文会是空的。max_tokens 只是上限、不是目标，给大了
   对普通模型一分钱不多花，所以默认给足；端点如果不接受，下面的兜底会自动降档。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;
/* 端点拒绝大额度、报错里又没写明上限时退回的保守值 */
const SAFE_MAX_OUTPUT_TOKENS = 8192;

const MIN_OUTPUT_TOKENS = 512;
const MAX_OUTPUT_TOKENS = 200000;

/**
 * 把用户填的输出上限夹进可用区间。0 / 留空 / 非法值返回 0，表示「用默认值」。
 * 上下界只能有一个主人：界面若自己只夹下界，填 9999999 就会被原样存进配置、
 * 存进档案、再回填进输入框，而实际发出去的永远是 200000——显示的和用的不是一回事。
 */
export function clampOutputTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.max(Math.round(n), MIN_OUTPUT_TOKENS), MAX_OUTPUT_TOKENS);
}

/** 用户没填就用默认值；夹在一个合理区间里，免得手滑填个 10 让每次请求都被截断 */
function outputBudget(config) {
  return clampOutputTokens(config?.maxOutputTokens) || DEFAULT_MAX_OUTPUT_TOKENS;
}

/** 各家对「输出被 max_tokens 砍断」的叫法 */
function isLengthFinish(reason) {
  return /^(length|max_tokens|model_length|output_limit)$/i.test(String(reason || ''));
}

function anthropicHeaders(apiKey) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function joinUrl(base, path) {
  if (!base) return path;
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

/**
 * 解析聊天 / 消息端点。基地址通常写到版本号之前（如 `https://api.openai.com`），
 * 但也有服务商的兼容层自带版本段（Gemini 的 `/v1beta/openai`、智谱的 `/api/paas/v4`），
 * 用户也常常手滑把 `/v1` 一起粘进来。这里统一判断：路径里已有版本号段就不再补 `/v1`。
 * @param {string} base 用户填写的 API URL
 * @param {string} path 'chat/completions' 或 'messages'
 */
function apiEndpoint(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  if (!b) return '/' + path;
  if (b.endsWith('/' + path)) return b;
  const afterHost = b.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const versioned = /\/v\d[\w.-]*(?=\/|$)/i.test(afterHost);
  return versioned ? `${b}/${path}` : `${b}/v1/${path}`;
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
      detail = parsed.error?.message || parsed.message || text;
    } catch {}
    const err = new Error(`HTTP ${res.status}: ${detail.slice(0, 400)}`);
    err.status = res.status;
    err.detail = detail;
    // 整个错误体也留着：各家在 error.param / error.code 里直接点名是哪个参数出的问题，
    // 这个结构化信号比去猜英文措辞可靠得多（见 looksLikeJsonModeRejection）
    err.body = parsed;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Response was not valid JSON: ' + text.slice(0, 200));
  }
}

/** @returns {{text: string, fromReasoning: boolean}} */
function pickOpenAIText(msg) {
  if (!msg) throw new Error('Response is missing the `message` field.');
  let text = '';
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('\n');
  }
  // Reasoning models (e.g. qwen3 / deepseek-r1 behind Ollama's compat layer) sometimes
  // put the answer in reasoning_content / reasoning and leave content empty.
  if (!text.trim()) {
    const reasoning = msg.reasoning_content || msg.reasoning || '';
    if (reasoning.trim()) return { text: reasoning, fromReasoning: true };
  }
  return { text, fromReasoning: false };
}

function pickAnthropicText(parts) {
  if (!Array.isArray(parts)) throw new Error('Response is missing the `content` array.');
  return parts.map((p) => p.text || '').join('\n');
}

function normalizeOpenAIUsage(u) {
  if (!u) return null;
  return {
    input: u.prompt_tokens ?? u.input_tokens ?? null,
    output: u.completion_tokens ?? u.output_tokens ?? null,
    total: u.total_tokens ?? null,
  };
}

function normalizeAnthropicUsage(u) {
  if (!u) return null;
  const input = u.input_tokens ?? null;
  const output = u.output_tokens ?? null;
  const total = input != null && output != null ? input + output : null;
  return { input, output, total };
}

/* 内容块：{type:'image', dataUrl} / {type:'text', text, label?}。
   为了向后兼容，纯 data URL 字符串数组同样接受。 */
function normalizeParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => {
      if (typeof part === 'string') return { type: 'image', dataUrl: part };
      if (part?.type === 'image' && part.dataUrl) return part;
      if (part?.type === 'text' && part.text) return part;
      return null;
    })
    .filter(Boolean);
}

function buildOpenAIContent(prompt, parts) {
  const content = [{ type: 'text', text: prompt }];
  let page = 0;
  for (const part of normalizeParts(parts)) {
    if (part.type === 'image') {
      page += 1;
      content.push({ type: 'text', text: `--- Page ${page} ---` });
      content.push({ type: 'image_url', image_url: { url: part.dataUrl } });
    } else {
      content.push({ type: 'text', text: `--- ${part.label || 'Document text'} ---\n${part.text}` });
    }
  }
  return content;
}

function buildAnthropicContent(prompt, parts) {
  const content = [{ type: 'text', text: prompt }];
  let page = 0;
  for (const part of normalizeParts(parts)) {
    if (part.type === 'image') {
      page += 1;
      content.push({ type: 'text', text: `--- Page ${page} ---` });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: dataUrlMediaType(part.dataUrl),
          data: stripBase64Prefix(part.dataUrl),
        },
      });
    } else {
      content.push({ type: 'text', text: `--- ${part.label || 'Document text'} ---\n${part.text}` });
    }
  }
  return content;
}

/* JSON 模式（`response_format: {type:'json_object'}`）是挡住「先讲一段思路再给 JSON」
   的第一道闸。OpenAI / DeepSeek / Ollama 的兼容层都支持，但不少自建网关不认，
   被拒过一次就记下来，同一个端点以后直接不带这个参数。 */
const jsonModeUnsupported = new Set();

function endpointKey({ apiUrl, model }) {
  return `${apiUrl || ''}|${model || ''}`;
}

function looksLikeJsonModeRejection(err) {
  if (!err || !(err.status >= 400 && err.status < 500)) return false;
  // 服务商多半在错误体里直接点名是哪个参数（OpenAI 的 error.param / error.code），
  // 有这个结构化信号就别去猜英文措辞——各家文案不同，中文网关根本不出现 unsupported
  const param = String(err.body?.error?.param || '');
  if (param) return /response_format/i.test(param);
  const text = String(err.detail || err.message || '');
  // "Unsupported parameter: max_tokens…" 也含 unsupported，但那是额度的事，别记错账
  if (/max[_ ]?(completion[_ ]?)?tokens/i.test(text)) return false;
  // 光凭一个 unsupported / unrecognized 不能算数：'Unsupported value: temperature…'
  // 'Unsupported image media type…' 'unsupported model…' 都会撞上，一旦误判就会把
  // 一个其实支持 JSON 模式的端点永久记成不支持，还白发一次整份文档。必须点到 JSON 这件事上。
  return /response_format|json[_ ]?object|json[_ ]?schema|json mode|(unsupported|unrecognized|unknown)[^.]{0,40}\bjson\b/i.test(
    text,
  );
}

/* 端点对输出额度的两种拒绝：一是超过该模型允许的上限，二是新版接口把参数改叫
   max_completion_tokens。都记在端点上，下次直接按已知的规矩发。 */
const maxTokensCap = new Map();
const maxTokensRenamed = new Set();

/* 报错里提到 max_tokens，但说的其实是输入太长 / 上下文窗口 / 限流额度——
   这类句子里的数字是提示词长度、窗口大小或每分钟配额，不是这个模型的输出上限。
   拿它们当上限记进 maxTokensCap，会把端点永久锁在一个荒唐的小值上，
   而 applyOutputBudget 取的是 min(cap, 用户设置)，界面上再怎么调都不起作用。 */
const ABOUT_INPUT = /context (window|length|limit|budget)|input length|prompt (is|already|length)|per (min|day)|rate limit|TPM|TPD/i;
/* 「给大了」的措辞——只有确实在说超限，才允许在报错没写明数字时对半砍 */
const TOO_LARGE = /too (large|big|high)|exceed|greater than|at most|must be (<=|less|below|no more)|maximum|上限|超(过|出)/i;

function maxTokensRejection(err, current) {
  if (!err || !(err.status >= 400 && err.status < 500)) return null;
  const text = String(err.detail || err.message || '');
  if (!/max[_ ]?(completion[_ ]?)?tokens/i.test(text)) return null;
  // 新版接口把参数改叫 max_completion_tokens。这个信号和「额度给大了」是两件事，
  // 同一句话可能两件都占（"max_completion_tokens is too large: 32768…"），所以不能
  // 一看见这个名字就早退——早退会让下面的取上限永远轮不到，改过名的端点就此卡死
  const rename = /max_completion_tokens/i.test(text) ? { rename: true } : null;
  if (ABOUT_INPUT.test(text)) return rename;
  // 报错里通常直接写着这个模型允许的上限，取其中比当前值小的最大数字；
  // 认不出来就对半砍——32768 → 8192 → 4096 两步就能罩住常见的真实上限，
  // 而每多试一次都要把整份文档（含页面图片）重发一遍，不能慢慢试
  const found = (text.match(/\d{3,7}/g) || []).map(Number).filter((n) => n >= 256 && n < current);
  const limit = found.length
    ? Math.max(...found)
    : TOO_LARGE.test(text)
      ? Math.min(SAFE_MAX_OUTPUT_TOKENS, Math.floor(current / 2))
      : 0;
  return limit >= 256 ? { ...rename, limit } : rename;
}

/** 带自愈的 POST：JSON 模式与输出额度被拒时各修一次，修不动就把原始错误抛出去 */
async function postChat(url, headers, body, key) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postJson(url, headers, body);
    } catch (err) {
      if (attempt >= 2) throw err;
      // 先判额度：它的特征更具体，错判成 JSON 模式会白白多发一次请求，
      // 还会把一个其实支持 JSON 模式的端点记成不支持
      const current = body.max_tokens ?? body.max_completion_tokens;
      const fix = maxTokensRejection(err, current);
      // 改名与降额各自独立地判一次：一条报错可能两件事都要求，而改过名之后
      // 再收到「还是太大」时，降额这一支必须仍然能生效
      let changed = false;
      if (fix?.rename && !('max_completion_tokens' in body)) {
        maxTokensRenamed.add(key);
        body.max_completion_tokens = current;
        delete body.max_tokens;
        changed = true;
      }
      if (fix?.limit) {
        maxTokensCap.set(key, fix.limit);
        if ('max_completion_tokens' in body) body.max_completion_tokens = fix.limit;
        else body.max_tokens = fix.limit;
        changed = true;
      }
      if (changed) continue;
      if (body.response_format && looksLikeJsonModeRejection(err)) {
        jsonModeUnsupported.add(key);
        delete body.response_format;
        continue;
      }
      throw err;
    }
  }
}

/** 按这个端点已知的规矩写进 max_tokens / max_completion_tokens */
function applyOutputBudget(body, config, key) {
  const cap = maxTokensCap.get(key);
  const budget = cap ? Math.min(cap, outputBudget(config)) : outputBudget(config);
  if (maxTokensRenamed.has(key)) body.max_completion_tokens = budget;
  else body.max_tokens = budget;
  return body;
}

async function callOpenAI(config, prompt, parts, { json = false } = {}) {
  const { apiUrl, apiKey, model } = config;
  const url = apiEndpoint(apiUrl, 'chat/completions');
  const content = buildOpenAIContent(prompt, parts);
  const headers = { Authorization: `Bearer ${apiKey}` };
  const key = endpointKey(config);
  const body = applyOutputBudget(
    {
      model,
      messages: [{ role: 'user', content }],
      temperature: 0.5,
    },
    config,
    key,
  );
  if (json && !jsonModeUnsupported.has(key)) body.response_format = { type: 'json_object' };
  const data = await postChat(url, headers, body, key);
  const choice = data.choices?.[0];
  const { text, fromReasoning } = pickOpenAIText(choice?.message);
  return {
    text,
    usage: normalizeOpenAIUsage(data.usage),
    truncated: isLengthFinish(choice?.finish_reason ?? choice?.native_finish_reason),
    // 只剩思考链、正文是空的：额度全烧在思考上了
    reasoningOnly: fromReasoning,
  };
}

async function callAnthropic(config, prompt, parts, { json = false } = {}) {
  const { apiUrl, apiKey, model } = config;
  const url = apiEndpoint(apiUrl, 'messages');
  const content = buildAnthropicContent(prompt, parts);
  const messages = [{ role: 'user', content }];
  // Anthropic 没有 response_format，改用 assistant 预填：让模型从 `{` 续写，
  // 「先写一段开场白」这条路就走不通了
  if (json) messages.push({ role: 'assistant', content: [{ type: 'text', text: '{' }] });
  const key = endpointKey(config);
  const body = applyOutputBudget({ model, temperature: 0.5, messages }, config, key);
  const data = await postChat(url, anthropicHeaders(apiKey), body, key);
  let text = pickAnthropicText(data.content);
  // 预填的 `{` 不在回复里，得补回去；若网关忽略了预填、回复已自带开头就别重复补。
  // 正文整个是空的（额度全烧在 thinking 块里）时也不能补——补出来的 `{` 会被修成 `{}`，
  // 越过「模型什么都没返回」这道检查，最后渲染成一张没有任何提示的空白报告
  if (json && text.trim() && !/^\s*(\{|```)/.test(text)) text = '{' + text;
  return {
    text,
    usage: normalizeAnthropicUsage(data.usage),
    truncated: isLengthFinish(data.stop_reason),
  };
}

// Ollama exposes an OpenAI-compatible endpoint but needs no auth locally;
// a placeholder key keeps the Authorization header present.
function normalizeForOpenAI(config) {
  if (config.apiFormat === 'ollama') {
    return { ...config, apiKey: config.apiKey || 'ollama' };
  }
  return config;
}

/**
 * Single-shot completion.
 * @param {object} options
 * @param {boolean} [options.json] ask the endpoint for a strict JSON object rather than free text
 * @returns {Promise<{text:string, usage:object|null, truncated:boolean}>}
 *   `truncated` is true when the provider says the answer was cut off at max_tokens.
 */
export async function callLLM(config, prompt, parts, options = {}) {
  assertConfig(config);
  if (config.apiFormat === 'anthropic') {
    return callAnthropic(config, prompt, parts, options);
  }
  return callOpenAI(normalizeForOpenAI(config), prompt, parts, options);
}

/* ---------------- chat (multi-turn) ---------------- */

/**
 * Chat completion with paper context.
 * @param {object} config
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', text:string, parts?:Array}>} turns
 *   `parts` (page images / document text) only attached to the first user turn that has them.
 */
export async function chatLLM(config, systemPrompt, turns) {
  assertConfig(config);
  if (config.apiFormat === 'anthropic') {
    return chatAnthropic(config, systemPrompt, turns);
  }
  return chatOpenAI(normalizeForOpenAI(config), systemPrompt, turns);
}

async function chatOpenAI(config, systemPrompt, turns) {
  const { apiUrl, apiKey, model } = config;
  const url = apiEndpoint(apiUrl, 'chat/completions');
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const t of turns) {
    if (t.parts && t.parts.length) {
      messages.push({ role: t.role, content: buildOpenAIContent(t.text || '', t.parts) });
    } else {
      messages.push({ role: t.role, content: t.text || '' });
    }
  }
  const key = endpointKey(config);
  const body = applyOutputBudget({ model, messages, temperature: 0.5 }, config, key);
  const data = await postChat(url, { Authorization: `Bearer ${apiKey}` }, body, key);
  const choice = data.choices?.[0];
  return {
    text: pickOpenAIText(choice?.message).text,
    usage: normalizeOpenAIUsage(data.usage),
    truncated: isLengthFinish(choice?.finish_reason ?? choice?.native_finish_reason),
  };
}

async function chatAnthropic(config, systemPrompt, turns) {
  const { apiUrl, apiKey, model } = config;
  const url = apiEndpoint(apiUrl, 'messages');
  const messages = [];
  for (const t of turns) {
    if (t.parts && t.parts.length) {
      messages.push({ role: t.role, content: buildAnthropicContent(t.text || '', t.parts) });
    } else {
      messages.push({ role: t.role, content: [{ type: 'text', text: t.text || '' }] });
    }
  }
  const key = endpointKey(config);
  const body = applyOutputBudget({ model, temperature: 0.5, messages }, config, key);
  if (systemPrompt) body.system = systemPrompt;
  const data = await postChat(url, anthropicHeaders(apiKey), body, key);
  return {
    text: pickAnthropicText(data.content),
    usage: normalizeAnthropicUsage(data.usage),
    truncated: isLengthFinish(data.stop_reason),
  };
}

function assertConfig(config) {
  if (!config.apiUrl) throw new Error('Set an API URL in Settings first.');
  if (config.apiFormat !== 'ollama' && !config.apiKey) {
    throw new Error('Set an API key in Settings first.');
  }
  if (!config.model) throw new Error('Choose a model in Settings first.');
}

/**
 * Fetch the list of models the endpoint exposes.
 * - ollama: /api/tags, i.e. the models pulled locally
 * - openai / anthropic: /v1/models
 * @returns {Promise<string[]>} model ids
 */
export async function fetchModelList({ apiUrl, apiKey, apiFormat }) {
  if (!apiUrl) throw new Error('Enter an API URL first.');

  if (apiFormat === 'ollama') {
    const res = await fetch(joinUrl(apiUrl, '/api/tags'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || [])
      .map((m) => m.name || m.model)
      .filter(Boolean);
  }

  const headers = {};
  if (apiFormat === 'anthropic') {
    headers['x-api-key'] = apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(apiEndpoint(apiUrl, 'models'), { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || data.models || [])
    .map((m) => m.id || m.name)
    .filter(Boolean);
}

/* ---------------- token estimation ---------------- */

export function estimateTextTokens(text) {
  if (!text) return 0;
  // Rough heuristic that works decently for mixed Chinese/English.
  // Chinese ~1 token per 1-1.5 char, English ~1 token per ~4 char.
  return Math.ceil(text.length / 2.5);
}

/** 内容块的估算：图片按固定单价，文本按字符数 */
export function estimatePartsTokens(parts) {
  let total = 0;
  for (const part of normalizeParts(parts)) {
    if (part.type === 'image') total += IMAGE_TOKEN_ESTIMATE + 12;
    else total += estimateTextTokens(part.text) + 12;
  }
  return total;
}

/**
 * Estimate tokens for a chat turn array as passed to chatLLM.
 */
export function estimateChatTokens(systemPrompt, turns) {
  let total = estimateTextTokens(systemPrompt || '');
  for (const t of turns) {
    total += estimateTextTokens(t.text || '');
    if (t.parts?.length) total += estimatePartsTokens(t.parts);
  }
  total += turns.length * 8;
  return total;
}

/**
 * Estimate tokens for a single-shot analysis call.
 */
export function estimateAnalysisTokens(prompt, parts) {
  return estimateTextTokens(prompt) + estimatePartsTokens(parts);
}

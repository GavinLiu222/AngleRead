import { stripBase64Prefix } from './pdfProcessor.js';

const IMAGE_TOKEN_ESTIMATE = 1500;

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
    try {
      const obj = JSON.parse(text);
      detail = obj.error?.message || obj.message || text;
    } catch {}
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Response was not valid JSON: ' + text.slice(0, 200));
  }
}

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
    text = msg.reasoning_content || msg.reasoning || text;
  }
  return text;
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

function buildOpenAIContent(prompt, images) {
  const content = [{ type: 'text', text: prompt }];
  images.forEach((dataUrl, i) => {
    content.push({ type: 'text', text: `--- Page ${i + 1} ---` });
    content.push({ type: 'image_url', image_url: { url: dataUrl } });
  });
  return content;
}

function buildAnthropicContent(prompt, images) {
  const content = [{ type: 'text', text: prompt }];
  images.forEach((dataUrl, i) => {
    content.push({ type: 'text', text: `--- Page ${i + 1} ---` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: stripBase64Prefix(dataUrl),
      },
    });
  });
  return content;
}

async function callOpenAI({ apiUrl, apiKey, model }, prompt, images) {
  const url = apiEndpoint(apiUrl, 'chat/completions');
  const content = buildOpenAIContent(prompt, images);
  const body = {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.5,
    max_tokens: 8192,
  };
  const data = await postJson(url, { Authorization: `Bearer ${apiKey}` }, body);
  return {
    text: pickOpenAIText(data.choices?.[0]?.message),
    usage: normalizeOpenAIUsage(data.usage),
  };
}

async function callAnthropic({ apiUrl, apiKey, model }, prompt, images) {
  const url = apiEndpoint(apiUrl, 'messages');
  const content = buildAnthropicContent(prompt, images);
  const body = {
    model,
    max_tokens: 8192,
    temperature: 0.5,
    messages: [{ role: 'user', content }],
  };
  const data = await postJson(
    url,
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
  );
  return {
    text: pickAnthropicText(data.content),
    usage: normalizeAnthropicUsage(data.usage),
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

export async function callLLM(config, prompt, images) {
  assertConfig(config);
  if (config.apiFormat === 'anthropic') {
    return callAnthropic(config, prompt, images);
  }
  return callOpenAI(normalizeForOpenAI(config), prompt, images);
}

/* ---------------- chat (multi-turn) ---------------- */

/**
 * Chat completion with paper context.
 * @param {object} config
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', text:string, images?:string[]}>} turns
 *   `images` only attached to the first user turn that has them.
 */
export async function chatLLM(config, systemPrompt, turns) {
  assertConfig(config);
  if (config.apiFormat === 'anthropic') {
    return chatAnthropic(config, systemPrompt, turns);
  }
  return chatOpenAI(normalizeForOpenAI(config), systemPrompt, turns);
}

async function chatOpenAI({ apiUrl, apiKey, model }, systemPrompt, turns) {
  const url = apiEndpoint(apiUrl, 'chat/completions');
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const t of turns) {
    if (t.images && t.images.length) {
      messages.push({ role: t.role, content: buildOpenAIContent(t.text || '', t.images) });
    } else {
      messages.push({ role: t.role, content: t.text || '' });
    }
  }
  const body = { model, messages, temperature: 0.5, max_tokens: 4096 };
  const data = await postJson(url, { Authorization: `Bearer ${apiKey}` }, body);
  return {
    text: pickOpenAIText(data.choices?.[0]?.message),
    usage: normalizeOpenAIUsage(data.usage),
  };
}

async function chatAnthropic({ apiUrl, apiKey, model }, systemPrompt, turns) {
  const url = apiEndpoint(apiUrl, 'messages');
  const messages = [];
  for (const t of turns) {
    if (t.images && t.images.length) {
      messages.push({ role: t.role, content: buildAnthropicContent(t.text || '', t.images) });
    } else {
      messages.push({ role: t.role, content: [{ type: 'text', text: t.text || '' }] });
    }
  }
  const body = {
    model,
    max_tokens: 4096,
    temperature: 0.5,
    messages,
  };
  if (systemPrompt) body.system = systemPrompt;
  const data = await postJson(
    url,
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
  );
  return {
    text: pickAnthropicText(data.content),
    usage: normalizeAnthropicUsage(data.usage),
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

export function estimateImageTokens(count) {
  return count * IMAGE_TOKEN_ESTIMATE;
}

/**
 * Estimate tokens for a chat turn array as passed to chatLLM.
 */
export function estimateChatTokens(systemPrompt, turns) {
  let total = estimateTextTokens(systemPrompt || '');
  for (const t of turns) {
    total += estimateTextTokens(t.text || '');
    if (t.images?.length) total += estimateImageTokens(t.images.length);
  }
  total += turns.length * 8;
  return total;
}

/**
 * Estimate tokens for a single-shot analysis call.
 */
export function estimateAnalysisTokens(prompt, imageCount) {
  return estimateTextTokens(prompt) + estimateImageTokens(imageCount) + imageCount * 12;
}

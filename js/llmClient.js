import { stripBase64Prefix } from './pdfProcessor.js';

const IMAGE_TOKEN_ESTIMATE = 1500;

function joinUrl(base, path) {
  if (!base) return path;
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
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
    throw new Error('响应不是有效的 JSON: ' + text.slice(0, 200));
  }
}

function pickOpenAIText(msg) {
  if (!msg) throw new Error('响应缺少 message 字段');
  let text = '';
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('\n');
  }
  // 推理模型（如经 Ollama 兼容层的 qwen3、deepseek-r1）有时把输出放在
  // reasoning_content / reasoning 字段而 content 为空，此处兜底回退。
  if (!text.trim()) {
    text = msg.reasoning_content || msg.reasoning || text;
  }
  return text;
}

function pickAnthropicText(parts) {
  if (!Array.isArray(parts)) throw new Error('响应缺少 content 数组字段');
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
    content.push({ type: 'text', text: `--- 第 ${i + 1} 页 ---` });
    content.push({ type: 'image_url', image_url: { url: dataUrl } });
  });
  return content;
}

function buildAnthropicContent(prompt, images) {
  const content = [{ type: 'text', text: prompt }];
  images.forEach((dataUrl, i) => {
    content.push({ type: 'text', text: `--- 第 ${i + 1} 页 ---` });
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
  const url = joinUrl(apiUrl, '/v1/chat/completions');
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
  const url = joinUrl(apiUrl, '/v1/messages');
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

// Ollama 暴露 OpenAI 兼容接口（/v1/chat/completions），但本地无需鉴权；
// 此处补一个占位 Key，保证 Authorization 头存在即可。
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
  const url = joinUrl(apiUrl, '/v1/chat/completions');
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
  const url = joinUrl(apiUrl, '/v1/messages');
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
  if (!config.apiUrl) throw new Error('请先在设置中填写 API URL');
  if (config.apiFormat !== 'ollama' && !config.apiKey) {
    throw new Error('请先在设置中填写 API Key');
  }
  if (!config.model) throw new Error('请先在设置中填写模型名称');
}

/**
 * 拉取可用模型列表。
 * - ollama：调用 /api/tags 列出本地已下载的模型
 * - openai / anthropic：调用 /v1/models
 * @returns {Promise<string[]>} 模型名数组
 */
export async function fetchModelList({ apiUrl, apiKey, apiFormat }) {
  if (!apiUrl) throw new Error('请先填写 API URL');

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
  const res = await fetch(joinUrl(apiUrl, '/v1/models'), { headers });
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

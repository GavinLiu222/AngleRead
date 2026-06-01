import {
  getConfig,
  setConfig,
  getSections,
  setSections,
  resetSections,
  clearAllStorage,
  genSectionId,
  getProfiles,
  deleteProfile,
  rememberProfile,
  profileSignature,
} from './config.js';
import { estimateChatTokens, estimateTextTokens, fetchModelList } from './llmClient.js';

const VIEWS = ['settings', 'upload', 'results', 'chat'];

export function switchView(name) {
  if (!VIEWS.includes(name)) return;
  for (const v of VIEWS) {
    const el = document.getElementById('view-' + v);
    if (el) el.hidden = v !== name;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === name);
  }
}

/* ---------------- toast ---------------- */
let toastTimer = null;
export function toast(message, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show ' + type;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => (el.hidden = true), 200);
  }, 2400);
}

/* ---------------- settings view ---------------- */
export function renderSettings() {
  const cfg = getConfig();
  document.getElementById('apiUrl').value = cfg.apiUrl;
  document.getElementById('apiKey').value = cfg.apiKey;
  document.getElementById('apiFormat').value = cfg.apiFormat;
  document.getElementById('modelName').value = cfg.model;
  document.getElementById('maxPages').value = cfg.maxPages;
  document.getElementById('contextLimit').value = cfg.contextLimit;
  document.getElementById('rememberKey').checked = cfg.rememberKey;
  document.getElementById('autoSuggestSections').checked = cfg.autoSuggestSections;
  renderProfiles();
  updateProviderUI();
  renderModelChips([]);
  renderSectionEditor();
}

/* ---------------- model config profiles ---------------- */
function renderProfiles() {
  const select = document.getElementById('profileSelect');
  if (!select) return;
  const profiles = getProfiles();
  const activeSig = profileSignature(getConfig());
  select.innerHTML = '<option value="">— 选择已保存的配置 —</option>';
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (profileSignature(p) === activeSig) opt.selected = true;
    select.appendChild(opt);
  });
  const delBtn = document.getElementById('deleteProfileBtn');
  if (delBtn) delBtn.disabled = !select.value;
}

function applyProfileToForm(p) {
  document.getElementById('apiUrl').value = p.apiUrl || '';
  document.getElementById('apiKey').value = p.apiKey || '';
  document.getElementById('apiFormat').value = p.apiFormat || 'openai';
  document.getElementById('modelName').value = p.model || '';
  if (p.contextLimit) document.getElementById('contextLimit').value = p.contextLimit;
  updateProviderUI();
  renderModelChips([]);
}

/* Ollama / 服务商相关的 UI 联动 */
function updateProviderUI() {
  const isOllama = document.getElementById('apiFormat').value === 'ollama';
  const urlInput = document.getElementById('apiUrl');
  const keyInput = document.getElementById('apiKey');
  const ollamaHint = document.getElementById('ollamaHint');
  if (ollamaHint) ollamaHint.hidden = !isOllama;
  if (isOllama && !urlInput.value.trim()) urlInput.value = 'http://localhost:11434';
  keyInput.placeholder = isOllama ? '本地 Ollama 无需 API Key（可留空）' : 'sk-...';
}

function renderModelChips(models) {
  const row = document.getElementById('modelListRow');
  const box = document.getElementById('modelChips');
  if (!row || !box) return;
  box.innerHTML = '';
  if (!models || !models.length) {
    row.hidden = true;
    return;
  }
  const current = document.getElementById('modelName').value.trim();
  models.forEach((name) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'model-chip' + (name === current ? ' active' : '');
    chip.textContent = name;
    chip.addEventListener('click', () => {
      document.getElementById('modelName').value = name;
      box.querySelectorAll('.model-chip').forEach((c) => c.classList.toggle('active', c === chip));
    });
    box.appendChild(chip);
  });
  row.hidden = false;
}

function readConfigForm() {
  return {
    apiUrl: document.getElementById('apiUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    apiFormat: document.getElementById('apiFormat').value,
    model: document.getElementById('modelName').value.trim(),
  };
}

function renderSectionEditor() {
  const root = document.getElementById('sectionEditor');
  if (!root) return;
  const sections = getSections();
  root.innerHTML = '';
  sections.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'section-item';
    row.innerHTML = `
      <input type="checkbox" data-action="toggle" data-idx="${idx}" ${s.enabled ? 'checked' : ''} />
      <input type="text" data-action="title" data-idx="${idx}" value="${escapeAttr(s.title)}" placeholder="维度标题" />
      <input type="text" class="prompt-input" data-action="prompt" data-idx="${idx}" value="${escapeAttr(s.prompt)}" placeholder="提示语" />
      <button class="remove" data-action="remove" data-idx="${idx}" title="删除">×</button>
    `;
    root.appendChild(row);
  });
  root.querySelectorAll('input, button').forEach((el) => {
    el.addEventListener('input', onSectionEdit);
    el.addEventListener('click', onSectionEdit);
  });
}

function onSectionEdit(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const idx = Number(target.dataset.idx);
  const sections = getSections();
  if (action === 'toggle') {
    sections[idx].enabled = target.checked;
  } else if (action === 'title') {
    sections[idx].title = target.value;
  } else if (action === 'prompt') {
    sections[idx].prompt = target.value;
  } else if (action === 'remove' && e.type === 'click') {
    sections.splice(idx, 1);
    setSections(sections);
    renderSectionEditor();
    return;
  } else {
    return;
  }
  setSections(sections);
}

export function bindSettingsActions({ onSaved }) {
  document.getElementById('toggleKeyVisibility').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    const btn = document.getElementById('toggleKeyVisibility');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? '显示' : '隐藏';
  });

  // 切换到某个已保存的配置档案
  document.getElementById('profileSelect').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) {
      document.getElementById('deleteProfileBtn').disabled = true;
      return;
    }
    const p = getProfiles().find((x) => x.id === id);
    if (!p) return;
    applyProfileToForm(p);
    const cfg = getConfig();
    setConfig({
      apiUrl: p.apiUrl || '',
      apiKey: p.apiKey || '',
      apiFormat: p.apiFormat || 'openai',
      model: p.model || '',
      contextLimit: p.contextLimit || cfg.contextLimit,
    });
    document.getElementById('deleteProfileBtn').disabled = false;
    toast(`已切换到「${p.name}」`, 'success');
  });

  // 删除选中的配置档案
  document.getElementById('deleteProfileBtn').addEventListener('click', () => {
    const select = document.getElementById('profileSelect');
    const id = select.value;
    if (!id) return;
    const p = getProfiles().find((x) => x.id === id);
    if (!confirm(`确认删除配置「${p?.name || id}」？`)) return;
    deleteProfile(id);
    renderProfiles();
    toast('已删除该配置');
  });

  // 接口格式联动（Ollama 提示 / 默认 URL / Key 占位符）
  document.getElementById('apiFormat').addEventListener('change', () => {
    updateProviderUI();
    renderModelChips([]);
  });

  // 获取模型列表（Ollama → /api/tags；OpenAI/Anthropic → /v1/models）
  document.getElementById('fetchModelsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('fetchModelsBtn');
    const form = readConfigForm();
    if (form.apiFormat === 'ollama' && !form.apiUrl) {
      form.apiUrl = 'http://localhost:11434';
      document.getElementById('apiUrl').value = form.apiUrl;
    }
    if (!form.apiUrl) {
      toast('请先填写 API URL', 'error');
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '获取中…';
    try {
      const models = await fetchModelList(form);
      renderModelChips(models);
      toast(models.length ? `发现 ${models.length} 个模型` : '未发现可用模型', models.length ? 'success' : 'error');
    } catch (err) {
      renderModelChips([]);
      const tip = form.apiFormat === 'ollama'
        ? '：请确认 Ollama 已启动，并设置 OLLAMA_ORIGINS=* 后重启'
        : '';
      toast('获取模型失败' + tip + '（' + (err?.message || err) + '）', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  document.getElementById('addSectionBtn').addEventListener('click', () => {
    const sections = getSections();
    sections.push({
      id: genSectionId(),
      title: '新维度',
      prompt: '请描述该维度希望模型输出的内容。',
      enabled: true,
    });
    setSections(sections);
    renderSectionEditor();
  });

  document.getElementById('resetSectionsBtn').addEventListener('click', () => {
    resetSections();
    renderSectionEditor();
    toast('已恢复默认分析维度');
  });

  document.getElementById('saveConfigBtn').addEventListener('click', () => {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiFormat = document.getElementById('apiFormat').value;
    const model = document.getElementById('modelName').value.trim();
    const maxPages = Math.max(0, parseInt(document.getElementById('maxPages').value, 10) || 0);
    const contextLimit = Math.max(1000, parseInt(document.getElementById('contextLimit').value, 10) || 128000);
    const rememberKey = document.getElementById('rememberKey').checked;
    const autoSuggestSections = document.getElementById('autoSuggestSections').checked;
    const needKey = apiFormat !== 'ollama';
    if (!apiUrl || !model || (needKey && !apiKey)) {
      toast(needKey ? '请至少填写 API URL、API Key 与模型名称' : '请至少填写 API URL 与模型名称', 'error');
      return;
    }
    const next = setConfig({ apiUrl, apiKey, apiFormat, model, maxPages, contextLimit, rememberKey, autoSuggestSections });
    rememberProfile(next);
    renderProfiles();
    toast('配置已保存', 'success');
    onSaved?.();
  });

  document.getElementById('clearStorageBtn').addEventListener('click', () => {
    if (!confirm('确认清除全部本机存储（API 信息与自定义分析维度）？')) return;
    clearAllStorage();
    renderSettings();
    toast('已清除本机存储');
  });
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ---------------- upload view ---------------- */
export function bindUploadActions({ files, onAnalyze }) {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const clearBtn = document.getElementById('clearFilesBtn');

  const refresh = () => renderFileList(files, refresh);

  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files || []), files);
    fileInput.value = '';
    refresh();
    updateUploadButtons(files);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    addFiles(Array.from(e.dataTransfer.files || []), files);
    refresh();
    updateUploadButtons(files);
  });

  clearBtn.addEventListener('click', () => {
    files.length = 0;
    refresh();
    updateUploadButtons(files);
  });

  analyzeBtn.addEventListener('click', () => {
    if (!files.length) return;
    onAnalyze(files.slice());
  });
}

function addFiles(incoming, store) {
  for (const f of incoming) {
    if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') continue;
    if (store.some((s) => s.name === f.name && s.size === f.size)) continue;
    store.push(f);
  }
}

function renderFileList(files, refresh) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  files.forEach((f, idx) => {
    const row = document.createElement('div');
    row.className = 'file-item';
    row.innerHTML = `
      <div class="name">
        <span>📄</span>
        <span>${escapeText(f.name)}</span>
        <span class="size">${formatSize(f.size)}</span>
      </div>
      <button class="remove" title="移除">×</button>
    `;
    row.querySelector('.remove').addEventListener('click', () => {
      files.splice(idx, 1);
      refresh();
      updateUploadButtons(files);
    });
    list.appendChild(row);
  });
}

function updateUploadButtons(files) {
  document.getElementById('analyzeBtn').disabled = files.length === 0;
  document.getElementById('clearFilesBtn').disabled = files.length === 0;
}

function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  return div.innerHTML;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------------- results view ---------------- */
export function initResultsView(files) {
  const list = document.getElementById('resultsList');
  list.innerHTML = '';
  files.forEach((f, idx) => {
    const card = document.createElement('div');
    card.className = 'paper-card';
    card.dataset.idx = String(idx);
    card.innerHTML = `
      <div class="paper-card-head">
        <div class="title">
          <span>📄</span>
          <span>${escapeText(f.name)}</span>
        </div>
        <div class="right">
          <button class="export-btn" data-role="export" title="导出为 Markdown" hidden>⬇ Markdown</button>
          <span class="badge pending" data-role="badge">待处理</span>
          <span class="toggle">▼</span>
        </div>
      </div>
      <div class="paper-card-body" data-role="body">
        <p class="hint" data-role="status">等待开始…</p>
      </div>
    `;
    card.querySelector('.paper-card-head').addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });
    card.querySelector('[data-role="export"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const payload = card._payload;
      if (!payload) return;
      const md = generateMarkdown(f.name, payload);
      downloadText(md, replaceExt(f.name, '.md'), 'text/markdown');
    });
    list.appendChild(card);
  });
  const progress = document.getElementById('progress');
  progress.hidden = files.length === 0;
  updateProgress(0, files.length);
}

function getCard(idx) {
  return document.querySelector(`.paper-card[data-idx="${idx}"]`);
}

export function setItemStatus(idx, status, info = '') {
  const card = getCard(idx);
  if (!card) return;
  const badge = card.querySelector('[data-role="badge"]');
  const body = card.querySelector('[data-role="body"]');
  const map = {
    pending: ['待处理', 'pending'],
    processing: ['处理中', 'processing'],
    done: ['完成', 'done'],
    error: ['失败', 'error'],
  };
  const [label, cls] = map[status] || map.pending;
  badge.textContent = label;
  badge.className = 'badge ' + cls;
  if (status === 'processing' && info) {
    let statusP = body.querySelector('[data-role="status"]');
    if (!statusP) {
      body.innerHTML = '<p class="hint" data-role="status"></p>';
      statusP = body.querySelector('[data-role="status"]');
    }
    statusP.textContent = info;
  }
}

/* 把维度的值（字符串 / 数组 / 对象）统一转成可读的 Markdown。
   模型有时会无视"值为字符串"的要求，返回 [{point, benefit}, ...] 这类结构，
   此处兜底转换，避免直接 dump 出 JSON 代码块。 */
function valueToMarkdown(value) {
  if (value === undefined || value === null || value === '') {
    return '（模型未返回此维度内容）';
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => '- ' + inlineValue(item)).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `- **${k}**：${inlineValue(v)}`).join('\n');
  }
  return String(value);
}

function inlineValue(item) {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (Array.isArray(item)) return item.map(inlineValue).join('；');
  if (typeof item === 'object') return Object.values(item).map(inlineValue).join(' — ');
  return String(item);
}

export function renderItemResult(idx, payload, onRetry) {
  const card = getCard(idx);
  if (!card) return;
  card._payload = payload;
  const exportBtn = card.querySelector('[data-role="export"]');
  if (exportBtn) exportBtn.hidden = false;
  const body = card.querySelector('[data-role="body"]');
  const { result, sectionsUsed, aiSuggested, pageCount, includedPages, pageImages, usage, estimatedTokens } = payload;
  body.innerHTML = '';
  const meta = document.createElement('p');
  meta.className = 'hint';
  meta.textContent = `共 ${pageCount} 页，分析了 ${includedPages} 页`;
  body.appendChild(meta);
  const usageLine = document.createElement('p');
  usageLine.className = 'usage-line';
  const parts = [];
  if (typeof estimatedTokens === 'number') parts.push(`预估输入 <strong>${estimatedTokens.toLocaleString()}</strong>`);
  if (usage?.input != null) parts.push(`实际输入 <strong>${usage.input.toLocaleString()}</strong>`);
  if (usage?.output != null) parts.push(`输出 <strong>${usage.output.toLocaleString()}</strong>`);
  if (parts.length) usageLine.innerHTML = '🔢 tokens — ' + parts.join('，');
  if (parts.length) body.appendChild(usageLine);
  sectionsUsed.forEach((s) => {
    const block = document.createElement('div');
    block.className = 'section-block';
    const raw = valueToMarkdown(result?.[s.id]);
    block.innerHTML = `
      <div class="section-title">${escapeText(s.title)}</div>
      <div class="section-content"></div>
    `;
    const contentEl = block.querySelector('.section-content');
    renderRichContent(raw, contentEl);
    body.appendChild(block);
  });
  (aiSuggested || []).forEach((s) => {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.innerHTML = `
      <div class="section-title ai-suggested">${escapeText(s.title)}<span class="ai-badge">AI 生成</span></div>
      <div class="section-content"></div>
    `;
    const contentEl = block.querySelector('.section-content');
    renderRichContent(valueToMarkdown(s.content), contentEl);
    body.appendChild(block);
  });
  setItemStatus(idx, 'done');
  bindRetry(card, onRetry, idx, false);
}

export function renderItemError(idx, err, onRetry) {
  const card = getCard(idx);
  if (!card) return;
  card._payload = null;
  const exportBtn = card.querySelector('[data-role="export"]');
  if (exportBtn) exportBtn.hidden = true;
  const body = card.querySelector('[data-role="body"]');
  body.innerHTML = '';
  const block = document.createElement('div');
  block.className = 'error-block';
  block.textContent = err?.message || String(err);
  const retryBtn = document.createElement('button');
  retryBtn.className = 'ghost retry';
  retryBtn.textContent = '重试';
  retryBtn.addEventListener('click', () => onRetry?.(idx));
  block.appendChild(document.createElement('br'));
  block.appendChild(retryBtn);
  body.appendChild(block);
  setItemStatus(idx, 'error');
}

function bindRetry(card, onRetry, idx, enable) {
  // placeholder; per-item retry button rendered only on error
}

export function updateProgress(done, total) {
  const text = document.getElementById('progressText');
  const fill = document.getElementById('progressFill');
  text.textContent = `${done} / ${total}`;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fill.style.width = pct + '%';
}

/* ---------------- rich content rendering ---------------- */
const PAGE_REF_RE = /\[\[page:(\d+)\]\]/g;

function substitutePageRefs(text) {
  return text.replace(PAGE_REF_RE, (_, n) => `<span class="page-ref">📄 见原文第 ${n} 页</span>`);
}

function renderRichContent(text, targetEl) {
  const withRefs = substitutePageRefs(text);
  let html;
  try {
    html = window.marked ? window.marked.parse(withRefs, { breaks: true, gfm: true }) : escapeText(withRefs);
  } catch {
    html = escapeText(withRefs);
  }
  if (window.DOMPurify) {
    html = window.DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'title', 'class'],
    });
  }
  targetEl.innerHTML = html;
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(targetEl, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        errorColor: '#e0524b',
      });
    } catch (e) {
      console.warn('KaTeX render failed:', e);
    }
  }
}

/* ---------------- markdown export ---------------- */
function generateMarkdown(filename, payload) {
  const { result, sectionsUsed, aiSuggested, pageCount, includedPages } = payload;
  const title = filename.replace(/\.pdf$/i, '');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const lines = [];
  lines.push(`# ${title}`, '');
  lines.push(`> 原始文件：\`${filename}\`  `);
  lines.push(`> 总页数：${pageCount}，分析页数：${includedPages}  `);
  lines.push(`> 生成时间：${stamp}`, '');
  for (const s of sectionsUsed) {
    const content = valueToMarkdown(result?.[s.id]).replace(
      PAGE_REF_RE,
      (_, n) => `_（见原论文第 ${n} 页）_`,
    );
    lines.push(`## ${s.title}`, '', content, '');
  }
  for (const s of aiSuggested || []) {
    const content = valueToMarkdown(s.content).replace(
      PAGE_REF_RE,
      (_, n) => `_（见原论文第 ${n} 页）_`,
    );
    lines.push(`## ${s.title} _(AI 生成)_`, '', content, '');
  }
  return lines.join('\n');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function replaceExt(name, ext) {
  return name.replace(/\.[^.]+$/, '') + ext;
}

function downloadText(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/* ---------------- chat view ---------------- */

const chatState = {
  papers: [],
  selected: new Set(),
  includeImages: false,
  messages: [],
  lastUsage: null,
  onSend: null,
};

const CHAT_SYSTEM_INSTRUCTION = [
  '你是一位严谨的学术论文阅读助手。用户已经分析过下方列出的论文，并希望进一步提问。',
  '请基于这些论文回答用户的问题。回答时遵守：',
  '1. 优先引用论文中的具体信息（术语、数据、公式、页码），不臆测。若上下文不足以回答，请明确说明。',
  '2. **数学**：涉及推导/公式时务必使用 LaTeX——行内 `$...$`，独立 `$$...$$`（聊天上下文中 LaTeX 反斜杠无需额外转义）。',
  '3. **表格**：涉及对比、超参列表、指标对照等结构化信息时，使用 Markdown 表格语法。',
  '4. **论文中的图/示意图/流程图**：不要尝试嵌入图片。若需引用，用一句话简要描述图的内容，并以「（详见原文第 N 页）」形式注明页码，让用户自行查阅。',
  '5. 回答可使用 Markdown（标题、列表、加粗等）以提升结构与可读性。',
].join('\n');

export function setChatPapers(papers) {
  chatState.papers = papers || [];
  chatState.selected = new Set(chatState.papers.map((_, i) => i));
  chatState.messages = [];
  chatState.lastUsage = null;
  syncChatVisibility();
  renderChatPaperList();
  renderChatMessages();
  refreshChatMonitor();
}

export function bindChatActions({ onSend }) {
  chatState.onSend = onSend;
  const includeBox = document.getElementById('chatIncludeImages');
  const sendBtn = document.getElementById('chatSendBtn');
  const clearBtn = document.getElementById('chatClearBtn');
  const input = document.getElementById('chatInput');

  includeBox.addEventListener('change', () => {
    chatState.includeImages = includeBox.checked;
    refreshChatMonitor();
  });
  input.addEventListener('input', refreshChatMonitor);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitChatMessage();
    }
  });
  sendBtn.addEventListener('click', submitChatMessage);
  clearBtn.addEventListener('click', () => {
    if (!chatState.messages.length) return;
    if (!confirm('确定清空当前对话？')) return;
    chatState.messages = [];
    chatState.lastUsage = null;
    renderChatMessages();
    refreshChatMonitor();
  });
  refreshChatMonitor();
}

function syncChatVisibility() {
  const empty = document.getElementById('chatEmpty');
  const container = document.getElementById('chatContainer');
  if (!empty || !container) return;
  if (chatState.papers.length === 0) {
    empty.hidden = false;
    container.hidden = true;
  } else {
    empty.hidden = true;
    container.hidden = false;
  }
}

function renderChatPaperList() {
  const root = document.getElementById('chatPaperList');
  if (!root) return;
  root.innerHTML = '';
  chatState.papers.forEach((p, idx) => {
    const item = document.createElement('label');
    item.className = 'chat-paper-item';
    item.innerHTML = `
      <input type="checkbox" data-idx="${idx}" ${chatState.selected.has(idx) ? 'checked' : ''} />
      <div>
        <span class="pp-name">${escapeText(p.filename)}</span>
        <span class="pp-meta">${p.pageCount} 页 · 已分析 ${p.includedPages} 页</span>
      </div>
    `;
    item.querySelector('input').addEventListener('change', (e) => {
      const i = Number(e.target.dataset.idx);
      if (e.target.checked) chatState.selected.add(i);
      else chatState.selected.delete(i);
      refreshChatMonitor();
    });
    root.appendChild(item);
  });
}

function buildContextText() {
  const selectedPapers = [...chatState.selected]
    .sort((a, b) => a - b)
    .map((i) => chatState.papers[i])
    .filter(Boolean);
  if (!selectedPapers.length) return { systemPrompt: CHAT_SYSTEM_INSTRUCTION, images: [] };
  const parts = [CHAT_SYSTEM_INSTRUCTION, '', '=== 论文资料 ==='];
  for (let i = 0; i < selectedPapers.length; i++) {
    const p = selectedPapers[i];
    parts.push(`\n--- 论文 ${i + 1}：${p.filename} ---`);
    parts.push(`总页数：${p.pageCount}；分析页数：${p.includedPages}`);
    for (const s of p.sectionsUsed) {
      const v = p.analysis?.[s.id];
      if (v === undefined || v === null || v === '') continue;
      parts.push(`\n【${s.title}】`);
      parts.push(typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  const images = chatState.includeImages
    ? selectedPapers.flatMap((p) => p.pageImages || [])
    : [];
  return { systemPrompt: parts.join('\n'), images };
}

export function getChatContext() {
  return buildContextText();
}

function refreshChatMonitor() {
  const cfg = getConfig();
  const limit = cfg.contextLimit || 128000;
  const input = document.getElementById('chatInput');
  const userText = input?.value || '';
  const { systemPrompt, images } = buildContextText();
  const turns = chatState.messages.map((m) => ({ role: m.role, text: m.text }));
  // attach images to first synthesized turn for estimate parity with the actual send.
  const estTurns = [
    ...turns,
    { role: 'user', text: userText, images },
  ];
  const est = estimateChatTokens(systemPrompt, estTurns);
  const estEl = document.getElementById('chatEstTokens');
  const limitEl = document.getElementById('chatLimit');
  const fill = document.getElementById('chatUsageFill');
  const warn = document.getElementById('chatWarning');
  const sendBtn = document.getElementById('chatSendBtn');
  const composerHint = document.getElementById('composerHint');
  const lastEl = document.getElementById('chatLastTokens');

  if (estEl) estEl.textContent = est.toLocaleString();
  if (limitEl) limitEl.textContent = limit.toLocaleString();
  if (fill) {
    const pct = Math.min(100, Math.round((est / limit) * 100));
    fill.style.width = pct + '%';
    fill.classList.toggle('warning', pct >= 70 && pct < 95);
    fill.classList.toggle('danger', pct >= 95);
  }
  if (warn) {
    if (est >= limit) {
      warn.hidden = false;
      warn.textContent = `预估已超出上下文上限 ${(est - limit).toLocaleString()} tokens，请取消勾选部分论文 / 关闭"附带图片" / 调高上限。`;
    } else if (est >= limit * 0.85) {
      warn.hidden = false;
      warn.textContent = '即将达到上下文上限，请注意控制对话长度。';
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }
  }
  if (lastEl) {
    const u = chatState.lastUsage;
    lastEl.textContent = u
      ? `${(u.input ?? '?').toLocaleString?.() ?? u.input} 入 / ${(u.output ?? '?').toLocaleString?.() ?? u.output} 出`
      : '—';
  }
  if (sendBtn) {
    const can = userText.trim().length > 0 && chatState.selected.size > 0 && est < limit;
    sendBtn.disabled = !can;
  }
  if (composerHint) {
    const sel = chatState.selected.size;
    composerHint.textContent =
      sel === 0 ? '请至少选择一篇论文作为上下文' : `已选 ${sel} 篇 · Cmd/Ctrl + Enter 发送`;
  }
}

async function submitChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !chatState.onSend || chatState.selected.size === 0) return;
  chatState.messages.push({ role: 'user', text });
  renderChatMessages();
  input.value = '';
  refreshChatMonitor();

  const typingEl = appendTypingBubble();
  try {
    const { systemPrompt, images } = buildContextText();
    const turns = [];
    for (let i = 0; i < chatState.messages.length; i++) {
      const m = chatState.messages[i];
      const isFirstUser = m.role === 'user' && turns.findIndex((t) => t.role === 'user') === -1;
      if (isFirstUser && images.length) {
        turns.push({ role: 'user', text: m.text, images });
      } else {
        turns.push({ role: m.role, text: m.text });
      }
    }
    const { text: replyText, usage } = await chatState.onSend({ systemPrompt, turns });
    chatState.lastUsage = usage || null;
    chatState.messages.push({ role: 'assistant', text: replyText });
    typingEl.remove();
    renderChatMessages();
  } catch (err) {
    typingEl.remove();
    chatState.messages.push({ role: 'assistant', text: '⚠️ ' + (err?.message || String(err)), error: true });
    renderChatMessages();
  } finally {
    refreshChatMonitor();
  }
}

function appendTypingBubble() {
  const msgs = document.getElementById('chatMessages');
  const wrap = document.createElement('div');
  wrap.className = 'chat-message assistant typing';
  wrap.innerHTML = '<div class="avatar">AI</div><div class="bubble">思考中…</div>';
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function renderChatMessages() {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  msgs.innerHTML = '';
  if (!chatState.messages.length) {
    msgs.innerHTML = '<p class="empty-state">提出你的第一个问题吧（例如：「论文方法的核心公式是什么？请引用论文中的公式」）。</p>';
    return;
  }
  chatState.messages.forEach((m) => {
    const wrap = document.createElement('div');
    wrap.className = 'chat-message ' + (m.role === 'user' ? 'user' : 'assistant') + (m.error ? ' error' : '');
    wrap.innerHTML = `
      <div class="avatar">${m.role === 'user' ? '我' : 'AI'}</div>
      <div class="bubble"></div>
    `;
    const bubble = wrap.querySelector('.bubble');
    if (m.role === 'assistant' && !m.error) {
      renderRichContent(m.text || '', bubble);
    } else {
      bubble.textContent = m.text || '';
    }
    msgs.appendChild(wrap);
  });
  msgs.scrollTop = msgs.scrollHeight;
}

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
  reportLanguageDirective,
} from './config.js';
import { estimateChatTokens, estimateTextTokens, fetchModelList } from './llmClient.js';
import { API_PRESETS, MODEL_PRESETS, guessProviderKey } from './presets.js';

const VIEWS = ['settings', 'upload', 'results', 'chat'];

const ICON_DOC =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.4H7.6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2V8.2Z"/><path d="M14 3.4V8.2h4.4"/><path d="M8.9 13h6.2M8.9 16.3h4"/></svg>';
const ICON_DOWNLOAD =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.4v10"/><path d="m7.9 10.6 4.1 4.1 4.1-4.1"/><path d="M5.2 19.4h13.6"/></svg>';
const ICON_USER =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.6" r="3.5"/><path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0"/></svg>';

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
  setReportLanguage(cfg.reportLanguage);
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
  select.innerHTML = '<option value="">— Select a saved profile —</option>';
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
  keyInput.placeholder = isOllama ? 'Local Ollama needs no API key' : 'sk-...';
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

/* ---------------- report language ---------------- */

function getReportLanguage() {
  return document.querySelector('input[name="reportLanguage"]:checked')?.value === 'zh' ? 'zh' : 'en';
}

function setReportLanguage(value) {
  const target = value === 'zh' ? 'zh' : 'en';
  const el = document.querySelector(`input[name="reportLanguage"][value="${target}"]`);
  if (el) el.checked = true;
}

function readConfigForm() {
  return {
    apiUrl: document.getElementById('apiUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    apiFormat: document.getElementById('apiFormat').value,
    model: document.getElementById('modelName').value.trim(),
  };
}

/* ---------------- preset comboboxes (API URL / model) ---------------- */
/* 输入框本身仍是自由文本，下拉只提供建议；选中即写入输入框。 */

const FORMAT_NOTE = {
  anthropic: 'Anthropic format',
  ollama: 'Local · no API key',
};

let combosReady = false;

function initPresetCombos() {
  if (combosReady) return;
  const apiRoot = document.querySelector('[data-combo="api"]');
  const modelRoot = document.querySelector('[data-combo="model"]');
  if (!apiRoot || !modelRoot) return;
  combosReady = true;

  initCombo(apiRoot, {
    buildGroups: () => [
      {
        items: API_PRESETS.map((p) => ({
          value: p.url,
          label: p.label,
          note: p.note || FORMAT_NOTE[p.format] || '',
          format: p.format,
        })),
      },
    ],
    footNote: 'Base URL only — the version segment and endpoint path are added automatically.',
    onPick: (item) => {
      if (!item.format) return;
      const formatSelect = document.getElementById('apiFormat');
      if (formatSelect.value !== item.format) {
        formatSelect.value = item.format;
        renderModelChips([]);
      }
      updateProviderUI();
    },
  });

  initCombo(modelRoot, {
    buildGroups: () => {
      const active = guessProviderKey(readConfigForm());
      const groups = MODEL_PRESETS.map((g) => ({
        key: g.key,
        group: g.group,
        hint: g.key === active ? 'matches your endpoint' : '',
        items: g.items.map((m) => ({ value: m.id, label: m.id, note: m.note || '' })),
      }));
      groups.sort((a, b) => Number(b.key === active) - Number(a.key === active));
      return groups;
    },
    footNote: 'Vision-capable models only — this tool feeds the model page images. Any model id can also be typed by hand.',
  });
}

function initCombo(root, { buildGroups, onPick, footNote }) {
  const input = root.querySelector('input');
  const toggle = root.querySelector('[data-combo-toggle]');
  const menu = root.querySelector('[data-combo-menu]');
  let options = [];
  let active = -1;
  // 用箭头 / 输入框打开时浏览全部；只有真正在输入时才按关键字过滤
  let filtering = false;

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    root.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    active = -1;
    filtering = false;
  }

  function open({ filter = false } = {}) {
    filtering = filter;
    render();
    menu.hidden = false;
    root.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    const current = options.findIndex((o) => o.item.value === input.value.trim());
    if (current >= 0) options[current].el.scrollIntoView({ block: 'nearest' });
  }

  function highlight(next) {
    if (!options.length) return;
    if (active >= 0) options[active].el.classList.remove('active');
    active = (next + options.length) % options.length;
    const el = options[active].el;
    el.classList.add('active');
    el.scrollIntoView({ block: 'nearest' });
  }

  function pick(item) {
    input.value = item.value;
    close();
    onPick?.(item);
    input.focus();
  }

  function render() {
    const query = filtering ? input.value.trim().toLowerCase() : '';
    const current = input.value.trim();
    menu.innerHTML = '';
    options = [];
    active = -1;
    for (const group of buildGroups()) {
      const matches = group.items.filter(
        (it) =>
          !query ||
          it.value.toLowerCase().includes(query) ||
          (it.label || '').toLowerCase().includes(query) ||
          (group.group || '').toLowerCase().includes(query),
      );
      if (!matches.length) continue;
      if (group.group) {
        const head = document.createElement('div');
        head.className = 'combo-group';
        head.innerHTML =
          escapeText(group.group) +
          (group.hint ? `<span class="cg-hint">${escapeText(group.hint)}</span>` : '');
        menu.appendChild(head);
      }
      for (const item of matches) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'combo-option';
        btn.setAttribute('role', 'option');
        const showValue = item.label && item.label !== item.value;
        if (item.value === current) btn.classList.add('selected');
        btn.innerHTML =
          '<span class="co-main">' +
          `<span class="co-label">${escapeText(item.label || item.value)}</span>` +
          (item.note ? `<span class="co-note">${escapeText(item.note)}</span>` : '') +
          '</span>' +
          (showValue ? `<span class="co-value">${escapeText(item.value)}</span>` : '');
        // mousedown 上阻止默认行为，焦点留在输入框里，click 才能稳定触发
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => pick(item));
        menu.appendChild(btn);
        options.push({ el: btn, item });
      }
    }
    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'combo-empty';
      empty.textContent = 'No preset matches — type your own value.';
      menu.appendChild(empty);
    } else if (footNote) {
      const foot = document.createElement('div');
      foot.className = 'combo-foot';
      foot.textContent = footNote;
      menu.appendChild(foot);
    }
  }

  toggle.addEventListener('mousedown', (e) => e.preventDefault());
  toggle.addEventListener('click', () => {
    if (menu.hidden) {
      open();
      input.focus();
    } else {
      close();
    }
  });

  input.addEventListener('focus', () => open());
  input.addEventListener('input', () => {
    filtering = true;
    if (menu.hidden) open({ filter: true });
    else render();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (menu.hidden) open();
      highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      if (!menu.hidden && active >= 0) {
        e.preventDefault();
        pick(options[active].item);
      } else {
        close();
      }
    } else if (e.key === 'Escape' && !menu.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target)) close();
  });
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
      <input type="text" data-action="title" data-idx="${idx}" value="${escapeAttr(s.title)}" placeholder="Section title" />
      <input type="text" class="prompt-input" data-action="prompt" data-idx="${idx}" value="${escapeAttr(s.prompt)}" placeholder="Instruction for the model" />
      <button class="remove" data-action="remove" data-idx="${idx}" title="Remove">×</button>
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
    btn.textContent = showing ? 'Show' : 'Hide';
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
    toast(`Switched to “${p.name}”`, 'success');
  });

  // 删除选中的配置档案
  document.getElementById('deleteProfileBtn').addEventListener('click', () => {
    const select = document.getElementById('profileSelect');
    const id = select.value;
    if (!id) return;
    const p = getProfiles().find((x) => x.id === id);
    if (!confirm(`Delete the profile “${p?.name || id}”?`)) return;
    deleteProfile(id);
    renderProfiles();
    toast('Profile deleted');
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
      toast('Enter an API URL first', 'error');
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Fetching…';
    try {
      const models = await fetchModelList(form);
      renderModelChips(models);
      toast(models.length ? `Found ${models.length} models` : 'No models available', models.length ? 'success' : 'error');
    } catch (err) {
      renderModelChips([]);
      const tip = form.apiFormat === 'ollama'
        ? ' — check that Ollama is running and was started with OLLAMA_ORIGINS=*'
        : '';
      toast('Could not fetch models' + tip + ' (' + (err?.message || err) + ')', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  document.getElementById('addSectionBtn').addEventListener('click', () => {
    const sections = getSections();
    sections.push({
      id: genSectionId(),
      title: 'New section',
      prompt: 'Describe what you want the model to produce for this section.',
      enabled: true,
    });
    setSections(sections);
    renderSectionEditor();
  });

  document.getElementById('resetSectionsBtn').addEventListener('click', () => {
    resetSections();
    renderSectionEditor();
    toast('Default sections restored');
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
    const reportLanguage = getReportLanguage();
    const needKey = apiFormat !== 'ollama';
    if (!apiUrl || !model || (needKey && !apiKey)) {
      toast(
        needKey
          ? 'API URL, API key and model are all required'
          : 'API URL and model are both required',
        'error',
      );
      return;
    }
    const next = setConfig({
      apiUrl,
      apiKey,
      apiFormat,
      model,
      maxPages,
      contextLimit,
      rememberKey,
      autoSuggestSections,
      reportLanguage,
    });
    rememberProfile(next);
    renderProfiles();
    toast('Configuration saved', 'success');
    onSaved?.();
  });

  document.getElementById('clearStorageBtn').addEventListener('click', () => {
    if (!confirm('Clear all local storage (API details and custom sections)?')) return;
    clearAllStorage();
    renderSettings();
    toast('Local storage cleared');
  });

  // 语言是即时生效的偏好，改完就落盘，不必等「Save configuration」
  for (const radio of document.querySelectorAll('input[name="reportLanguage"]')) {
    radio.addEventListener('change', () => {
      const lang = getReportLanguage();
      setConfig({ reportLanguage: lang });
      toast(lang === 'zh' ? '报告输出语言：中文' : 'Report language: English', 'success');
    });
  }

  initPresetCombos();
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
        <span class="doc-ico">${ICON_DOC}</span>
        <span>${escapeText(f.name)}</span>
        <span class="size">${formatSize(f.size)}</span>
      </div>
      <button class="remove" title="Remove">×</button>
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
          <span class="doc-ico">${ICON_DOC}</span>
          <span>${escapeText(f.name)}</span>
        </div>
        <div class="right">
          <button class="export-btn" data-role="export" title="Export as Markdown" hidden>${ICON_DOWNLOAD}Markdown</button>
          <span class="badge pending" data-role="badge">Queued</span>
          <span class="toggle">▼</span>
        </div>
      </div>
      <div class="paper-card-body" data-role="body">
        <p class="hint" data-role="status">Waiting to start…</p>
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
    pending: ['Queued', 'pending'],
    processing: ['Working', 'processing'],
    done: ['Done', 'done'],
    error: ['Failed', 'error'],
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

/* Normalise a section value (string / array / object) into readable Markdown.
   Models sometimes ignore the "value must be a string" rule and return
   [{point, benefit}, ...]; this keeps a raw JSON dump off the screen. */
function valueToMarkdown(value) {
  if (value === undefined || value === null || value === '') {
    return '_(the model returned nothing for this section)_';
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
  meta.textContent = `${pageCount} pages total, ${includedPages} analysed`;
  body.appendChild(meta);
  const usageLine = document.createElement('p');
  usageLine.className = 'usage-line';
  const parts = [];
  if (typeof estimatedTokens === 'number') parts.push(`estimated in <strong>${estimatedTokens.toLocaleString()}</strong>`);
  if (usage?.input != null) parts.push(`actual in <strong>${usage.input.toLocaleString()}</strong>`);
  if (usage?.output != null) parts.push(`out <strong>${usage.output.toLocaleString()}</strong>`);
  if (parts.length) usageLine.innerHTML = 'Tokens — ' + parts.join(' · ');
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
      <div class="section-title ai-suggested">${escapeText(s.title)}<span class="ai-badge">AI added</span></div>
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
  retryBtn.textContent = 'Retry';
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
  const zh = getConfig().reportLanguage === 'zh';
  return text.replace(
    PAGE_REF_RE,
    (_, n) => `<span class="page-ref">${zh ? `见原文第 ${n} 页` : `Page ${n}`}</span>`,
  );
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
  const zh = getConfig().reportLanguage === 'zh';
  const title = filename.replace(/\.pdf$/i, '');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const pageRef = (_, n) => (zh ? `_（见原论文第 ${n} 页）_` : `_(see page ${n} of the paper)_`);
  const lines = [];
  lines.push(`# ${title}`, '');
  if (zh) {
    lines.push(`> 原始文件：\`${filename}\`  `);
    lines.push(`> 总页数：${pageCount}，分析页数：${includedPages}  `);
    lines.push(`> 生成时间：${stamp}`, '');
  } else {
    lines.push(`> Source file: \`${filename}\`  `);
    lines.push(`> ${pageCount} pages total, ${includedPages} analysed  `);
    lines.push(`> Generated: ${stamp}`, '');
  }
  for (const s of sectionsUsed) {
    const content = valueToMarkdown(result?.[s.id]).replace(PAGE_REF_RE, pageRef);
    lines.push(`## ${s.title}`, '', content, '');
  }
  for (const s of aiSuggested || []) {
    const content = valueToMarkdown(s.content).replace(PAGE_REF_RE, pageRef);
    lines.push(`## ${s.title} ${zh ? '_(AI 生成)_' : '_(AI added)_'}`, '', content, '');
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

function chatSystemInstruction() {
  return [
    'You are a rigorous academic-paper reading assistant. The user has already analysed the papers listed below and now wants to ask follow-up questions.',
    'Answer from those papers, and follow these rules:',
    '1. Prefer concrete evidence from the papers (terminology, numbers, equations, page references) over speculation. If the context does not contain the answer, say so plainly.',
    '2. **Mathematics**: whenever a derivation or formula is involved, use LaTeX — inline `$...$`, display `$$...$$` (no extra backslash escaping is needed in chat).',
    '3. **Tables**: use Markdown tables for structured information such as comparisons, hyper-parameter lists and metric breakdowns.',
    '4. **Figures and diagrams in the papers**: never try to embed an image. Describe the figure in one sentence and cite the page as `(see page N)` so the user can look it up.',
    '5. Markdown (headings, lists, bold) is welcome where it improves structure and readability.',
    `6. **Language**: ${reportLanguageDirective(getConfig().reportLanguage)}`,
  ].join('\n');
}

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
    if (!confirm('Clear the current conversation?')) return;
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
        <span class="pp-meta">${p.pageCount} pages · ${p.includedPages} analysed</span>
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
  const instruction = chatSystemInstruction();
  if (!selectedPapers.length) return { systemPrompt: instruction, images: [] };
  const parts = [instruction, '', '=== Paper material ==='];
  for (let i = 0; i < selectedPapers.length; i++) {
    const p = selectedPapers[i];
    parts.push(`\n--- Paper ${i + 1}: ${p.filename} ---`);
    parts.push(`${p.pageCount} pages total, ${p.includedPages} analysed`);
    for (const s of p.sectionsUsed) {
      const v = p.analysis?.[s.id];
      if (v === undefined || v === null || v === '') continue;
      parts.push(`\n[${s.title}]`);
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
      warn.textContent = `Estimated input is ${(est - limit).toLocaleString()} tokens over the context limit. Deselect some papers, turn off page images, or raise the limit.`;
    } else if (est >= limit * 0.85) {
      warn.hidden = false;
      warn.textContent = 'Approaching the context limit — keep an eye on the conversation length.';
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }
  }
  if (lastEl) {
    const u = chatState.lastUsage;
    lastEl.textContent = u
      ? `${(u.input ?? '?').toLocaleString?.() ?? u.input} in / ${(u.output ?? '?').toLocaleString?.() ?? u.output} out`
      : '—';
  }
  if (sendBtn) {
    const can = userText.trim().length > 0 && chatState.selected.size > 0 && est < limit;
    sendBtn.disabled = !can;
  }
  if (composerHint) {
    const sel = chatState.selected.size;
    composerHint.textContent =
      sel === 0
        ? 'Select at least one paper as context'
        : `${sel} paper${sel > 1 ? 's' : ''} selected · Cmd/Ctrl + Enter to send`;
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
  wrap.innerHTML = '<div class="avatar">AI</div><div class="bubble">Thinking…</div>';
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function renderChatMessages() {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  msgs.innerHTML = '';
  if (!chatState.messages.length) {
    msgs.innerHTML =
      '<p class="empty-state">Ask your first question — for example, “What is the core equation of the method? Quote it from the paper.”</p>';
    return;
  }
  chatState.messages.forEach((m) => {
    const wrap = document.createElement('div');
    wrap.className = 'chat-message ' + (m.role === 'user' ? 'user' : 'assistant') + (m.error ? ' error' : '');
    wrap.innerHTML = `
      <div class="avatar">${m.role === 'user' ? ICON_USER : 'AI'}</div>
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

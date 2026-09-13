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
  isConfigReady,
} from './config.js';
import { estimateChatTokens, fetchModelList, clampOutputTokens } from './llmClient.js';
import { API_PRESETS, MODEL_PRESETS, guessProviderKey, modelVisionSupport } from './presets.js';
import { SUPPORTED_ACCEPT, isSupportedFile, unsupportedReason, fileKind } from './docProcessor.js';

const VIEWS = ['upload', 'plan', 'results', 'chat', 'model'];

const ICON_DOC =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.4H7.6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2V8.2Z"/><path d="M14 3.4V8.2h4.4"/><path d="M8.9 13h6.2M8.9 16.3h4"/></svg>';
const ICON_DOWNLOAD =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.4v10"/><path d="m7.9 10.6 4.1 4.1 4.1-4.1"/><path d="M5.2 19.4h13.6"/></svg>';
const ICON_USER =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.6" r="3.5"/><path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0"/></svg>';

export function switchView(name) {
  if (!VIEWS.includes(name)) return;
  for (const v of VIEWS) {
    const el = document.getElementById('view-' + v);
    if (el) el.hidden = v !== name;
  }
  for (const tab of document.querySelectorAll('.tab, .side-link[data-view]')) {
    tab.classList.toggle('active', tab.dataset.view === name);
  }
  // 文档列是独立滚动容器，换视图时回到顶部
  document.getElementById('content')?.scrollTo({ top: 0 });
}

/* ---------------- rail status block ---------------- */
export function renderConnectionStatus() {
  const box = document.getElementById('connStatus');
  if (!box) return;
  const cfg = getConfig();
  const ready = isConfigReady();
  const modelEl = box.querySelector('[data-role="model"]');
  const hostEl = box.querySelector('[data-role="host"]');
  box.classList.toggle('ready', ready);
  if (modelEl) modelEl.textContent = ready ? cfg.model : 'Not configured';
  if (hostEl) {
    hostEl.textContent = ready
      ? `${apiHost(cfg.apiUrl)} · ${cfg.apiFormat}`
      : 'Open Model & API to connect a model';
  }
  box.title = ready ? `${cfg.model} — ${cfg.apiUrl}` : 'No model configured yet';
}

function apiHost(url) {
  const raw = String(url || '').trim();
  if (!raw) return 'no endpoint';
  try {
    return new URL(raw.includes('://') ? raw : 'https://' + raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0];
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

/* ---------------- model & api view ---------------- */
export function renderModelView() {
  const cfg = getConfig();
  document.getElementById('apiUrl').value = cfg.apiUrl;
  document.getElementById('apiKey').value = cfg.apiKey;
  document.getElementById('apiFormat').value = cfg.apiFormat;
  document.getElementById('modelName').value = cfg.model;
  // 0 表示「不设上限，交给模型自己」——输入框留空
  document.getElementById('contextLimit').value = cfg.contextLimit || '';
  document.getElementById('maxOutputTokens').value = cfg.maxOutputTokens || '';
  document.getElementById('rememberKey').checked = cfg.rememberKey;
  renderProfiles();
  updateProviderUI();
  renderModelChips([]);
  renderConnectionStatus();
}

/* ---------------- reading plan view ---------------- */
export function renderPlanView() {
  const cfg = getConfig();
  document.getElementById('maxPages').value = cfg.maxPages;
  document.getElementById('autoSuggestSections').checked = cfg.autoSuggestSections;
  setReportLanguage(cfg.reportLanguage);
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
  document.getElementById('contextLimit').value = p.contextLimit || '';
  document.getElementById('maxOutputTokens').value = p.maxOutputTokens || '';
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
  updateVisionHint();
}

/* ---------------- 纯文本模型提醒 ----------------
   PDF 与图片是逐页渲染成图片喂给模型的，纯文本模型只会返回空章节。
   模型确定不支持视觉时才提示，拿不准（modelVisionSupport → 'unknown'）就不打扰。 */

/** 当前表单里选的模型是否已知不支持视觉 */
function modelIsTextOnly() {
  const el = document.getElementById('modelName');
  return !!el && modelVisionSupport(el.value) === 'no';
}

/** Model & API 页：模型输入框下方的提示 */
function updateVisionHint() {
  const hint = document.getElementById('visionHint');
  if (hint) hint.hidden = !modelIsTextOnly();
}

const VISION_KINDS = new Set(['pdf', 'image']);

/** Upload 页：排队文件里有 PDF / 图片、而配置的模型读不了图时才提示 */
export function refreshVisionWarning(files = uploadFiles) {
  const box = document.getElementById('uploadVisionWarn');
  if (!box) return;
  const cfg = getConfig();
  const blocked = (files || []).filter((f) => VISION_KINDS.has(fileKind(f)));
  if (!blocked.length || modelVisionSupport(cfg.model) !== 'no') {
    box.hidden = true;
    return;
  }
  const pdfs = blocked.filter((f) => fileKind(f) === 'pdf').length;
  const images = blocked.length - pdfs;
  const what = [
    pdfs ? `${pdfs} PDF${pdfs > 1 ? 's' : ''}` : '',
    images ? `${images} image${images > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' and ');
  box.innerHTML =
    `<strong>${escapeText(cfg.model)} has no vision input</strong>, so the ${escapeText(what)} in this list ` +
    'will come back empty — PDF pages and images are sent to the model as page images. ' +
    'Switch to a vision-capable model in <strong>Model &amp; API</strong>, or keep only Word, Markdown and plain-text documents.';
  box.hidden = false;
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
      updateVisionHint();
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
    footNote: 'Mostly vision-capable models — PDFs and images are fed as page images; entries marked no vision read Word, Markdown and plain text only. Any model id can also be typed by hand.',
    onPick: () => updateVisionHint(),
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

export function bindModelActions({ onSaved }) {
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
      contextLimit: p.contextLimit || 0,
      maxOutputTokens: p.maxOutputTokens || 0,
    });
    document.getElementById('deleteProfileBtn').disabled = false;
    renderConnectionStatus();
    // 这里和 Save 一样是一次完整的配置写入，跟着变的东西也得一样：
    // 上下文上限换了 Chat 的占比条与 Send 按钮要重算，模型换了 Upload 页的视觉提示要重判
    refreshChatMonitor();
    refreshVisionWarning();
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

  // 手输模型名时也要更新「这个模型读不了图」的提示
  document.getElementById('modelName').addEventListener('input', () => updateVisionHint());

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

  document.getElementById('saveConfigBtn').addEventListener('click', () => {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiFormat = document.getElementById('apiFormat').value;
    const model = document.getElementById('modelName').value.trim();
    // 留空（或填 0 / 非法值）= 0 = 不做本地上限检查，交给模型自己的上限
    const contextParsed = parseInt(document.getElementById('contextLimit').value, 10);
    const contextLimit = Number.isFinite(contextParsed) && contextParsed > 0 ? Math.max(1000, contextParsed) : 0;
    // 留空 = 0 = 回到 llmClient 的默认值（DEFAULT_MAX_OUTPUT_TOKENS）。
    // 上下界统一由 clampOutputTokens 说了算，免得界面只夹下界、发出去的又是另一个数
    const maxOutputTokens = clampOutputTokens(document.getElementById('maxOutputTokens').value);
    const rememberKey = document.getElementById('rememberKey').checked;
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
      contextLimit,
      maxOutputTokens,
      rememberKey,
    });
    rememberProfile(next);
    // 夹过界的值回填进输入框：框里显示的必须就是真正会发出去的那个数，
    // 否则填了 9999999 的人会一直以为自己设的是 9999999
    document.getElementById('contextLimit').value = next.contextLimit || '';
    document.getElementById('maxOutputTokens').value = next.maxOutputTokens || '';
    renderProfiles();
    renderConnectionStatus();
    updateVisionHint();
    refreshChatMonitor(); // 上下文上限改了，Chat 侧的占比条要跟着变
    toast('Configuration saved', 'success');
    onSaved?.();
  });

  document.getElementById('clearStorageBtn').addEventListener('click', () => {
    if (!confirm('Clear all local storage (API details and custom sections)?')) return;
    clearAllStorage();
    renderModelView();
    renderPlanView();
    toast('Local storage cleared');
  });

  initPresetCombos();
}

/* ---------------- reading plan actions ----------------
   这一页上的设置都是改即存，不需要单独的保存按钮。 */
export function bindPlanActions({ onStartAnalysis, onResuggest, onSelectAllFocus }) {
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

  // 语言是即时生效的偏好，改完就落盘
  for (const radio of document.querySelectorAll('input[name="reportLanguage"]')) {
    radio.addEventListener('change', () => {
      const lang = getReportLanguage();
      setConfig({ reportLanguage: lang });
      toast(lang === 'zh' ? '报告输出语言：中文' : 'Report language: English', 'success');
    });
  }

  const maxPagesInput = document.getElementById('maxPages');
  maxPagesInput.addEventListener('change', () => {
    const maxPages = Math.max(0, parseInt(maxPagesInput.value, 10) || 0);
    maxPagesInput.value = maxPages;
    setConfig({ maxPages });
    renderUploadStats(uploadFiles);
  });

  document.getElementById('autoSuggestSections').addEventListener('change', (e) => {
    setConfig({ autoSuggestSections: e.target.checked });
  });

  document.getElementById('startAnalysisBtn').addEventListener('click', () => onStartAnalysis?.());
  document.getElementById('resuggestBtn').addEventListener('click', () => onResuggest?.());
  document.getElementById('selectAllFocusBtn').addEventListener('click', () => onSelectAllFocus?.());
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ---------------- upload view ---------------- */
/* Reading plan 上的 Max pages 改动要刷新上传统计，这里留一个引用 */
let uploadFiles = [];

export function bindUploadActions({ files, onScan, onFilesChanged }) {
  uploadFiles = files;
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const scanBtn = document.getElementById('scanBtn');
  const clearBtn = document.getElementById('clearFilesBtn');
  const fullDocBox = document.getElementById('suggestFullDoc');

  fileInput.accept = SUPPORTED_ACCEPT;
  fullDocBox.checked = getConfig().suggestFullDoc;
  fullDocBox.addEventListener('change', () => {
    setConfig({ suggestFullDoc: fullDocBox.checked });
  });

  const refresh = () => {
    renderFileList(files, refresh);
    updateUploadButtons(files);
    onFilesChanged?.(files);
  };
  renderFileList(files, refresh);
  renderUploadStats(files);

  const accept = (incoming) => {
    const rejected = addFiles(incoming, files);
    if (rejected.length) toast(unsupportedReason(rejected[0]), 'error');
    refresh();
  };

  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    accept(Array.from(fileInput.files || []));
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    accept(Array.from(e.dataTransfer.files || []));
  });

  clearBtn.addEventListener('click', () => {
    files.length = 0;
    refresh();
  });

  scanBtn.addEventListener('click', () => {
    if (!files.length) return;
    onScan?.(files.slice());
  });
}

/** @returns {File[]} 被拒绝的文件（格式不支持） */
function addFiles(incoming, store) {
  const rejected = [];
  for (const f of incoming) {
    if (!isSupportedFile(f)) {
      rejected.push(f);
      continue;
    }
    if (store.some((s) => s.name === f.name && s.size === f.size)) continue;
    store.push(f);
  }
  return rejected;
}

const KIND_LABEL = { pdf: 'PDF', image: 'Image', word: 'Word', text: 'Text' };

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
        <span class="size">${KIND_LABEL[fileKind(f)] || 'File'} · ${formatSize(f.size)}</span>
      </div>
      <button class="remove" title="Remove">×</button>
    `;
    row.querySelector('.remove').addEventListener('click', () => {
      files.splice(idx, 1);
      refresh();
    });
    list.appendChild(row);
  });
}

function updateUploadButtons(files) {
  const empty = files.length === 0;
  document.getElementById('scanBtn').disabled = empty;
  document.getElementById('clearFilesBtn').disabled = empty;
  renderUploadStats(files);
}

function renderUploadStats(files) {
  const box = document.getElementById('uploadStats');
  if (!box) return;
  const bytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const cap = getConfig().maxPages;
  const set = (role, value) => {
    const el = box.querySelector(`[data-role="${role}"]`);
    if (el) el.textContent = value;
  };
  set('files', String(files.length));
  set('size', (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1));
  set('cap', cap > 0 ? String(cap) : 'All');
  refreshVisionWarning(files);
}

/* ---------------- suggested focus (reading plan · step 1) ----------------
   docs: [{ name, status, docType, readerGoal, docSummary, sampled, items, selected:Set, error }] */

const FOCUS_STATUS = {
  idle: ['Not scanned', 'pending'],
  pending: ['Queued', 'pending'],
  working: ['Reading', 'processing'],
  done: ['Ready', 'done'],
  error: ['Failed', 'error'],
};

export function renderFocusSuggestions(docs, { onToggle, onRetry, onSuggest } = {}) {
  const root = document.getElementById('focusSuggestions');
  if (!root) return;
  root.innerHTML = '';
  const list = docs || [];

  if (!list.length) {
    root.innerHTML = '<p class="empty-state">Nothing suggested yet. Upload a document first.</p>';
    updateFocusButtons(list);
    return;
  }

  // 还有文档没扫过时就把"开始"做成这一栏里的主按钮，不让用户去猜该点哪里。
  // 判据是「有没有没扫过的文档」而不是「有没有角度」：先扫了 A 再添一份 B 的话，
  // 按后者算按钮会消失，而 idle 的 B 自己那一栏又只有一行说明、没有任何可点的东西，
  // 用户只剩 Re-suggest 一条路——那会连 A 一起重扫，把已经勾好的角度清空
  const busy = list.some((d) => d.status === 'working' || d.status === 'pending');
  const pendingDocs = list.filter((d) => !d.items?.length && d.status !== 'error');
  if (pendingDocs.length) {
    const cta = document.createElement('div');
    cta.className = 'actions';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.id = 'suggestFocusBtn';
    // 已经有文档扫过了，就只扫剩下那几份——重扫已有的既费钱，又会清掉勾选
    const partial = pendingDocs.length < list.length;
    btn.textContent = busy
      ? 'Reading the documents…'
      : partial
        ? `Suggest focus angles for ${pendingDocs.length} new document${pendingDocs.length > 1 ? 's' : ''}`
        : 'Suggest focus angles';
    btn.disabled = busy;
    btn.addEventListener('click', () => onSuggest?.(pendingDocs.map((d) => d.file)));
    cta.appendChild(btn);
    root.appendChild(cta);
  }

  list.forEach((doc, docIdx) => {
    const group = document.createElement('div');
    group.className = 'focus-group';
    const [label, cls] = FOCUS_STATUS[doc.status] || FOCUS_STATUS.pending;
    const badgeText = doc.status === 'done' && doc.docType ? doc.docType : label;
    group.innerHTML = `
      <div class="focus-group-head">
        <span class="panel-eyebrow">Document ${docIdx + 1}</span>
        <span class="focus-doc">${escapeText(doc.name)}</span>
        <span class="badge ${cls}">${escapeText(badgeText)}</span>
      </div>
    `;

    if (doc.status === 'error') {
      const err = document.createElement('div');
      err.className = 'error-block';
      err.textContent = doc.error || 'The model could not suggest anything for this document.';
      const retry = document.createElement('button');
      retry.className = 'ghost retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => onRetry?.(docIdx));
      err.appendChild(document.createElement('br'));
      err.appendChild(retry);
      group.appendChild(err);
      root.appendChild(group);
      return;
    }

    if (doc.status !== 'done') {
      const note = document.createElement('p');
      note.className = 'hint small';
      note.textContent =
        doc.status === 'working'
          ? doc.statusText || 'Reading the document and working out what is worth learning from it…'
          : doc.status === 'idle'
            ? 'Not scanned yet — nothing has been sent to the model.'
            : 'Waiting to start…';
      group.appendChild(note);
      root.appendChild(group);
      return;
    }

    if (doc.docSummary || doc.readerGoal || doc.sampled) {
      const note = document.createElement('p');
      note.className = 'hint small';
      note.textContent = [
        doc.docSummary,
        doc.readerGoal ? `Read for: ${doc.readerGoal}` : '',
        doc.sampled ? '(Suggested from a sample of the document.)' : '',
      ]
        .filter(Boolean)
        .join(' ');
      group.appendChild(note);
    }

    // 截断常常正好砍在角度列表中间：救回来的几条照常显示，但别让它们看着像模型的完整答案
    if (doc.truncated) {
      const warn = document.createElement('p');
      warn.className = 'notice-block';
      warn.textContent =
        'The model ran out of output room while writing these angles, so the list may be cut short. Raise “Max output tokens” in Model & API, then hit Re-suggest to see the rest.';
      group.appendChild(warn);
    }

    doc.items.forEach((item) => {
      const row = document.createElement('label');
      row.className = 'chat-paper-item';
      row.innerHTML = `
        <input type="checkbox" ${doc.selected?.has(item.id) ? 'checked' : ''} />
        <div>
          <span class="pp-name">${escapeText(item.title)}</span>
          <span class="pp-meta">${escapeText(item.why || '')}</span>
        </div>
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        onToggle?.(docIdx, item.id, e.target.checked);
      });
      group.appendChild(row);
    });

    root.appendChild(group);
  });

  updateFocusButtons(list);
}

/** 勾选变化时只刷新按钮状态，避免重绘整张清单（那会让复选框失去焦点） */
export function refreshFocusButtons(docs) {
  updateFocusButtons(docs);
}

function updateFocusButtons(docs) {
  const anyItems = (docs || []).some((d) => d.status === 'done' && d.items?.length);
  const selectAll = document.getElementById('selectAllFocusBtn');
  const resuggest = document.getElementById('resuggestBtn');
  if (selectAll) {
    const allSelected =
      anyItems &&
      docs.every((d) => d.status !== 'done' || d.items.every((i) => d.selected?.has(i.id)));
    selectAll.disabled = !anyItems;
    selectAll.textContent = allSelected ? 'Select none' : 'Select all';
  }
  if (resuggest) resuggest.disabled = !anyItems;
}

/** Reading plan 底部的「Start analysis」：只要队列里有文档就可以点 */
export function setPlanReady(ready) {
  const btn = document.getElementById('startAnalysisBtn');
  if (btn) btn.disabled = !ready;
}

function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  return div.innerHTML;
}

/** 「读了多少」的人话描述：PDF 论页，文本论字符，图片论张数 */
function describeExtent({ kind, pageCount, includedPages, textChars } = {}) {
  if (kind === 'image') return `${includedPages || 1} image`;
  if (kind === 'word' || kind === 'text') {
    return textChars ? `${formatCount(textChars)} characters of text` : 'text document';
  }
  if (pageCount) return `${pageCount} pages total, ${includedPages} analysed`;
  return textChars ? `${formatCount(textChars)} characters of text` : `${includedPages || 0} pages analysed`;
}

function formatCount(n) {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------------- results view ---------------- */
const resultTotals = { papers: 0, expected: 0, pages: 0, tokensIn: 0, tokensOut: 0, counted: new Set() };

function renderResultStats() {
  const box = document.getElementById('resultStats');
  if (!box) return;
  const set = (role, value) => {
    const el = box.querySelector(`[data-role="${role}"]`);
    if (el) el.textContent = value;
  };
  const unit = (role, value) => {
    const el = box.querySelector(`[data-role="${role}"]`)?.nextElementSibling;
    if (el) el.textContent = value;
  };
  set('papers', String(resultTotals.papers));
  unit('papers', `of ${resultTotals.expected}`);
  set('pages', resultTotals.pages.toLocaleString());
  const tokens = resultTotals.tokensIn + resultTotals.tokensOut;
  set('tokens', tokens >= 10000 ? `${Math.round(tokens / 1000)}k` : tokens.toLocaleString());
  unit(
    'tokens',
    tokens
      ? `${resultTotals.tokensIn.toLocaleString()} in / ${resultTotals.tokensOut.toLocaleString()} out`
      : 'in / out',
  );
}

export function initResultsView(files) {
  resultTotals.papers = 0;
  resultTotals.expected = files.length;
  resultTotals.counted.clear();
  resultTotals.pages = 0;
  resultTotals.tokensIn = 0;
  resultTotals.tokensOut = 0;
  renderResultStats();
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
          <span class="toggle" aria-hidden="true"></span>
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
  const { result, sectionsUsed, aiSuggested, usage, estimatedTokens } = payload;
  body.innerHTML = '';
  const meta = document.createElement('p');
  meta.className = 'hint';
  meta.textContent = describeExtent(payload);
  body.appendChild(meta);
  const usageLine = document.createElement('p');
  usageLine.className = 'usage-line';
  const parts = [];
  if (typeof estimatedTokens === 'number') parts.push(`estimated in <strong>${estimatedTokens.toLocaleString()}</strong>`);
  if (usage?.input != null) parts.push(`actual in <strong>${usage.input.toLocaleString()}</strong>`);
  if (usage?.output != null) parts.push(`out <strong>${usage.output.toLocaleString()}</strong>`);
  if (parts.length) usageLine.innerHTML = 'Tokens — ' + parts.join(' · ');
  if (parts.length) body.appendChild(usageLine);
  // 模型写到一半被 max_tokens 砍断：JSON 靠修复器救了回来，但尾部的维度多半是缺的
  if (payload.truncated) {
    const warn = document.createElement('p');
    warn.className = 'notice-block';
    warn.textContent =
      'The model ran out of output room, so the end of this reading was cut off — the last sections may be missing or unfinished. Raise “Max output tokens” in Model & API, or enable fewer sections, then retry.';
    body.appendChild(warn);
  }
  sectionsUsed.forEach((s) => {
    const block = document.createElement('div');
    block.className = 'section-block';
    const raw = valueToMarkdown(result?.[s.id]);
    block.innerHTML = `
      <div class="section-title${s.ai ? ' ai-suggested' : ''}">${escapeText(s.title)}${
        s.ai ? '<span class="ai-badge">Your focus</span>' : ''
      }</div>
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
  if (!resultTotals.counted.has(idx)) {
    resultTotals.counted.add(idx);
    resultTotals.papers += 1;
    resultTotals.pages += payload.includedPages || 0;
    resultTotals.tokensIn += usage?.input ?? estimatedTokens ?? 0;
    resultTotals.tokensOut += usage?.output ?? 0;
    renderResultStats();
  }
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
  const { result, sectionsUsed, aiSuggested } = payload;
  const zh = getConfig().reportLanguage === 'zh';
  const title = filename.replace(/\.[^.]+$/, '');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const pageRef = (_, n) => (zh ? `_（见原论文第 ${n} 页）_` : `_(see page ${n} of the paper)_`);
  const lines = [];
  lines.push(`# ${title}`, '');
  if (zh) {
    lines.push(`> 原始文件：\`${filename}\`  `);
    lines.push(`> 读取范围：${describeExtent(payload)}  `);
    lines.push(`> 生成时间：${stamp}`, '');
  } else {
    lines.push(`> Source file: \`${filename}\`  `);
    lines.push(`> Read: ${describeExtent(payload)}  `);
    lines.push(`> Generated: ${stamp}`, '');
  }
  for (const s of sectionsUsed) {
    const content = valueToMarkdown(result?.[s.id]).replace(PAGE_REF_RE, pageRef);
    const mark = s.ai ? (zh ? ' _(你选中的角度)_' : ' _(your focus)_') : '';
    lines.push(`## ${s.title}${mark}`, '', content, '');
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
  includeSource: false,
  messages: [],
  lastUsage: null,
  onSend: null,
};

function chatSystemInstruction() {
  return [
    'You are a rigorous reading assistant for dense professional documents — academic papers, analyst research, quantitative strategy reports, long-form journalism, whitepapers and filings. The user has already analysed the documents listed below and now wants to ask follow-up questions.',
    'Answer from those documents, and follow these rules:',
    '1. Prefer concrete evidence from the documents (terminology, numbers, equations, page or section references) over speculation. If the context does not contain the answer, say so plainly.',
    '2. **Mathematics**: whenever a derivation or formula is involved, use LaTeX — inline `$...$`, display `$$...$$` (no extra backslash escaping is needed in chat).',
    '3. **Tables**: use Markdown tables for structured information such as comparisons, hyper-parameter lists and metric breakdowns.',
    '4. **Figures and diagrams in the documents**: never try to embed an image. Describe the figure in one sentence and cite where it sits (`(see page N)`, or the section heading for a text document) so the user can look it up.',
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
  includeBox.checked = chatState.includeSource;
  const sendBtn = document.getElementById('chatSendBtn');
  const clearBtn = document.getElementById('chatClearBtn');
  const input = document.getElementById('chatInput');

  includeBox.addEventListener('change', () => {
    chatState.includeSource = includeBox.checked;
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
        <span class="pp-meta">${escapeText(describeExtent(p))}</span>
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
  if (!selectedPapers.length) return { systemPrompt: instruction, sourceParts: [] };
  const lines = [instruction, '', '=== Document material ==='];
  for (let i = 0; i < selectedPapers.length; i++) {
    const p = selectedPapers[i];
    lines.push(`\n--- Document ${i + 1}: ${p.filename} ---`);
    lines.push(describeExtent(p));
    for (const s of p.sectionsUsed) {
      const v = p.analysis?.[s.id];
      if (v === undefined || v === null || v === '') continue;
      lines.push(`\n[${s.title}]`);
      lines.push(typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  const sourceParts = chatState.includeSource
    ? selectedPapers.flatMap((p) => p.docParts || [])
    : [];
  return { systemPrompt: lines.join('\n'), sourceParts };
}

export function getChatContext() {
  return buildContextText();
}

function refreshChatMonitor() {
  const cfg = getConfig();
  // 0 = 用户没设上限，交给模型自己：只报估算值，不画占比、不拦发送
  const limit = cfg.contextLimit || 0;
  const input = document.getElementById('chatInput');
  const userText = input?.value || '';
  const { systemPrompt, sourceParts } = buildContextText();
  const turns = chatState.messages.map((m) => ({ role: m.role, text: m.text }));
  // attach the source document to a synthesized turn so the estimate matches the real send.
  const estTurns = [
    ...turns,
    { role: 'user', text: userText, parts: sourceParts },
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
  if (limitEl) limitEl.textContent = limit ? limit.toLocaleString() : 'Model maximum';
  const bar = document.getElementById('chatUsageBar');
  if (bar) bar.hidden = !limit;
  if (fill && limit) {
    const pct = Math.min(100, Math.round((est / limit) * 100));
    fill.style.width = pct + '%';
    fill.classList.toggle('warning', pct >= 70 && pct < 95);
    fill.classList.toggle('danger', pct >= 95);
  }
  if (warn) {
    if (!limit) {
      warn.hidden = true;
      warn.textContent = '';
    } else if (est >= limit) {
      warn.hidden = false;
      warn.textContent = `Estimated input is ${(est - limit).toLocaleString()} tokens over the context limit. Deselect some documents, stop attaching the original document, or raise the limit.`;
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
    const can = userText.trim().length > 0 && chatState.selected.size > 0 && (!limit || est < limit);
    sendBtn.disabled = !can;
  }
  if (composerHint) {
    const sel = chatState.selected.size;
    composerHint.textContent =
      sel === 0
        ? 'Select at least one document as context'
        : `${sel} document${sel > 1 ? 's' : ''} selected · Cmd/Ctrl + Enter to send`;
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
    const { systemPrompt, sourceParts } = buildContextText();
    const turns = [];
    for (let i = 0; i < chatState.messages.length; i++) {
      const m = chatState.messages[i];
      const isFirstUser = m.role === 'user' && turns.findIndex((t) => t.role === 'user') === -1;
      if (isFirstUser && sourceParts.length) {
        turns.push({ role: 'user', text: m.text, parts: sourceParts });
      } else {
        turns.push({ role: m.role, text: m.text });
      }
    }
    const { text: replyText, usage, truncated } = await chatState.onSend({ systemPrompt, turns });
    chatState.lastUsage = usage || null;
    chatState.messages.push({ role: 'assistant', text: replyText, truncated: Boolean(truncated) });
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
      '<p class="empty-state">Ask your first question — for example, “What is the core equation of the method? Quote it from the document.”</p>';
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
      // 半句话就停住的回答，得说清楚是额度用完了而不是模型只想说这么多
      if (m.truncated) {
        const warn = document.createElement('p');
        warn.className = 'notice-block';
        warn.textContent =
          'This answer hit the output limit and stops mid-way. Raise “Max output tokens” in Model & API, or ask for a narrower slice of the question.';
        bubble.appendChild(warn);
      }
    } else {
      bubble.textContent = m.text || '';
    }
    msgs.appendChild(wrap);
  });
  msgs.scrollTop = msgs.scrollHeight;
}

import { isConfigReady, getConfig } from './config.js';
import { analyzeOne, analyzeAll } from './analyzer.js';
import { suggestAll } from './suggester.js';
import { chatLLM } from './llmClient.js';
import { prunePrepareCache } from './docProcessor.js';
import {
  switchView,
  toast,
  renderModelView,
  renderPlanView,
  bindModelActions,
  bindPlanActions,
  bindUploadActions,
  renderFocusSuggestions,
  refreshFocusButtons,
  setPlanReady,
  initResultsView,
  setItemStatus,
  renderItemResult,
  renderItemError,
  updateProgress,
  setChatPapers,
  bindChatActions,
} from './ui.js';

const state = {
  files: [],
  /* 每份排队中的文档一条：建议角度、勾选状态与扫描状态 */
  docs: [],
  lastFiles: [],
  doneCount: 0,
  papers: [],
};

/* ---------------- navigation ---------------- */

function bindNav() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchView(tab.dataset.view);
  });
  for (const id of ['openModelBtn', 'connStatus']) {
    document.getElementById(id)?.addEventListener('click', () => switchView('model'));
  }
}

/* ---------------- suggested focus ---------------- */

function docFor(file) {
  return state.docs.find((d) => d.file === file);
}

/** 文件队列变动后，保留已有文档的建议，丢掉已移除的 */
function syncDocs() {
  const existing = new Map(state.docs.map((d) => [d.file, d]));
  state.docs = state.files.map(
    (file) =>
      existing.get(file) || {
        file,
        name: file.name,
        status: 'pending',
        statusText: '',
        docType: '',
        docSummary: '',
        sampled: false,
        items: [],
        selected: new Set(),
        error: '',
      },
  );
  prunePrepareCache(state.files);
  renderFocus();
  setPlanReady(state.files.length > 0);
}

function renderFocus() {
  renderFocusSuggestions(state.docs, {
    onToggle: (docIdx, id, checked) => {
      const doc = state.docs[docIdx];
      if (!doc) return;
      if (checked) doc.selected.add(id);
      else doc.selected.delete(id);
      refreshFocusButtons(state.docs);
    },
    onRetry: (docIdx) => {
      const doc = state.docs[docIdx];
      if (doc) runSuggestions([doc.file]);
    },
  });
}

function suggestProgressText(info) {
  if (info.stage === 'pdf-rendering') return `Rendering page ${info.page} of ${info.total}…`;
  if (info.stage === 'doc-loading') return 'Reading the file…';
  if (info.stage === 'llm-calling') {
    const tail = info.estimatedTokens ? ` (about ${info.estimatedTokens.toLocaleString()} tokens)` : '';
    return `Working out what is worth learning from it${tail}…`;
  }
  return '';
}

async function runSuggestions(files) {
  if (!files.length) return;
  if (!isConfigReady()) {
    toast('Connect a model first', 'error');
    switchView('model');
    return;
  }
  const full = getConfig().suggestFullDoc;
  for (const file of files) {
    const doc = docFor(file);
    if (!doc) continue;
    doc.status = 'pending';
    doc.statusText = '';
    doc.error = '';
  }
  renderFocus();

  await suggestAll(files, {
    full,
    onItemStart: (idx) => {
      const doc = docFor(files[idx]);
      if (!doc) return;
      doc.status = 'working';
      doc.statusText = 'Reading the file…';
      renderFocus();
    },
    onProgressItem: (idx, info) => {
      const doc = docFor(files[idx]);
      if (!doc) return;
      doc.statusText = suggestProgressText(info) || doc.statusText;
      renderFocus();
    },
    onItemDone: (idx, payload) => {
      const doc = docFor(files[idx]);
      if (!doc) return;
      doc.status = 'done';
      doc.docType = payload.docType;
      doc.docSummary = payload.docSummary;
      doc.sampled = payload.sampled;
      doc.items = payload.items;
      doc.selected = new Set();
      doc.error = '';
      renderFocus();
    },
    onItemError: (idx, err) => {
      console.error(err);
      const doc = docFor(files[idx]);
      if (!doc) return;
      doc.status = 'error';
      doc.error = err?.message || String(err);
      renderFocus();
    },
  });

  const failed = state.docs.filter((d) => d.status === 'error').length;
  if (failed) toast(`${failed} document${failed > 1 ? 's' : ''} could not be scanned`, 'error');
  else toast('Suggestions ready — pick the angles you want', 'success');
}

function toggleAllFocus() {
  const withItems = state.docs.filter((d) => d.status === 'done' && d.items.length);
  if (!withItems.length) return;
  const allSelected = withItems.every((d) => d.items.every((i) => d.selected.has(i.id)));
  for (const doc of withItems) {
    doc.selected = allSelected ? new Set() : new Set(doc.items.map((i) => i.id));
  }
  renderFocus();
}

/* ---------------- analysis ---------------- */

function focusFor(file) {
  const doc = docFor(file);
  if (!doc) return { focusSections: [], docType: '' };
  return {
    focusSections: doc.items.filter((i) => doc.selected.has(i.id)),
    docType: doc.docType,
  };
}

function analysisProgressText(info) {
  if (info.stage === 'pdf-rendering') return `Rendering page ${info.page} of ${info.total}…`;
  if (info.stage === 'doc-loading') return 'Loading the document…';
  if (info.stage === 'llm-calling') {
    const tail = info.estimatedTokens ? ` (about ${info.estimatedTokens.toLocaleString()} tokens)` : '';
    const scope =
      info.kind === 'pdf'
        ? `Read ${info.includedPages}/${info.pageCount} pages`
        : 'Document ready';
    return `${scope} — querying the model${tail}…`;
  }
  return '';
}

function recordPaper(idx, file, payload) {
  state.papers[idx] = {
    filename: file.name,
    analysis: payload.result,
    sectionsUsed: payload.sectionsUsed,
    docParts: payload.docParts,
    kind: payload.kind,
    pageCount: payload.pageCount,
    includedPages: payload.includedPages,
    textChars: payload.textChars,
  };
}

function publishChatPapers() {
  setChatPapers(state.papers.filter(Boolean));
}

async function startAnalysis(files) {
  state.lastFiles = files.slice();
  state.doneCount = 0;
  state.papers = new Array(files.length);
  switchView('results');
  initResultsView(state.lastFiles);
  await analyzeAll(state.lastFiles, {
    focusFor: (idx) => focusFor(state.lastFiles[idx]),
    onItemStart: (idx) => setItemStatus(idx, 'processing', 'Preparing…'),
    onProgressItem: (idx, info) => {
      const text = analysisProgressText(info);
      if (text) setItemStatus(idx, 'processing', text);
    },
    onItemDone: (idx, payload) => {
      renderItemResult(idx, payload, retryItem);
      recordPaper(idx, state.lastFiles[idx], payload);
      state.doneCount += 1;
      updateProgress(state.doneCount, state.lastFiles.length);
      publishChatPapers();
    },
    onItemError: (idx, err) => {
      console.error(err);
      renderItemError(idx, err, retryItem);
      state.doneCount += 1;
      updateProgress(state.doneCount, state.lastFiles.length);
    },
  });
  toast('All analyses finished', 'success');
}

async function retryItem(idx) {
  const file = state.lastFiles[idx];
  if (!file) return;
  setItemStatus(idx, 'processing', 'Retrying…');
  try {
    const payload = await analyzeOne(file, {
      ...focusFor(file),
      onProgress: (info) => {
        const text = analysisProgressText(info);
        if (text) setItemStatus(idx, 'processing', text);
      },
    });
    renderItemResult(idx, payload, retryItem);
    recordPaper(idx, file, payload);
    publishChatPapers();
  } catch (err) {
    console.error(err);
    renderItemError(idx, err, retryItem);
  }
}

async function handleChatSend({ systemPrompt, turns }) {
  const cfg = getConfig();
  if (!isConfigReady()) {
    throw new Error('Finish the API configuration in Model & API first.');
  }
  return chatLLM(cfg, systemPrompt, turns);
}

/* ---------------- boot ---------------- */

function boot() {
  bindNav();
  renderModelView();
  renderPlanView();

  bindModelActions({
    onSaved: () => switchView(state.files.length ? 'plan' : 'upload'),
  });

  bindPlanActions({
    onStartAnalysis: () => {
      if (!state.files.length) {
        toast('Upload a document first', 'error');
        switchView('upload');
        return;
      }
      if (!isConfigReady()) {
        toast('Connect a model first', 'error');
        switchView('model');
        return;
      }
      startAnalysis(state.files.slice());
    },
    onResuggest: () => runSuggestions(state.files.slice()),
    onSelectAllFocus: toggleAllFocus,
  });

  bindUploadActions({
    files: state.files,
    onScan: (files) => {
      if (!isConfigReady()) {
        toast('Connect a model first', 'error');
        switchView('model');
        return;
      }
      switchView('plan');
      runSuggestions(files);
    },
    onSkip: () => switchView('plan'),
    onFilesChanged: syncDocs,
  });

  bindChatActions({ onSend: handleChatSend });
  publishChatPapers();
  syncDocs();
  switchView(isConfigReady() ? 'upload' : 'model');
}

boot();

import { isConfigReady, getConfig } from './config.js';
import { analyzeOne, analyzeAll } from './analyzer.js';
import { chatLLM } from './llmClient.js';
import {
  switchView,
  toast,
  renderSettings,
  bindSettingsActions,
  bindUploadActions,
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
  lastFiles: [],
  doneCount: 0,
  papers: [],
};

function bindTabs() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchView(tab.dataset.view);
  });
}

function recordPaper(idx, file, payload) {
  state.papers[idx] = {
    filename: file.name,
    analysis: payload.result,
    sectionsUsed: payload.sectionsUsed,
    pageImages: payload.pageImages,
    pageCount: payload.pageCount,
    includedPages: payload.includedPages,
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
    onItemStart: (idx) => setItemStatus(idx, 'processing', 'Preparing…'),
    onProgressItem: (idx, info) => {
      if (info.stage === 'pdf-rendering') {
        setItemStatus(idx, 'processing', `Rendering page ${info.page} of ${info.total}…`);
      } else if (info.stage === 'llm-calling') {
        const tail = info.estimatedTokens
          ? ` (about ${info.estimatedTokens.toLocaleString()} tokens)`
          : '';
        setItemStatus(
          idx,
          'processing',
          `Rendered ${info.includedPages}/${info.pageCount} pages — querying the model${tail}…`,
        );
      } else if (info.stage === 'pdf-loading') {
        setItemStatus(idx, 'processing', 'Loading PDF…');
      }
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
      onProgress: (info) => {
        if (info.stage === 'pdf-rendering') {
          setItemStatus(idx, 'processing', `Rendering page ${info.page} of ${info.total}…`);
        } else if (info.stage === 'llm-calling') {
          const tail = info.estimatedTokens
            ? ` (about ${info.estimatedTokens.toLocaleString()} tokens)`
            : '';
          setItemStatus(
            idx,
            'processing',
            `Rendered ${info.includedPages}/${info.pageCount} pages — querying the model${tail}…`,
          );
        }
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
    throw new Error('Finish the API configuration in Settings first.');
  }
  return chatLLM(cfg, systemPrompt, turns);
}

function boot() {
  bindTabs();
  renderSettings();
  bindSettingsActions({
    onSaved: () => switchView('upload'),
  });
  bindUploadActions({
    files: state.files,
    onAnalyze: (files) => {
      if (!isConfigReady()) {
        toast('Finish the API configuration first', 'error');
        switchView('settings');
        return;
      }
      startAnalysis(files);
    },
  });
  bindChatActions({ onSend: handleChatSend });
  publishChatPapers();
  switchView(isConfigReady() ? 'upload' : 'settings');
}

boot();

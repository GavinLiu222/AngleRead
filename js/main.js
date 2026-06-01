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
    onItemStart: (idx) => setItemStatus(idx, 'processing', '准备中…'),
    onProgressItem: (idx, info) => {
      if (info.stage === 'pdf-rendering') {
        setItemStatus(idx, 'processing', `渲染 PDF 第 ${info.page}/${info.total} 页…`);
      } else if (info.stage === 'llm-calling') {
        const tail = info.estimatedTokens
          ? `（预估 ${info.estimatedTokens.toLocaleString()} tokens）`
          : '';
        setItemStatus(idx, 'processing', `已渲染 ${info.includedPages}/${info.pageCount} 页，正在请求模型${tail}…`);
      } else if (info.stage === 'pdf-loading') {
        setItemStatus(idx, 'processing', '加载 PDF…');
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
  toast('全部分析任务已完成', 'success');
}

async function retryItem(idx) {
  const file = state.lastFiles[idx];
  if (!file) return;
  setItemStatus(idx, 'processing', '重试中…');
  try {
    const payload = await analyzeOne(file, {
      onProgress: (info) => {
        if (info.stage === 'pdf-rendering') {
          setItemStatus(idx, 'processing', `渲染 PDF 第 ${info.page}/${info.total} 页…`);
        } else if (info.stage === 'llm-calling') {
          const tail = info.estimatedTokens
            ? `（预估 ${info.estimatedTokens.toLocaleString()} tokens）`
            : '';
          setItemStatus(idx, 'processing', `已渲染 ${info.includedPages}/${info.pageCount} 页，正在请求模型${tail}…`);
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
    throw new Error('请先在「设置」中完成 API 配置');
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
        toast('请先完成 API 设置', 'error');
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

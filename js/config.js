const CONFIG_KEY = 'thesisReader.config';
const SECTIONS_KEY = 'thesisReader.sections';
const PROFILES_KEY = 'thesisReader.profiles';
const SESSION_KEY_HOLDER = { apiKey: '' };

const DEFAULT_CONFIG = {
  apiUrl: '',
  apiKey: '',
  apiFormat: 'openai',
  model: '',
  maxPages: 0,
  contextLimit: 128000,
  rememberKey: true,
  autoSuggestSections: false,
};

export const DEFAULT_SECTIONS = [
  {
    id: 'argument',
    title: '研究论点',
    prompt:
      '系统梳理论文的核心研究问题与中心论点（建议 6-9 句，先给总览再分点展开）。要求：(1) 用一句话精确点明论文试图回答的核心科学问题，并说明它为何重要、难点何在；(2) 提炼作者的中心主张，区分主要论点与支撑性次级论点，并理清二者的逻辑关系（谁支撑谁）；(3) 指出论文赖以成立的关键假设或前提，说明哪些被论文显式验证、哪些是默认成立；(4) 若论文挑战或修正了既有共识，说明其立场与核心依据；(5) 准确使用论文中的关键术语，不要笼统复述摘要。',
    enabled: true,
  },
  {
    id: 'background',
    title: '研究背景',
    prompt:
      '分析研究背景与动机（建议 5-7 句）。要求：(1) 概述该问题所属领域的研究现状与主流范式；(2) 具体指出已有方法的局限或尚未解决的痛点，尽量点名代表性工作或方法流派；(3) 说明是什么契机、观察或需求催生了本研究，并交代其学术或产业意义；(4) 解释本研究在该脉络中的定位——补足空白、改进既有还是另辟蹊径；(5) 引用相关文献与领域术语，并区分『论文明确归纳的背景』与『你基于常识的补充』。',
    enabled: true,
  },
  {
    id: 'method',
    title: '研究方法',
    prompt:
      '深入解析论文的方法（最重要的维度，请充分展开）。要求：(1) 自顶向下先讲整体框架或流水线，再拆解关键模块及各自作用，理清模块间的数据流与依赖；(2) 明确输入与输出的形态（数据类型、维度、规模）；(3) 给出核心数学表述——目标函数、损失、关键变换或算法步骤，用 LaTeX 呈现（行内 `$...$`，独立 `$$...$$`），并解释主要符号的含义；(4) 说明关键设计选择及其动机（为什么这样设计、解决了什么问题）；(5) 与已有方法逐点对比，指出算法层面的本质差异而非措辞差异；(6) 若有方法示意图、流程图或伪代码，用 1-2 句描述要点并注明所在页码（如「详见原文第 N 页」），不要尝试嵌入图片。',
    enabled: true,
  },
  {
    id: 'experiment',
    title: '实验设计',
    prompt:
      '详尽说明实验设置与结果（鼓励使用表格）。要求：(1) 列出数据集名称、规模、划分方式与来源；(2) 给出评价指标的定义与含义，必要时用 LaTeX 写出指标公式；(3) 列明主要对比基线及其代表性；(4) 说明关键实验配置：重要超参数、硬件、训练或推理成本；(5) 用 Markdown 表格呈现核心数值对比（方法 × 指标）并指出最优结果；(6) 概述消融实验验证了哪些组件的有效性；(7) 涉及结果图表时，用一句话总结其结论并注明页码。',
    enabled: true,
  },
  {
    id: 'conclusion',
    title: '主要结论',
    prompt:
      '陈述论文的关键发现与结论，并分清层次。要求：(1) 每条结论都用具体的定量结果（绝对指标、相对提升、百分比）支撑，不空泛；(2) 区分主要发现与次要发现，并按重要性排序；(3) 区分『科学结论』（关于现象或规律的认识）与『工程结论』（关于系统或性能的改进）；(4) 说明这些结论成立所依赖的条件与适用范围，指出其普适性边界；(5) 若结果与既有认知冲突或令人意外，请特别点明。',
    enabled: true,
  },
  {
    id: 'innovation',
    title: '创新点',
    prompt:
      '用 4-6 条要点列出论文的创新与贡献，按重要性排序。每条要求：(1) 一句话点明创新的实质内容；(2) 明确相对于哪类已有工作或具体方法的差异，说清『新在何处』；(3) 阐述该创新带来的实际收益（性能、效率、可扩展性、可解释性等），尽量用论文数据佐证；(4) 客观区分『真正的方法创新』与『工程实现或增量改良』，不夸大。',
    enabled: true,
  },
  {
    id: 'limitation',
    title: '局限性',
    prompt:
      '用 3-6 条要点客观评估论文的局限，兼顾作者自述与你的独立判断。要求：(1) 先列出作者在文中明确承认的局限；(2) 再指出你观察到、但作者未充分讨论的潜在问题（如假设过强、数据偏差、可复现性、计算成本、泛化性、安全或公平性等），并说明判断依据；(3) 区分『根本性局限』与『可在后续工作中缓解的局限』；(4) 针对每条给出具体、可操作的改进或未来工作建议，避免空话。',
    enabled: true,
  },
  {
    id: 'tldr',
    title: '一句话总结',
    prompt: '用一句不超过 50 字的中文高度概括全文，须同时点出三要素：研究解决的问题、采用的核心方法、最关键的结论或贡献。确保读完即知论文做了什么、好在哪里，避免泛泛而谈。',
    enabled: true,
  },
];

export function getConfig() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  } catch {
    raw = null;
  }
  const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  if (!cfg.rememberKey) {
    cfg.apiKey = SESSION_KEY_HOLDER.apiKey;
  }
  return cfg;
}

export function setConfig(patch) {
  const current = getConfig();
  const next = { ...current, ...patch };
  SESSION_KEY_HOLDER.apiKey = next.apiKey || '';
  const toStore = { ...next };
  if (!next.rememberKey) {
    toStore.apiKey = '';
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(toStore));
  return next;
}

export function isConfigReady() {
  const cfg = getConfig();
  // 本地 Ollama 无需 API Key
  if (cfg.apiFormat === 'ollama') return Boolean(cfg.apiUrl && cfg.model);
  return Boolean(cfg.apiUrl && cfg.apiKey && cfg.model);
}

export function getSections() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(SECTIONS_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_SECTIONS.map((s) => ({ ...s }));
  }
  return raw;
}

export function setSections(sections) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
}

export function resetSections() {
  localStorage.removeItem(SECTIONS_KEY);
  return getSections();
}

export function clearAllStorage() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(SECTIONS_KEY);
  localStorage.removeItem(PROFILES_KEY);
  SESSION_KEY_HOLDER.apiKey = '';
}

export function genSectionId() {
  return 'custom_' + Math.random().toString(36).slice(2, 8);
}

/* ---------------- model config profiles ---------------- */
/* 每个档案保存一套「模型连接配置」：接口格式 / URL / Key / 模型 / 上下文上限，
   供用户在曾经用过的多套大模型之间快速切换。 */

export function genProfileId() {
  return 'p_' + Math.random().toString(36).slice(2, 9);
}

/** 用「接口格式 + URL + 模型」作为档案的去重签名 */
export function profileSignature(p) {
  const url = (p?.apiUrl || '').replace(/\/+$/, '');
  return `${p?.apiFormat || 'openai'}|${url}|${p?.model || ''}`;
}

function defaultProfileName({ apiFormat, apiUrl, model }) {
  const m = model || '未命名模型';
  if (apiFormat === 'ollama') return `${m} · Ollama`;
  let host = apiUrl || '';
  try {
    host = new URL(apiUrl).host;
  } catch {}
  return host ? `${m} @ ${host}` : m;
}

export function getProfiles() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null');
  } catch {
    raw = null;
  }
  return Array.isArray(raw) ? raw : [];
}

export function setProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function deleteProfile(id) {
  const profiles = getProfiles().filter((p) => p.id !== id);
  setProfiles(profiles);
  return profiles;
}

/**
 * 把一套配置记入档案：若已存在相同签名的档案则更新，否则新增。
 * 受 rememberKey 影响——关闭时不把 API Key 落盘到档案。
 * @returns {Array} 最新的档案列表
 */
export function rememberProfile(cfg) {
  const profiles = getProfiles();
  const incoming = {
    apiUrl: cfg.apiUrl || '',
    apiKey: cfg.rememberKey ? cfg.apiKey || '' : '',
    apiFormat: cfg.apiFormat || 'openai',
    model: cfg.model || '',
    contextLimit: cfg.contextLimit || 128000,
  };
  const sig = profileSignature(incoming);
  const idx = profiles.findIndex((p) => profileSignature(p) === sig);
  if (idx >= 0) {
    profiles[idx] = {
      ...profiles[idx],
      ...incoming,
      name: profiles[idx].name || defaultProfileName(incoming),
    };
  } else {
    profiles.push({ id: genProfileId(), name: defaultProfileName(incoming), ...incoming });
  }
  setProfiles(profiles);
  return profiles;
}

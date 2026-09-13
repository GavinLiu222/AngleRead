/* 项目原名 ThesisReader，改名 AngleRead 后本机存的键跟着换前缀。
   老键还在就搬一次再删掉，用户已有的配置、维度、档案不会因为改名丢掉。
   等到确信没人再带着老键回来，这个函数连同 LEGACY_PREFIX 可以一并删除。 */
const STORAGE_PREFIX = 'angleRead.';
const LEGACY_PREFIX = 'thesisReader.';

function migrateLegacyStorage() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(LEGACY_PREFIX)) continue;
      const renamed = STORAGE_PREFIX + key.slice(LEGACY_PREFIX.length);
      if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  } catch {
    // 隐私模式下 localStorage 不可读写，那本来也没有旧数据可搬
  }
}
migrateLegacyStorage();

const CONFIG_KEY = STORAGE_PREFIX + 'config';
const SECTIONS_KEY = STORAGE_PREFIX + 'sections';
const PROFILES_KEY = STORAGE_PREFIX + 'profiles';
const SESSION_KEY_HOLDER = { apiKey: '' };

const DEFAULT_CONFIG = {
  apiUrl: '',
  apiKey: '',
  apiFormat: 'openai',
  model: '',
  maxPages: 0,
  contextLimit: 128000,
  // 输出上限。整份阅读报告是一次性生成的，「八个维度 + 自选角度」本来就写得长，
  // 推理模型还要先在思考链里花掉一大截额度——给小了正文会直接是空的。
  // 这是上限不是目标，用不到就不花钱，所以默认给足，端点不接受时客户端会自动降档。
  maxOutputTokens: 32768,
  rememberKey: true,
  autoSuggestSections: false,
  reportLanguage: 'en',
  // 建议阶段默认只读抽样（前几页 + 末几页 / 开头与结尾），勾上才整份文档送过去
  suggestFullDoc: false,
};

/** 报告输出语言（界面固定英文，模型产出的语言由此项决定） */
export const REPORT_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

export function reportLanguageDirective(lang) {
  if (lang === 'zh') {
    return 'Write every piece of analysis in Simplified Chinese (简体中文). Keep technical terms, model names, dataset names, metric names and all mathematics in their original form.';
  }
  return 'Write every piece of analysis in English, even when the paper itself is written in another language. Keep proper nouns, model names and dataset names in their original form.';
}

export const DEFAULT_SECTIONS = [
  {
    id: 'argument',
    title: 'Core argument',
    prompt:
      'Lay out the central research question and thesis of the paper (aim for 6-9 sentences: overview first, then specifics). Requirements: (1) state in one sentence the exact scientific question the paper tries to answer, and why it matters and is hard; (2) distil the authors’ central claim, separating the primary argument from the supporting sub-claims, and make the logical dependency between them explicit; (3) identify the key assumptions or premises the argument rests on, and say which ones the paper verifies explicitly versus takes for granted; (4) if the paper challenges or revises an established consensus, state its position and the core evidence behind it; (5) use the paper’s own terminology precisely instead of paraphrasing the abstract.',
    enabled: true,
  },
  {
    id: 'background',
    title: 'Background & motivation',
    prompt:
      'Analyse the research context and motivation (aim for 5-7 sentences). Requirements: (1) summarise the state of the art and the dominant paradigm in this area; (2) name the concrete limitations or unsolved pain points of prior work, citing representative papers or method families where possible; (3) explain what observation, opportunity or demand triggered this work, and its academic or industrial significance; (4) position the work within that lineage — does it fill a gap, improve on prior art, or take an orthogonal route; (5) reference the relevant literature and domain vocabulary, and clearly separate background the paper states explicitly from context you are adding yourself.',
    enabled: true,
  },
  {
    id: 'method',
    title: 'Method',
    prompt:
      'Explain the method in depth — this is the most important section, so develop it fully. Requirements: (1) work top-down: describe the overall framework or pipeline first, then decompose it into key modules, their roles, and the data flow and dependencies between them; (2) state the shape of the inputs and outputs (data types, dimensions, scale); (3) give the core mathematical formulation — objective, loss, key transforms or algorithmic steps — in LaTeX (inline `$...$`, display `$$...$$`), and explain what the main symbols mean; (4) explain the critical design choices and their motivation (why it is built this way, what problem each choice solves); (5) compare point by point against prior methods, identifying genuine algorithmic differences rather than differences in wording; (6) if there is an architecture diagram, flow chart or pseudocode, summarise it in 1-2 sentences and cite the page (e.g. “see page N of the paper”) — never try to embed an image.',
    enabled: true,
  },
  {
    id: 'experiment',
    title: 'Experimental setup',
    prompt:
      'Describe the experimental setup and results in detail (tables encouraged). Requirements: (1) list dataset names, sizes, splits and provenance; (2) define the evaluation metrics and what they measure, writing metric formulas in LaTeX where useful; (3) list the main baselines and why they are representative; (4) report the key experimental configuration: important hyper-parameters, hardware, training or inference cost; (5) present the headline numerical comparison as a Markdown table (method × metric) and point out the best result; (6) summarise which components the ablations validate; (7) when referring to a results figure, state its takeaway in one sentence and cite the page number.',
    enabled: true,
  },
  {
    id: 'conclusion',
    title: 'Key findings',
    prompt:
      'State the paper’s key findings and conclusions, with clear hierarchy. Requirements: (1) support every conclusion with concrete quantitative evidence (absolute numbers, relative gains, percentages) rather than vague claims; (2) separate primary from secondary findings and order them by importance; (3) distinguish scientific conclusions (about a phenomenon or a law) from engineering conclusions (about a system or its performance); (4) state the conditions and scope under which these conclusions hold, and where their generality ends; (5) call out explicitly any result that conflicts with prior belief or is otherwise surprising.',
    enabled: true,
  },
  {
    id: 'innovation',
    title: 'Novelty & contributions',
    prompt:
      'List 4-6 bullet points covering the paper’s novelty and contributions, ordered by importance. For each: (1) state in one sentence what the contribution actually is; (2) name the prior work or method family it differs from, and make clear what is new about it; (3) explain the practical payoff (accuracy, efficiency, scalability, interpretability, …), backed by the paper’s own numbers where possible; (4) honestly separate genuine methodological novelty from engineering work or incremental refinement — do not oversell.',
    enabled: true,
  },
  {
    id: 'limitation',
    title: 'Limitations',
    prompt:
      'Give 3-6 bullet points assessing the paper’s limitations objectively, covering both what the authors admit and your own independent judgement. Requirements: (1) list first the limitations the authors acknowledge in the text; (2) then raise problems you observe that the authors do not discuss adequately (over-strong assumptions, data bias, reproducibility, compute cost, generalisation, safety or fairness, …), and say what evidence leads you there; (3) separate fundamental limitations from ones that follow-up work could plausibly fix; (4) attach a concrete, actionable suggestion for improvement or future work to each point — avoid platitudes.',
    enabled: true,
  },
  {
    id: 'tldr',
    title: 'One-line summary',
    prompt:
      'Summarise the whole paper in a single sentence of at most 50 words that names all three of: the problem addressed, the core method used, and the most important result or contribution. A reader should finish it knowing what the paper did and why it matters. Avoid generalities.',
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
  // Local Ollama needs no API key
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
  const m = model || 'Unnamed model';
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
    // 0 = 留空 = 用模型自己的上限，原样记进档案
    contextLimit: cfg.contextLimit || 0,
    maxOutputTokens: cfg.maxOutputTokens || 0,
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

/* 文档预处理：把用户上传的各种格式统一成「模型可读的内容块」。

   parts: Array<{ type: 'image', dataUrl } | { type: 'text', text, label? }>

   - PDF   → 逐页渲染成图片（pdf.js）
   - 图片  → 直接作为一页，过大时等比缩小
   - Word  → .docx 用 mammoth 提取正文文本（.doc 旧二进制不支持）
   - 文本  → Markdown / txt / csv / json 等直接读成文本 */

const PDFJS_VERSION = '4.0.379';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
const MAMMOTH_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.9.0/mammoth.browser.min.js';

/** 图片长边上限；超过则等比缩小，避免单张图把请求撑爆 */
const IMAGE_MAX_EDGE = 2000;

/* 建议阶段的抽样参数（正式分析始终用完整文档） */
const SAMPLE_HEAD_PAGES = 6;
const SAMPLE_TAIL_PAGES = 2;
const SAMPLE_HEAD_CHARS = 6000;
const SAMPLE_TAIL_CHARS = 2000;

const TEXT_EXTS = ['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'log', 'rst'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

/** <input type="file"> 的 accept 属性 */
export const SUPPORTED_ACCEPT =
  '.pdf,.docx,.md,.markdown,.txt,.text,.csv,.tsv,.json,.log,.rst,image/*';

export function fileExt(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** 'pdf' | 'image' | 'word' | 'text' | ''（'' 表示不支持） */
export function fileKind(file) {
  const ext = fileExt(file?.name);
  const type = String(file?.type || '').toLowerCase();
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (IMAGE_EXTS.includes(ext) || type.startsWith('image/')) return 'image';
  if (ext === 'docx') return 'word';
  if (TEXT_EXTS.includes(ext)) return 'text';
  if (!ext && type.startsWith('text/')) return 'text';
  return '';
}

export function isSupportedFile(file) {
  return Boolean(fileKind(file));
}

/** 给被拒绝的文件一句人话解释，用于 toast */
export function unsupportedReason(file) {
  const ext = fileExt(file?.name);
  if (ext === 'doc') {
    return `“${file.name}” is a legacy .doc file — save it as .docx and try again.`;
  }
  if (ext === 'pptx' || ext === 'ppt' || ext === 'key') {
    return `“${file.name}” is a slide deck — export it to PDF and try again.`;
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return `“${file.name}” is a spreadsheet — export it to PDF or CSV and try again.`;
  }
  return `“${file.name}” is not a supported format (PDF, Word .docx, Markdown, text or image).`;
}

/* ---------------- lazy CDN loaders ---------------- */

let pdfjsLibPromise = null;

async function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(/* @vite-ignore */ PDFJS_CDN).then((mod) => {
      const lib = mod.default || mod;
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

let mammothPromise = null;

async function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      if (window.mammoth) {
        resolve(window.mammoth);
        return;
      }
      const script = document.createElement('script');
      script.src = MAMMOTH_CDN;
      script.async = true;
      script.onload = () =>
        window.mammoth
          ? resolve(window.mammoth)
          : reject(new Error('mammoth.js loaded but exposed no global.'));
      script.onerror = () =>
        reject(new Error('Could not load the .docx reader (mammoth.js) from the CDN.'));
      document.head.appendChild(script);
    }).catch((err) => {
      mammothPromise = null;
      throw err;
    });
  }
  return mammothPromise;
}

/* ---------------- per-format readers ---------------- */

export async function pdfToImages(file, { scale = 1.5, maxPages = 0, onPage } = {}) {
  const lib = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  const total = pdf.numPages;
  const limit = maxPages > 0 ? Math.min(maxPages, total) : total;
  const images = [];

  for (let i = 1; i <= limit; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/png'));
    if (onPage) onPage(i, limit);
    page.cleanup();
  }

  pdf.cleanup();
  pdf.destroy();
  return { filename: file.name, pageCount: total, includedPages: images.length, images };
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read “${file.name}”.`));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = dataUrl;
  });
}

/** 长边超过上限时等比缩小；截图类（png/gif/bmp）保持无损，照片类转 JPEG */
async function shrinkImage(dataUrl, sourceExt) {
  let img;
  try {
    img = await loadImageElement(dataUrl);
  } catch {
    return dataUrl;
  }
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (!longest || longest <= IMAGE_MAX_EDGE) return dataUrl;
  const ratio = IMAGE_MAX_EDGE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const lossless = ['png', 'gif', 'bmp'].includes(sourceExt);
  return lossless ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
}

async function docxToText(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  const text = String(value || '').trim();
  if (!text) throw new Error(`“${file.name}” contains no extractable text.`);
  return text;
}

/* ---------------- unified entry point ---------------- */

/**
 * 把一份文件变成模型可读的内容块。
 * @returns {Promise<{kind:string, parts:Array, pageCount:number, includedPages:number, textChars:number}>}
 */
export async function prepareDocument(file, { maxPages = 0, onProgress } = {}) {
  const kind = fileKind(file);
  if (!kind) throw new Error(unsupportedReason(file));

  if (kind === 'pdf') {
    onProgress?.({ stage: 'doc-loading', kind });
    const { images, pageCount, includedPages } = await pdfToImages(file, {
      maxPages,
      onPage: (page, total) => onProgress?.({ stage: 'pdf-rendering', page, total }),
    });
    return {
      kind,
      parts: images.map((dataUrl) => ({ type: 'image', dataUrl })),
      pageCount,
      includedPages,
      textChars: 0,
    };
  }

  if (kind === 'image') {
    onProgress?.({ stage: 'doc-loading', kind });
    const raw = await readAsDataURL(file);
    const dataUrl = await shrinkImage(raw, fileExt(file.name));
    return { kind, parts: [{ type: 'image', dataUrl }], pageCount: 1, includedPages: 1, textChars: 0 };
  }

  onProgress?.({ stage: 'doc-loading', kind });
  const text = kind === 'word' ? await docxToText(file) : (await file.text()).trim();
  if (!text) throw new Error(`“${file.name}” is empty.`);
  return {
    kind,
    parts: [{ type: 'text', text, label: `Document: ${file.name}` }],
    pageCount: 0,
    includedPages: 0,
    textChars: text.length,
  };
}

/* ---------------- prepare cache ----------------
   建议阶段渲染过的页面，正式分析时直接复用：既省一次渲染，也省一次重复的
   PDF 解析。maxPages 变了就作废重来。 */

const prepareCache = new Map();

export async function prepareCached(file, { maxPages = 0, onProgress } = {}) {
  const hit = prepareCache.get(file);
  if (hit && hit.maxPages === maxPages) return hit.promise;
  const promise = prepareDocument(file, { maxPages, onProgress }).catch((err) => {
    // 失败不留缓存，下次重试能重新跑一遍
    if (prepareCache.get(file)?.promise === promise) prepareCache.delete(file);
    throw err;
  });
  prepareCache.set(file, { maxPages, promise });
  return promise;
}

export function clearPrepareCache() {
  prepareCache.clear();
}

/** 队列里已经移除的文件，其渲染结果也一并丢掉，别把页面图片一直留在内存里 */
export function prunePrepareCache(keepFiles) {
  const keep = new Set(keepFiles || []);
  for (const file of [...prepareCache.keys()]) {
    if (!keep.has(file)) prepareCache.delete(file);
  }
}

/* ---------------- sampling (suggestion pass) ---------------- */

/**
 * 猜「读者想读什么」时不需要整份文档，抽样即可。
 * @returns {{parts:Array, sampled:boolean, note:string}}
 */
export function sampleParts(parts, { full = false } = {}) {
  const list = Array.isArray(parts) ? parts : [];
  if (full) return { parts: list, sampled: false, note: '' };

  const images = list.filter((p) => p.type === 'image');
  if (images.length) {
    const cap = SAMPLE_HEAD_PAGES + SAMPLE_TAIL_PAGES;
    if (images.length <= cap) return { parts: list, sampled: false, note: '' };
    const head = images.slice(0, SAMPLE_HEAD_PAGES);
    const tail = images.slice(-SAMPLE_TAIL_PAGES);
    return {
      parts: [...head, ...tail],
      sampled: true,
      note: `You are only seeing a sample of a ${images.length}-page document: its first ${SAMPLE_HEAD_PAGES} pages followed by its last ${SAMPLE_TAIL_PAGES} pages.`,
    };
  }

  const sampledParts = [];
  let sampled = false;
  let note = '';
  for (const part of list) {
    if (part.type !== 'text') {
      sampledParts.push(part);
      continue;
    }
    const text = part.text || '';
    if (text.length <= SAMPLE_HEAD_CHARS + SAMPLE_TAIL_CHARS) {
      sampledParts.push(part);
      continue;
    }
    sampled = true;
    note = `You are only seeing a sample of a ${text.length.toLocaleString()}-character document: its opening followed by its ending.`;
    sampledParts.push({
      ...part,
      text:
        text.slice(0, SAMPLE_HEAD_CHARS) +
        '\n\n[… middle of the document omitted from this sample …]\n\n' +
        text.slice(-SAMPLE_TAIL_CHARS),
    });
  }
  return { parts: sampledParts, sampled, note };
}

export function stripBase64Prefix(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/** 从 data URL 里取出媒体类型（Anthropic 的 image block 必须声明它） */
export function dataUrlMediaType(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)/i);
  return m ? m[1].toLowerCase() : 'image/png';
}

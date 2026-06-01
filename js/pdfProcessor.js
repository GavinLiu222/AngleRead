const PDFJS_VERSION = '4.0.379';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

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
    const dataUrl = canvas.toDataURL('image/png');
    images.push(dataUrl);
    if (onPage) onPage(i, limit);
    page.cleanup();
  }

  pdf.cleanup();
  pdf.destroy();
  return { filename: file.name, pageCount: total, includedPages: images.length, images };
}

export function stripBase64Prefix(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * 本地 OCR：tesseract.js（wasm）在浏览器里跑，不联网、不花钱、海报不出本机。
 *
 * 为什么要有它：云端视觉模型要么按量计费、要么额度用完就断；比赛现场还怕没网。
 * 它只做一件事——把海报上的字抄成一行一行；位置仍然由人在图上圈，
 * 「框和字对得上」这条底线不交给模型。
 *
 * 资源都在 public/ 下，随站点一起发布：
 *   public/tesseract/worker.min.js               tesseract.js 的 worker
 *   public/tesseract/tesseract-core-simd-lstm.wasm.js  wasm 内核
 *   public/tessdata/chi_sim.traineddata.gz       中文语言包（约 19MB）
 *   public/tessdata/eng.traineddata.gz           英文语言包（约 10MB）
 */
import { createWorker } from 'tesseract.js';

const base = import.meta.env.BASE_URL || './';

interface OcrLine {
  text: string;
  confidence: number;
  y: number;
}

export interface LocalOcrRun {
  lines: string[];
  ms: number;
}

export interface LocalOcrProgress {
  /** 0..1，只在「recognizing text」阶段有意义 */
  progress: number;
  stage: string;
}

/**
 * 预处理：tesseract 对「深底 + 发光字 + 艺术字」很不友好，先做三件不花哨的事
 *  - 放大到长边约 1800（小字变大，识别率明显上升）
 *  - 转灰度 + 拉对比；底色偏暗就整张反相（黑字白底更符合它的口味）
 * 这一步纯 canvas，不联网。
 */
async function preprocess(dataUrl: string, maxSide = 1800, heavy = true): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解不开'));
    el.src = dataUrl;
  });
  const scale = Math.min(maxSide / Math.max(img.naturalWidth, img.naturalHeight), 1.6);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // 灰度 + 求亮度均值
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    px[i] = px[i + 1] = px[i + 2] = g;
    sum += g;
  }
  if (heavy) {
    const mean = sum / (px.length / 4);
    const invert = mean < 110; // 深底浅字 → 反相
    const k = 1.7;
    for (let i = 0; i < px.length; i += 4) {
      let v = 128 + (px[i] - mean) * k;
      if (invert) v = 255 - v;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
  }
  return canvas.toDataURL('image/png');
}

/** tesseract 在汉字之间爱插空格（「图 书 馆」），去掉；英文和数字之间的空格保留 */
function tidy(line: string): string {
  return line
    .replace(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 从 tesseract 的结果里扒出「行」：带置信度和纵向位置，读起来才像人眼的顺序 */
function collectLines(data: unknown): OcrLine[] {
  const out: OcrLine[] = [];
  type Box = { x0?: number; y0?: number };
  type L = { text?: string; confidence?: number; bbox?: Box };
  const walk = (node: { blocks?: unknown[]; paragraphs?: unknown[]; lines?: unknown[] }) => {
    for (const l of (node.lines as L[]) ?? []) {
      const t = tidy(l.text ?? '');
      if (t) out.push({ text: t, confidence: l.confidence ?? 0, y: l.bbox?.y0 ?? 0 });
    }
    for (const p of (node.paragraphs as never[]) ?? []) walk(p);
    for (const b of (node.blocks as never[]) ?? []) walk(b);
  };
  walk(data as never);
  return out;
}

function flattenText(text: string): OcrLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => tidy(l))
    .filter(Boolean)
    .map((t) => ({ text: t, confidence: 60, y: 0 }));
}

/** 两遍结果里同一行常被读出两种写法：「11.13 周五 22:00」和「11.13 [FH 22:00」 */
function similar(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, '');
  const nb = b.replace(/\s+/g, '');
  if (na === nb) return true;
  if (Math.abs(na.length - nb.length) > Math.max(4, na.length * 0.5)) return false;
  const grams = (t: string) => {
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i += 1) set.add(t.slice(i, i + 2));
    return set;
  };
  const ga = grams(na);
  const gb = grams(nb);
  if (!ga.size || !gb.size) return false;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit += 1;
  return (2 * hit) / (ga.size + gb.size) >= 0.62;
}

/** 置信度太低、又不像正经文字的，直接扔掉，别把噪声摆给人看 */
function plausible(line: OcrLine): boolean {
  const body = line.text.replace(/[^\p{L}\p{N}]/gu, '');
  if (!body.length) return false;
  const cjk = (line.text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (line.confidence >= 55) return true;
  return cjk >= 4;
}

export async function runLocalOcr(
  dataUrl: string,
  onProgress?: (p: LocalOcrProgress) => void
): Promise<LocalOcrRun> {
  const t0 = performance.now();
  // 资源没拉全时 tesseract 会抛一句难懂的 fetch 错，这里先自己看一眼
  try {
    const head = await fetch(`${base}tesseract/worker.min.js`, { method: 'HEAD' });
    if (!head.ok) throw new Error('missing');
  } catch {
    throw new Error(
      '本机 OCR 的静态资源还没拉下来（public/tesseract 与 public/tessdata）。在项目目录跑一次 `npm run ocr:assets`，大约 37MB，之后就能离线用。'
    );
  }
  const worker = await createWorker('chi_sim+eng', 1, {
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/tesseract-core-simd-lstm.wasm.js`,
    langPath: `${base}tessdata`,
    gzip: true,
    logger: (m: { status?: string; progress?: number }) => {
      onProgress?.({ progress: m.progress ?? 0, stage: m.status ?? '' });
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' as never });
    const passes: OcrLine[][] = [];
    for (const [i, heavy] of [false, true].entries()) {
      const prepared = await preprocess(dataUrl, 1800, heavy);
      const ret = await worker.recognize(prepared, {}, { blocks: true });
      const got = collectLines(ret.data);
      passes.push(got.length ? got : flattenText(ret.data.text ?? ''));
      onProgress?.({ progress: (i + 1) / 2, stage: `第 ${i + 1}/2 遍` });
    }

    // 两遍合并：像同一行的只留置信度高的；噪声丢掉；最后按纵向位置排
    const kept: OcrLine[] = [];
    for (const line of passes.flat()) {
      if (!plausible(line)) continue;
      const dup = kept.findIndex((k) => similar(k.text, line.text));
      if (dup >= 0) {
        if (line.confidence > kept[dup].confidence) kept[dup] = line;
        continue;
      }
      kept.push(line);
    }
    const lines = kept
      .sort((a, b) => a.y - b.y || a.confidence - b.confidence)
      .map((l) => l.text)
      .filter((l) => l.replace(/[^\p{L}\p{N}]/gu, '').length > 1);

    if (!lines.length) throw new Error('本机 OCR 没抄到文字——这张可能是纯图形海报，或者字太小，直接手打吧。');
    return { lines, ms: Math.round(performance.now() - t0) };
  } finally {
    await worker.terminate();
  }
}

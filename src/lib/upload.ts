/**
 * 把用户选的文件变成「一张能贴到舞台上的图」。
 *
 * 关键动作是缩到 1800px 内：手机拍的海报原图往往 3–5MB，
 * 直接存进 IndexedDB 既慢又占地方；1800px 已经够看清楚 12px 的小字，
 * 也够 200% 放大看。
 */

export interface LoadedPoster {
  blob: Blob;
  /** 只在当前这一轮有效；刷新后用 posterId 重新从 IndexedDB 生成 */
  url: string;
  w: number;
  h: number;
  name: string;
}

async function decode(file: File, url: string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* SVG 等格式在某些浏览器里走不通，往下退 */
    }
  }
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('这张图打不开，换一张 PNG / JPG 试试'));
    img.src = url;
  });
  return img;
}

export async function loadPosterFile(file: File, maxSide = 1800): Promise<LoadedPoster> {
  if (!file.type.startsWith('image/')) throw new Error('这不是图片文件');
  if (file.size > 30 * 1024 * 1024) throw new Error('图片太大了（超过 30MB）');

  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await decode(file, srcUrl);
    const iw = 'width' in img ? img.width : 0;
    const ih = 'height' in img ? img.height : 0;
    if (!iw || !ih) throw new Error('读不出这张图的尺寸');

    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('这个浏览器开不了画布');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('图片转码失败');

    return {
      blob,
      url: URL.createObjectURL(blob),
      w,
      h,
      name: (file.name || '上传的海报').replace(/\.[^.]+$/, ''),
    };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

/**
 * 无后端分享：把整份活动数据压进 URL 的 hash 里。
 *
 * 为什么可以这么做：一份活动 JSON 压缩后通常 300–700 字节，
 * 放进链接完全可行，二维码也扫得动。这样「分享活动链接」这个功能
 * 不需要服务器、不需要账号，链接本身就是一个自包含的活动页。
 *
 * 诚实的局限（界面上会写）：
 *  - 上传的图片是 dataURL，几百 KB，塞不进链接 —— 分享时只带字段，不带图。
 *     示例海报走的是静态路径，所以能完整分享。
 *  - 链接长度有上限（浏览器 ~2MB，但二维码在 1.5KB 以上就很难扫）。
 */
import {
  FIELD_ORDER,
  type Confidence,
  type EventDoc,
  type Field,
  type Hotspot,
  type Origin,
  type Rect,
  type SpotAction,
} from './types';

const VERSION = 1;

type PackedField = [string, string, string, string, number[] | 0];

/** 自定义块：rect、label、text、action 首字母 */
type PackedSpot = [number[], string, string, string];

interface Packed {
  v: number;
  p: string;
  w: number;
  h: number;
  s: string;
  f: PackedField[];
  /** 字段之外自己圈的块；没有就不写这个键，旧链接照旧能解 */
  n?: PackedSpot[];
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b + '='.repeat((4 - (b.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function packDoc(doc: EventDoc): string {
  const keepPoster = doc.posterUrl.startsWith('/');
  const packed: Packed = {
    v: VERSION,
    p: keepPoster ? doc.posterUrl : '',
    w: doc.posterW,
    h: doc.posterH,
    s: doc.styleTag,
    f: FIELD_ORDER.map((key) => {
      const f = doc.fields.find((x) => x.key === key);
      if (!f || !f.value.trim()) return null;
      // note 是校样台里的说明文字，页面上用不到，不带 —— 链接能短 300 字左右
      const rect: number[] | 0 = f.rect ? [r2(f.rect.x), r2(f.rect.y), r2(f.rect.w), r2(f.rect.h)] : 0;
      return [f.key, f.value, f.confidence[0], f.origin[0], rect] as PackedField;
    }).filter(Boolean) as PackedField[],
  };
  const blocks = (doc.hotspots ?? []).filter((h) => h.rect && h.rect.w > 0 && h.rect.h > 0);
  if (blocks.length) {
    packed.n = blocks.map(
      (h): PackedSpot => [
        [r2(h.rect.x), r2(h.rect.y), r2(h.rect.w), r2(h.rect.h)],
        h.label.slice(0, 12),
        h.text.slice(0, 40),
        h.action[0],
      ]
    );
  }
  return toB64Url(new TextEncoder().encode(JSON.stringify(packed)));
}

export function unpackDoc(code: string): EventDoc | null {
  try {
    const json = JSON.parse(new TextDecoder().decode(fromB64Url(code))) as Packed;
    if (!json || json.v !== VERSION) return null;
    const confMap: Record<string, Confidence> = { h: 'high', l: 'low', n: 'none' };
    const originMap: Record<string, Origin> = { p: 'poster', m: 'manual', b: 'blank' };
    const fields: Field[] = (json.f ?? []).map(([key, value, conf, origin, rect]) => {
      const r = Array.isArray(rect) && rect.length === 4 ? rect : null;
      return {
        key: key as Field['key'],
        value,
        confidence: confMap[conf] ?? 'none',
        origin: originMap[origin] ?? 'poster',
        rect: r ? ({ x: r[0], y: r[1], w: r[2], h: r[3] } as Rect) : undefined,
      };
    });
    const now = Date.now();
    const actionMap: Record<string, SpotAction> = {
      w: 'when',
      p: 'place',
      c: 'price',
      s: 'signup',
      z: 'zoom',
    };
    const hotspots: Hotspot[] = (json.n ?? [])
      .filter((entry) => Array.isArray(entry) && Array.isArray(entry[0]) && entry[0].length === 4)
      .map(([r, label, text, action]) => ({
        id: `s${r[0]}${r[1]}`.replace(/[^a-z0-9]/gi, ''),
        rect: { x: r[0], y: r[1], w: r[2], h: r[3] } as Rect,
        label: label || '图上这一块',
        text: text || '',
        action: actionMap[action] ?? 'zoom',
      }));
    return {
      v: 1,
      id: 'shared-' + code.slice(0, 8),
      createdAt: now,
      updatedAt: now,
      source: 'fixture',
      posterUrl: json.p || '',
      posterName: '分享的活动',
      posterW: json.w || 900,
      posterH: json.h || 1270,
      styleTag: json.s || '',
      fields,
      ...(hotspots.length ? { hotspots } : {}),
      confirmed: true,
    };
  } catch {
    return null;
  }
}

export function shareUrl(doc: EventDoc): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}#/v/${packDoc(doc)}`;
}

/** 二维码密度提示：长了就扫不动 */
export function shareFitness(url: string): { ok: boolean; length: number } {
  // 1.6 KB 以内的链接，手机相机基本都能扫开；再长就该走去后端了
  return { ok: url.length <= 1600, length: url.length };
}

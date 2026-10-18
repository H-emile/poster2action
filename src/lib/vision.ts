/**
 * 视觉模型：把海报读成字段 + 可点块。
 *
 * 两种模型两种用法（按模型名自动认，也可以用 VISION_MODE 强制）：
 *  - chat/VL 模型（如 Qwen3-VL）：一次读成「字段 + 原文片段 + 位置」，走 json 模式；
 *  - 纯 OCR 模型（如 DeepSeek-OCR）：只把整页文字抄下来，没有位置，走 ocr 模式——
 *    位置仍然要人圈，模型只解决「打中文慢」这一件事。
 *
 * 三条硬规矩（写在代码里，不靠自觉）：
 *  1. key 不进前端。调用走 `/api/llm`，由 Vite 的本地代理在 Node 侧加 Authorization；
 *     所以这套只在 `npm run dev` 里可用，静态部署要另配代理——界面上会说清楚。
 *  2. 模型说什么都要带出处。每个字段带 `quote`（海报原文）和 `bbox`（位置），
 *     拿不到 quote 的一律降成「不太确定」，拿不到 bbox 就不画框、标「无出处」。
 *  3. 不覆盖人已经写下的东西。只填空字段，覆盖要人自己动手。
 */
import type { Confidence, EventDoc, FieldKey, Hotspot, Rect, SpotAction } from './types';
import { emptyFields, FIELD_ORDER } from './types';

const ENDPOINT = '/api/llm/v1/chat/completions';

const SYSTEM = `你是活动海报信息抽取器。只输出一个 JSON 对象，不要解释、不要 markdown 代码块。

JSON 结构：
{"fields":{"title":{},"subtitle":{},"when":{},"venue":{},"address":{},"price":{},"signup":{},"contact":{},"audience":{},"summary":{}},
 "hotspots":[{"label":"","action":"when|place|price|signup|zoom","quote":"","bbox":[0,0,1,1]}]}

每个 field 的结构：{"value":"","quote":"","bbox":[0,0,1,1],"confidence":"high|low"}

规则：
1. value 用海报上的原文，不要改写，不要补充海报上没有的信息（尤其不要推断年份、星期）。
2. quote 必须是海报上能原样找到的一段文字。
3. bbox 是这块文字在海报上的位置 [x, y, w, h]，全部是 0 到 1 的比例，x/y 是左上角。
4. 海报上确实没有的字段，value 和 quote 都写空字符串，bbox 写 [0,0,0,0]。
5. confidence 只有两种：字迹清楚写 high，模糊或缺字写 low。
6. hotspots 放「除了上面字段之外、观众可能想点的碎信息」（免费入场、猫可入场、摊位还剩几个、二维码），最多 6 个，没有就给空数组 []。`;

export type VisionMode = 'json' | 'ocr';

/** 按模型名认模式；VISION_MODE 可在 .env.local 里强制覆盖 */
export function modeFor(model: string): VisionMode {
  if (/ocr/i.test(model)) return 'ocr';
  return 'json';
}

const OCR_PROMPT =
  '<image>\nFree OCR. 把这张海报上的文字按阅读顺序一行一段抄下来，保留原文和标点，不要解释、不要总结、不要翻译。';

export interface VisionField {
  value?: string;
  quote?: string;
  bbox?: number[];
  confidence?: string;
}

/** OCR 模式的产物：只有文字，没有位置 */
export interface OcrResult {
  lines: string[];
}

export interface VisionResult {
  fields?: Partial<Record<FieldKey, VisionField>>;
  hotspots?: { label?: string; action?: string; quote?: string; bbox?: number[] }[];
}

export interface VisionHealth {
  ok: boolean;
  model: string;
}

export async function visionHealth(): Promise<VisionHealth> {
  try {
    const r = await fetch('/api/llm/health', { cache: 'no-store' });
    if (!r.ok) return { ok: false, model: '' };
    const j = (await r.json()) as VisionHealth;
    return { ok: Boolean(j.ok), model: j.model || '' };
  } catch {
    return { ok: false, model: '' };
  }
}

/** 把 0..1 的 bbox 收敛成内部 Rect；模型有时给的是右下角坐标，这里兼容一下 */
export function toRect(bbox: unknown): Rect | undefined {
  if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;
  const [a, b, c, d] = bbox.map((n) => (typeof n === 'number' ? n : Number(n)));
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return undefined;
  // 角坐标：x+w 超过 1 一点点，说明第三、四个是 x1/y1
  const cornery = a + c > 1.002 || b + d > 1.002;
  const x = Math.min(Math.max(a, 0), 1);
  const y = Math.min(Math.max(b, 0), 1);
  const w = cornery ? Math.min(Math.max(c - a, 0), 1 - x) : Math.min(Math.max(c, 0), 1 - x);
  const h = cornery ? Math.min(Math.max(d - b, 0), 1 - y) : Math.min(Math.max(d, 0), 1 - y);
  if (w < 0.004 || h < 0.002) return undefined;
  return { x, y, w, h };
}

function parseJson(text: string): VisionResult {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t) as VisionResult;
}

const ACTIONS = new Set<SpotAction>(['when', 'place', 'price', 'signup', 'zoom']);

export interface VisionRun {
  mode: VisionMode;
  /** json 模式的结果；ocr 模式下是 undefined */
  result?: VisionResult;
  /** ocr 模式：整页抄下来的文字，一行一条 */
  lines?: string[];
  ms: number;
  model: string;
}

/** 真打一次模型。超时、非 200、JSON 坏了都要带人话抛出来。 */
const MOCK_LINES = [
  'CAMPUS FILM SOCIETY PRESENTS',
  '午夜放映',
  'BLADE RUNNER',
  '11.13 周五 22:00',
  '通宵连映 · 散场约 01:30',
  '图书馆负一层 · 影音厅',
  '电梯直达 B1，出电梯左手边',
  '¥15 / 人（含爆米花）',
  '限 60 人 · 影迷会成员优先',
  '扫码进群报名，人满即止',
  '联系人：周 18600001111',
];

/** 模拟模式：不花钱，用来验证界面和流程（模型名以 mock 开头即触发） */
export function isMockModel(model: string): boolean {
  return /^mock/i.test(model);
}

export async function readPoster(dataUrl: string, model: string, signal?: AbortSignal): Promise<VisionRun> {
  const t0 = performance.now();
  const mode = modeFor(model);

  if (isMockModel(model)) {
    await new Promise((r) => setTimeout(r, 700));
    const ms = Math.round(performance.now() - t0);
    if (mode === 'ocr') return { mode, lines: MOCK_LINES, ms, model };
    return {
      mode,
      ms,
      model,
      result: {
        fields: {
          title: { value: '午夜放映', quote: '午夜放映', bbox: [0.24, 0.12, 0.76, 0.28], confidence: 'high' },
          subtitle: { value: 'BLADE RUNNER', quote: 'BLADE RUNNER', bbox: [0.27, 0.28, 0.73, 0.35], confidence: 'high' },
          when: { value: '11.13 周五 22:00', quote: '11.13 周五 22:00', bbox: [0.31, 0.35, 0.69, 0.4], confidence: 'high' },
        },
        hotspots: [
          { label: '免费入场', action: 'zoom', quote: '免费入场', bbox: [0.3, 0.6, 0.6, 0.66] },
        ],
      },
    };
  }
  const body =
    mode === 'ocr'
      ? {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: OCR_PROMPT },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0,
          max_tokens: 2000,
        }
      : {
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: '抽取出这张海报上的活动信息。' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 1600,
          response_format: { type: 'json_object' },
        };
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    if (r.status === 402) {
      throw new Error('账户额度不足（402）：这个 key 能用，但余额或免费额度已经用完。充值后重试，或换一个有额度的 key——手动圈框那条路完全不受影响。');
    }
    if (r.status === 401) {
      throw new Error('key 没被接受（401）：检查 .env.local 里的 SILICONFLOW_API_KEY，改完要重启 dev server。');
    }
    if (r.status === 429) {
      throw new Error('请求太密（429）：等十几秒再点一次。');
    }
    throw new Error(`模型返回 ${r.status}：${text.slice(0, 160) || '没有内容'}`);
  }
  const j = (await r.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
  };
  const text = j.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('模型没有返回内容');
  const ms = Math.round(performance.now() - t0);
  const name = j.model || model;

  if (mode === 'ocr') {
    const lines = text
      .split(/\r?\n+/)
      .map((l) => l.replace(/^[-*·\s]+/, '').trim())
      .filter((l) => l.length > 0);
    if (!lines.length) throw new Error('模型没有抄到任何文字');
    return { mode, lines, ms, model: name };
  }

  let result: VisionResult;
  try {
    result = parseJson(text);
  } catch {
    throw new Error('模型返回的不是可解析的 JSON——换一个会输出 JSON 的模型，或者换成纯 OCR 模型（名字里带 OCR 的那种）。');
  }
  return { mode, result, ms, model: name };
}

export interface ApplyStats {
  filled: number;
  kept: number;
  hotspots: number;
  noBox: number;
}

/**
 * 把模型结果写进 doc：
 *  - 只填空字段（kept = 因为已有内容而没动的）
 *  - 有 quote 才算模型读到的（confidence 才可能 high），没 quote 一律 low
 *  - 没 bbox 就不画框，note 里说「没有位置」
 */
export function applyVision(doc: EventDoc, run: { model: string; result?: VisionResult }): {
  doc: EventDoc;
  stats: ApplyStats;
} {
  const stats: ApplyStats = { filled: 0, kept: 0, hotspots: 0, noBox: 0 };
  const incoming = run.result?.fields ?? {};
  const fields = (doc.fields.length ? doc.fields : emptyFields()).map((f) => {
    const hit = incoming[f.key];
    const value = (hit?.value ?? '').trim();
    const quote = (hit?.quote ?? '').trim();
    if (!value) return f;
    if (f.value.trim()) {
      stats.kept += 1;
      return f;
    }
    const rect = toRect(hit?.bbox);
    const confident: Confidence = rect && quote ? (hit?.confidence === 'low' ? 'low' : 'high') : 'low';
    stats.filled += 1;
    if (!rect) stats.noBox += 1;
    return {
      ...f,
      value,
      rect,
      confidence: confident,
      origin: 'poster' as const,
      note: rect
        ? '模型读的。框是它给的位置，请对照原图确认。'
        : '模型读的，但没给出位置——想点回原图，自己框一下。',
    };
  });

  const existing = doc.hotspots ?? [];
  const takenLabels = new Set(existing.map((h) => h.label));
  const added: Hotspot[] = [];
  for (const h of run.result?.hotspots ?? []) {
    const label = (h.label ?? '').trim().slice(0, 20);
    const rect = toRect(h.bbox);
    if (!label || !rect || takenLabels.has(label)) continue;
    if (added.length >= 6) break;
    const action: SpotAction = ACTIONS.has(h.action as SpotAction) ? (h.action as SpotAction) : 'zoom';
    added.push({
      id: 'm' + Math.random().toString(36).slice(2, 7),
      rect,
      label,
      text: (h.quote ?? '').trim().slice(0, 80),
      action,
    });
    takenLabels.add(label);
  }
  stats.hotspots = added.length;

  return {
    doc: {
      ...doc,
      fields,
      hotspots: added.length ? [...existing, ...added] : doc.hotspots,
      updatedAt: Date.now(),
    },
    stats,
  };
}

/** 计算用不上的字段键也列出来，方便测试断言顺序一致 */
export const VISION_FIELD_ORDER = FIELD_ORDER;

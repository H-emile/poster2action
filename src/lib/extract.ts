/**
 * 提取层：把「一张海报」变成「一份带坐标的字段草稿」。
 *
 * 现在有两通道，都走同一个 Field[] 结构：
 *  1. fixture —— 示例海报，坐标是脚本排版时记录的，等价于模型输出；
 *  2. upload  —— 用户自己的海报，字段全空，由用户在图上拖框 + 手填。
 *
 * 第三条通道（视觉模型）故意留空，接的时候只改这个文件：
 * 模型必须同时给出 value 和 rect（归一化 0–1），并且**只能抄海报上有的字**。
 * 读不清就给 confidence:'low' + note，读不到就给 'none'，由人补。
 * 绝对不要用「常见值」去填充没看见的字段 —— 这是本项目信任感的来源。
 */
import fixturesJson from './samples/fixtures.json';
import { FIELD_META, FIELD_ORDER, emptyFields, type Confidence, type EventDoc, type Field, type Rect } from './types';
import { newId } from './store';

interface FixtureField {
  value: string;
  rect: Rect;
}
interface Fixture {
  id: string;
  posterUrl: string;
  meta: {
    title: string;
    style: string;
    width: number;
    height: number;
    month: number;
    day: number;
    notes?: Record<string, { confidence: Confidence; note: string }>;
  };
  fields: Record<string, FixtureField>;
}

export const FIXTURES = fixturesJson as unknown as Record<string, Fixture>;

export function fixtureIds(): string[] {
  return Object.keys(FIXTURES);
}

export function docFromFixture(id: string): EventDoc {
  const fx = FIXTURES[id];
  if (!fx) throw new Error(`没有示例海报 ${id}`);
  const now = Date.now();
  const fields: Field[] = FIELD_ORDER.map((key) => {
    const src = fx.fields[key];
    const noted = fx.meta.notes?.[key];
    return {
      key,
      value: src?.value ?? '',
      rect: src?.rect,
      confidence: noted?.confidence ?? (src ? 'high' : 'none'),
      origin: src ? 'poster' : 'blank',
      note: noted?.note,
    } satisfies Field;
  });
  return {
    v: 1,
    id: `fx-${id}`,
    createdAt: now,
    updatedAt: now,
    source: 'fixture',
    posterUrl: fx.posterUrl,
    posterName: fx.meta.title,
    posterW: fx.meta.width,
    posterH: fx.meta.height,
    styleTag: fx.meta.style,
    fields,
    confirmed: false,
  };
}

export function docFromUpload(posterUrl: string, name: string, w: number, h: number): EventDoc {
  const now = Date.now();
  return {
    v: 1,
    id: newId('up'),
    createdAt: now,
    updatedAt: now,
    source: 'upload',
    posterUrl,
    posterName: name,
    posterW: w,
    posterH: h,
    styleTag: '你自己上传的海报',
    fields: emptyFields(),
    confirmed: false,
  };
}

/* --------------------------------------------------- 预留：视觉模型适配层 */

export interface VisionAdapter {
  name: string;
  extract(imageDataUrl: string): Promise<Field[]>;
}

/**
 * 接入方式（有 Key 时）：
 *   1. 实现 extract()：调视觉模型，要求返回 JSON:
 *      [{ "key": "when", "value": "11月8日 周六 14:00", "rect": [x,y,w,h], "confidence": "high", "note": "" }]
 *      rect 是归一化坐标（0–1），左上角为原点。
 *   2. 提示词里必须写死：只抄海报上出现的文字；看不清标 low；没有该字段就不要返回。
 *   3. 把 visionAdapter 指向实现即可，UI 的「识别来源」会自动显示为模型输出。
 */
export const visionAdapter: VisionAdapter | null = null;

export function fieldLabel(key: string): string {
  return FIELD_META[key as keyof typeof FIELD_META]?.label ?? key;
}

/**
 * 活海报的「可点区域」。
 *
 * 为什么要单独一层：校样台里的框属于字段，但活海报上能点的不止字段——海报上
 * 「猫可入场」「自带耳机」这类碎信息不属于任何字段，也值得能点、能放大。
 * 所以活海报的区域有两个来源：字段自带的 rect + doc.hotspots 里的自定义块。
 *
 * 这里只做一件事：把两者合并成同一份、排好序、带动作的 Spot 列表。
 * 纯函数，没有 DOM，可以被 scripts/check-hotspots.mjs 直接断言。
 */
import {
  FIELD_META,
  FIELD_ORDER,
  type EventDoc,
  type FieldKey,
  type Rect,
  type SpotAction,
} from './types';
import type { EventModel } from './derive';

export type { SpotAction };

export interface Spot {
  /** 'f-when'（字段）或 'h-<id>'（自定义块） */
  id: string;
  rect: Rect;
  label: string;
  text: string;
  action: SpotAction;
  fieldKey?: FieldKey;
  /** 海报上显示的编号，1 起，按从上到下、从左到右排 */
  index: number;
}

/** 字段 → 点开之后能干什么。集中一处，方便测试与以后调整。 */
const FIELD_ACTION: Record<FieldKey, SpotAction> = {
  title: 'zoom',
  subtitle: 'zoom',
  when: 'when',
  venue: 'place',
  address: 'place',
  price: 'price',
  signup: 'signup',
  audience: 'zoom',
  contact: 'zoom',
  summary: 'zoom',
};

const byReadingOrder = (a: { rect: Rect }, b: { rect: Rect }) => {
  // 先按纵坐标分档（同一行里的两块不因为几像素错位就换顺序），再按横坐标
  const rowA = Math.round(a.rect.y * 20);
  const rowB = Math.round(b.rect.y * 20);
  return rowA - rowB || a.rect.x - b.rect.x;
};

export function collectSpots(doc: EventDoc): Spot[] {
  const fromFields: Spot[] = [];
  for (const key of FIELD_ORDER) {
    const f = doc.fields.find((x) => x.key === key);
    if (!f?.rect) continue;
    fromFields.push({
      id: `f-${key}`,
      rect: f.rect,
      label: FIELD_META[key].label,
      text: f.value.trim(),
      action: FIELD_ACTION[key],
      fieldKey: key,
      index: 0,
    });
  }

  const fromBlocks: Spot[] = (doc.hotspots ?? [])
    .filter((h) => h.rect && h.rect.w > 0 && h.rect.h > 0)
    .map((h) => ({
      id: `h-${h.id}`,
      rect: h.rect,
      label: h.label || '图上这一块',
      text: h.text ?? '',
      action: h.action,
      index: 0,
    }));

  const all = [...fromFields, ...fromBlocks].sort(byReadingOrder);
  return all.map((s, i) => ({ ...s, index: i + 1 }));
}

export interface SpotCapability {
  canCalendar: boolean;
  canNavigate: boolean;
  canSignup: boolean;
  canCopy: boolean;
  /** 这块只能放大看，没有别的动作 */
  zoomOnly: boolean;
}

export function spotCapabilities(spot: Spot, model: EventModel): SpotCapability {
  const canCalendar = spot.action === 'when' && Boolean(model.when.startISO);
  const canNavigate = spot.action === 'place' && Boolean(model.venue || model.address);
  const canSignup = spot.action === 'signup' && Boolean(model.signupUrl);
  const canCopy = Boolean(spot.text);
  return {
    canCalendar,
    canNavigate,
    canSignup,
    canCopy,
    zoomOnly: !canCalendar && !canNavigate && !canSignup && !canCopy,
  };
}

/** 抽屉里那句「这块还没录成文字」要不要显示 */
export function spotNeedsText(spot: Spot): boolean {
  return !spot.text;
}

export const SPOT_ACTION_LABEL: Record<SpotAction, string> = {
  when: '时间',
  place: '地点',
  price: '费用',
  signup: '报名',
  zoom: '放大看',
};

export const SPOT_ACTION_HINT: Record<SpotAction, string> = {
  when: '点开能加日历、复制时间',
  place: '点开能导航、复制地址',
  price: '点开能复制这句',
  signup: '点开能去报名',
  zoom: '点开把这一块放大',
};

export type FieldKey =
  | 'title'
  | 'subtitle'
  | 'when'
  | 'venue'
  | 'address'
  | 'price'
  | 'signup'
  | 'audience'
  | 'contact'
  | 'summary';

export type Confidence = 'high' | 'low' | 'none';

/** 这个值是怎么来的：海报上读到的 / 用户改过的 / 空 */
export type Origin = 'poster' | 'manual' | 'blank';

/** 归一化到 0–1 的海报坐标，跟图片实际像素无关 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 活海报上点开一块之后能干什么 */
export type SpotAction = 'when' | 'place' | 'price' | 'signup' | 'zoom';

/**
 * 海报上的「自定义块」：不属于 10 个字段，但也值得能点、能放大的碎信息
 * （猫可入场、自带耳机、分两场不同的厅…）。
 * 字段自带的坐标不复制到这里，两份坐标会不同步。
 */
export interface Hotspot {
  id: string;
  rect: Rect;
  label: string;
  text: string;
  action: SpotAction;
}

export interface Field {
  key: FieldKey;
  value: string;
  rect?: Rect;
  confidence: Confidence;
  origin: Origin;
  /** 为什么不确定 / 为什么要核对，一句话 */
  note?: string;
  /** 用户第一次改动前的原文，用于展示差异 */
  original?: string;
}

export interface EventDoc {
  v: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  source: 'fixture' | 'upload';
  posterUrl: string;
  /** 上传的海报：图片本体存在 IndexedDB 里，这个 id 是取图的钥匙 */
  posterId?: string;
  /** 图片存在哪；memory 表示这一轮有效，刷新就没 */
  posterStore?: 'idb' | 'memory';
  posterName: string;
  posterW: number;
  posterH: number;
  /** 风格标签，仅示例海报有，例如「双色凸版 · 陶艺系毕业展」 */
  styleTag: string;
  fields: Field[];
  /** 字段之外、自己圈出来的块；活海报上它们也能点 */
  hotspots?: Hotspot[];
  confirmed: boolean;
}

export const FIELD_ORDER: FieldKey[] = [
  'title',
  'subtitle',
  'when',
  'venue',
  'address',
  'price',
  'signup',
  'audience',
  'contact',
  'summary',
];

export const FIELD_META: Record<
  FieldKey,
  { label: string; short: string; hint: string; placeholder: string; core: boolean }
> = {
  title: {
    label: '活动名称',
    short: '名称',
    hint: '海报上最醒目的那行字',
    placeholder: '海报上没找到，请手动填写',
    core: true,
  },
  subtitle: {
    label: '主办 / 副标题',
    short: '主办',
    hint: '谁办的，或者副标题',
    placeholder: '可选',
    core: false,
  },
  when: {
    label: '时间',
    short: '时间',
    hint: '日期 + 几点到几点，照抄海报原文',
    placeholder: '例如：11月8日 周六 14:00–17:30',
    core: true,
  },
  venue: {
    label: '场地',
    short: '场地',
    hint: '楼名、房间号、场地俗称',
    placeholder: '例如：美术馆 二层 白盒子展厅',
    core: true,
  },
  address: {
    label: '地址 / 怎么走',
    short: '地址',
    hint: '能导航的地址，或者「从哪进」',
    placeholder: '例如：云栖路 88 号，地铁 4 号线 B 口',
    core: false,
  },
  price: {
    label: '费用',
    short: '费用',
    hint: '免费、票价、是否含餐',
    placeholder: '例如：免费 / 学生票 15 元',
    core: true,
  },
  signup: {
    label: '报名 / 入场方式',
    short: '报名',
    hint: '要不要报名、怎么报、什么时候截止',
    placeholder: '例如：扫码进群报名，限 60 人',
    core: true,
  },
  audience: {
    label: '适合谁',
    short: '适合',
    hint: '面向谁、人数限制、能不能带人',
    placeholder: '可选',
    core: false,
  },
  contact: {
    label: '联系方式',
    short: '联系',
    hint: '负责人、电话、邮箱',
    placeholder: '可选',
    core: false,
  },
  summary: {
    label: '活动介绍',
    short: '介绍',
    hint: '海报上那几句说明文字，原样抄下来',
    placeholder: '可选，一句话说清这是什么活动',
    core: false,
  },
};

export const CONF_LABEL: Record<Confidence, string> = {
  high: '看得清',
  low: '不太确定',
  none: '图上没有',
};

export function emptyFields(): Field[] {
  return FIELD_ORDER.map((key) => ({
    key,
    value: '',
    confidence: 'none' as Confidence,
    origin: 'blank' as Origin,
  }));
}

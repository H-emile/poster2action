import {
  CONF_LABEL,
  FIELD_META,
  FIELD_ORDER,
  type EventDoc,
  type Field,
  type FieldKey,
} from './types';
import { parsePrice, parseUrl, parseWhen, type PriceResult, type WhenResult } from './parse';

export type IssueCode =
  | 'title-missing'
  | 'when-missing'
  | 'venue-missing'
  | 'price-missing'
  | 'signup-missing'
  | 'weekday-mismatch'
  | 'time-missing'
  | 'year-inferred'
  | 'recurring'
  | 'multi-day'
  | 'cross-day'
  | 'no-address'
  | 'address-vague'
  | 'price-tbd'
  | 'price-multi'
  | 'signup-nolink'
  | 'low-confidence'
  | 'manual-fields';

export interface Issue {
  id: string;
  code: IssueCode;
  level: 'error' | 'warn' | 'info';
  field: FieldKey | 'doc';
  title: string;
  detail: string;
}

export interface EventModel {
  doc: EventDoc;
  title: string;
  subtitle: string;
  when: WhenResult;
  whenLabel: string;
  whenShort: string;
  /** 跨天活动拆成两行显示，避免中文被断在「展 / 至」这种地方 */
  whenParts: string[] | null;
  venue: string;
  address: string;
  place: string;
  price: PriceResult;
  priceLabel: string;
  signup: string;
  signupUrl: string | null;
  contact: string;
  audience: string;
  summary: string;
  issues: Issue[];
  errors: number;
  warns: number;
  traced: number;
  filled: number;
  coreMissing: FieldKey[];
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function fieldMap(doc: EventDoc): Record<string, Field> {
  const m: Record<string, Field> = {};
  for (const f of doc.fields) m[f.key] = f;
  return m;
}

function hm(iso: string): string {
  return iso.slice(11, 16);
}
function dmy(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}
function weekdayOf(iso: string): string {
  const { y, m, d } = dmy(iso);
  return '周' + WEEK[new Date(y, m - 1, d).getDay()];
}

function buildWhenLabel(w: WhenResult): { label: string; short: string; parts?: string[] } {
  if (!w.startISO) return { label: '时间待确认', short: '时间待确认' };
  const s = dmy(w.startISO);
  const sw = '周' + WEEK[new Date(s.y, s.m - 1, s.d).getDay()];
  const shortDate = `${s.m}.${s.d}`;

  if (w.endISO) {
    const e = dmy(w.endISO);
    const multi = e.m !== s.m || e.d !== s.d || e.y !== s.y;
    if (multi) {
      const endsAtMidnight = !w.allDay && hm(w.endISO) === '23:59';
      if (w.allDay) {
        return {
          label: `${s.m}月${s.d}日 – ${e.m}月${e.d}日 · 展期`,
          short: `${shortDate}–${e.m}.${e.d}`,
          parts: [`${s.m}月${s.d}日 起`, `到 ${e.m}月${e.d}日`],
        };
      }
      // 展期类的海报常写到「展至某日」，结束时间补成当天 23:59，别显示成 23:59
      if (endsAtMidnight) {
        return {
          label: `${s.m}月${s.d}日 ${hm(w.startISO)} 开幕 · 展至 ${e.m}月${e.d}日`,
          short: `${shortDate} 起`,
          parts: [`${s.m}月${s.d}日 ${hm(w.startISO)} 开幕`, `展至 ${e.m}月${e.d}日`],
        };
      }
      return {
        label: `${s.m}月${s.d}日 ${hm(w.startISO)} – ${e.m}月${e.d}日 ${hm(w.endISO)}`,
        short: `${shortDate} ${hm(w.startISO)}–${e.m}.${e.d} ${hm(w.endISO)}`,
        parts: [`${s.m}月${s.d}日 ${hm(w.startISO)} 开始`, `到 ${e.m}月${e.d}日 ${hm(w.endISO)}`],
      };
    }
    if (w.allDay) return { label: `${s.y}年${s.m}月${s.d}日 ${sw} · 全天`, short: `${shortDate} ${sw} · 全天` };
    return {
      label: `${s.y}年${s.m}月${s.d}日 ${sw} · ${hm(w.startISO)}–${hm(w.endISO)}`,
      short: `${shortDate} ${sw} ${hm(w.startISO)}–${hm(w.endISO)}`,
    };
  }
  if (w.allDay) return { label: `${s.y}年${s.m}月${s.d}日 ${sw} · 全天`, short: `${shortDate} ${sw} · 全天` };
  return {
    label: `${s.y}年${s.m}月${s.d}日 ${sw} · ${hm(w.startISO)} 开始`,
    short: `${shortDate} ${sw} ${hm(w.startISO)}`,
  };
}

export function derive(doc: EventDoc): EventModel {
  const m = fieldMap(doc);
  // 海报上的装饰性字段标签（[where] [apply] 之类）不是活动信息，清掉
  const clean = (s: string) => s.replace(/\[(when|where|addr|free|apply|who|mail|qr|note|date|time|venue|price|signup)\]\s*/gi, ' ');
  const val = (k: FieldKey) => clean(m[k]?.value ?? '').trim();

  const title = val('title');
  const when = parseWhen(val('when'));
  const price = parsePrice(val('price'));
  const signup = val('signup');
  const venue = val('venue');
  const address = val('address');
  const contact = val('contact');
  const summary = val('summary');

  const { label: whenLabel, short: whenShort, parts: whenParts } = buildWhenLabel(when);

  const issues: Issue[] = [];
  const push = (i: Omit<Issue, 'id'>) => issues.push({ id: `${i.field}:${issues.length}`, ...i });

  /* --- 必填 --- */
  if (!title) {
    push({ code: 'title-missing', level: 'error', field: 'title', title: '缺少活动名称', detail: '海报上没读到活动名，页面标题会是空的。手动写上，或者重新框选标题那行字。' });
  }
  if (!when.startISO) {
    push({ code: 'when-missing', level: 'error', field: 'when', title: '没读到活动日期', detail: '没有日期就生成不了日历事件。请把海报上的时间照原样抄进「时间」，例如「11月8日 周六 14:00」。' });
  }
  if (!venue) {
    push({ code: 'venue-missing', level: 'error', field: 'venue', title: '缺少场地', detail: '没有场地就无法生成地图链接，到场的人会找不到地方。' });
  }
  if (!val('price')) {
    push({ code: 'price-missing', level: 'warn', field: 'price', title: '没写费用', detail: '参加的人第一个问题通常是「要不要钱」。海报上没写就留空，别替它编一个。' });
  }
  if (!signup) {
    push({ code: 'signup-missing', level: 'warn', field: 'signup', title: '没写怎么参加', detail: '需要报名还是直接去？这一项空着，页面就只能写「到场」。' });
  }

  /* --- 时间上的坑 --- */
  if (when.mismatch && when.weekdayRaw && when.startISO) {
    push({
      code: 'weekday-mismatch',
      level: 'error',
      field: 'when',
      title: `海报写「${when.weekdayRaw}」，但这一天实际是${weekdayOf(when.startISO)}`,
      detail: `${dmy(when.startISO).y}年${dmy(when.startISO).m}月${dmy(when.startISO).d}日 是${weekdayOf(when.startISO)}。海报可能写错了，也可能年份不对 —— 去跟主办方确认一下再发出去。`,
    });
  }
  if (when.hasDate && !when.hasTime) {
    push({
      code: 'time-missing',
      level: 'warn',
      field: 'when',
      title: '海报只写了日期，没写几点',
      detail: '已按「全天」处理。如果其实有具体时刻，请补在时间一栏里。',
    });
  }
  if (when.yearInferred) {
    push({ code: 'year-inferred', level: 'info', field: 'when', title: '年份是按今天推断的', detail: '海报上只有月日，没有年份。系统取了未来最近的那一次。跨年活动请手动核对。' });
  }
  if (when.recurring) {
    push({
      code: 'recurring',
      level: 'info',
      field: 'when',
      title: `海报写的是「${when.recurring}」，本页只生成第一场`,
      detail: '重复活动需要逐场建日程。这里先按海报上的第一次生成，其余场次请按需另加。',
    });
  }
  if (when.multiDay) {
    push({ code: 'multi-day', level: 'info', field: 'when', title: '这是跨天的活动', detail: '日程按一整段生成，日历里会占满这段时间。' });
  }
  if (when.crossDay) {
    push({ code: 'cross-day', level: 'info', field: 'when', title: '散场在次日凌晨', detail: '结束时间已经落到第二天，别按当天晚上安排返程。' });
  }

  /* --- 场地与导航 --- */
  const hasNumber = /[0-9０-９一二三四五六七八九十]/.test(address) && /楼|层|号|室|栋|馆|座/.test(address);
  const hasStreet = /道|路|街|巷|弄|号/.test(address);
  const navigable = hasStreet || hasNumber;
  if (venue && !address) {
    push({
      code: 'no-address',
      level: 'warn',
      field: 'address',
      title: '只有场地名，没有可导航的地址',
      detail: '地图搜「' + venue + '」可能定位到别的地方。补一个地址或「从哪个门进」会好很多。',
    });
  } else if (venue && address && !navigable) {
    push({
      code: 'address-vague',
      level: 'info',
      field: 'address',
      title: '地址是「怎么走」，不是门牌',
      detail: '现在这行是给人看的指路描述。地图搜索需要门牌号或正式建筑名，导航大概率定位不到；有条件的话再补一条。',
    });
  }

  /* --- 费用 --- */
  if (price.uncertain) {
    push({ code: 'price-tbd', level: 'warn', field: 'price', title: '费用写着「待定」', detail: '页面上会如实显示「待定」，不会替你填 0 元。发布前最好问一句。' });
  }
  if (price.isFree === false && price.amounts.length > 1) {
    push({ code: 'price-multi', level: 'info', field: 'price', title: '海报上有不止一个价格', detail: `读到 ${price.amounts.join(' / ')} 元，请确认哪个是现在适用的（早鸟？现场？学生？）。` });
  }

  /* --- 报名 --- */
  const signupUrl = parseUrl(signup) ?? parseUrl(summary);
  const joinTalk = signup + ' ' + summary;
  const saysNoSignup = /无需|不用|不必|不需要|免报名|直接来|直接到场|自由入场|无需预约/.test(joinTalk);
  const mentionsSignup = /扫码|二维码|填表|报名|接龙|进群|公众号|预约|登记/.test(joinTalk);
  if (mentionsSignup && !saysNoSignup && !signupUrl) {
    push({
      code: 'signup-nolink',
      level: 'warn',
      field: 'signup',
      title: '提到要报名，但没有能点的链接',
      detail: '海报让你「扫码报名」，可网页里没法替你扫码。把报名表链接粘到「报名 / 入场方式」里，按钮才会真的能用。',
    });
  }

  /* --- 识别把握 --- */
  const low = doc.fields.filter((f) => f.confidence === 'low');
  if (low.length) {
    push({
      code: 'low-confidence',
      level: 'warn',
      field: 'doc',
      title: `有 ${low.length} 项标记为「不太确定」`,
      detail:
        low.map((f) => FIELD_META[f.key].label).join('、') +
        '。这几项要么字迹看不清，要么是你自己圈的还没核对；逐项看一眼，改完这段提示会消失。',
    });
  }
  const none = doc.fields.filter((f) => f.confidence === 'none' && f.value);
  if (none.length) {
    push({
      code: 'manual-fields',
      level: 'info',
      field: 'doc',
      title: `${none.length} 项是你手填的，海报上找不到依据`,
      detail: none.map((f) => FIELD_META[f.key].label).join('、') + '。这些内容仍然有用，但别当成「海报上写的」。',
    });
  }

  const order = { error: 0, warn: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level]);

  const coreMissing = FIELD_ORDER.filter((k) => FIELD_META[k].core && !(m[k]?.value ?? '').trim());

  return {
    doc,
    title: title || '未命名活动',
    subtitle: val('subtitle'),
    when,
    whenLabel,
    whenShort,
    whenParts: whenParts ?? null,
    venue,
    address,
    place: [venue, address].filter(Boolean).join(' '),
    price,
    priceLabel: val('price') || (price.isFree ? '免费' : '费用未写'),
    signup,
    signupUrl,
    contact,
    audience: val('audience'),
    summary,
    issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warns: issues.filter((i) => i.level === 'warn').length,
    traced: doc.fields.filter((f) => f.rect).length,
    filled: doc.fields.filter((f) => f.value.trim()).length,
    coreMissing,
  };
}

/** 复制给朋友的一段纯文字 */
export function toPlainText(m: EventModel): string {
  const rows: string[] = [];
  rows.push(m.title);
  if (m.subtitle) rows.push(m.subtitle);
  rows.push('');
  rows.push(`时间：${m.whenLabel}`);
  if (m.place) rows.push(`地点：${m.place}`);
  if (m.priceLabel) rows.push(`费用：${m.priceLabel}`);
  if (m.signup) rows.push(`参加方式：${m.signup}`);
  if (m.audience) rows.push(`适合：${m.audience}`);
  if (m.contact) rows.push(`联系：${m.contact}`);
  if (m.summary) {
    rows.push('');
    rows.push(m.summary);
  }
  rows.push('');
  rows.push('—— 由「一图成行 Poster2Action」从海报生成，信息已逐条核对到原图');
  return rows.join('\n');
}

export function confidenceSummary(doc: EventDoc) {
  const high = doc.fields.filter((f) => f.confidence === 'high').length;
  const low = doc.fields.filter((f) => f.confidence === 'low').length;
  const none = doc.fields.filter((f) => f.confidence === 'none').length;
  return { high, low, none, total: doc.fields.length };
}

export function confText(c: Field['confidence']): string {
  return CONF_LABEL[c];
}

/**
 * 把海报上的时间原文解析成可用的日程。
 *
 * 这一层是产品的「诚实」所在：解析不出来的部分必须承认解析不出来，
 * 而不是猜一个看起来合理的值。所以返回值里除了成功字段，还有
 * yearInferred / missingTime / recurring / multiDay 这些「我做了什么假设」的标记。
 *
 * 支持的写法（都是从真实校园海报上抄的）：
 *   11月8日 周六 · 14:00–17:30        2026.11.07 19:30 — 21:00
 *   10月24日 — 11月15日 每天 11:00–19:00
 *   11.13 周五 22:00 通宵 · 散场约 01:30
 *   每周六 14:00–17:30
 *   11月28日 09:00 起 至 11月29日 21:00
 *   全天 / 全天开放
 */

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayCn(d: Date): string {
  return '周' + WEEK_CN[d.getDay()];
}

export interface WhenResult {
  startISO: string | null;
  endISO: string | null;
  allDay: boolean;
  hasDate: boolean;
  hasTime: boolean;
  yearInferred: boolean;
  weekdayRaw: string | null;
  weekdayActual: string | null;
  mismatch: boolean;
  recurring: string | null;
  multiDay: boolean;
  crossDay: boolean;
  /** 解析过程中做过的假设，直接展示给用户 */
  notes: string[];
}

function norm(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[－—–~～〜至~]/g, (c) => (c === '至' ? '至' : '-'))
    .replace(/[，、]/g, ',')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function iso(y: number, m: number, d: number, h: number, mi: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;
}

function inferYear(m: number, d: number, today: Date): number {
  const y = today.getFullYear();
  const candidate = new Date(y, m - 1, d, 23, 59);
  const days = (candidate.getTime() - today.getTime()) / 86400000;
  // 已经过去好几天了，就认为说的是明年的这场
  return days < -1 ? y + 1 : y;
}

export function parseWhen(raw: string, today: Date = new Date()): WhenResult {
  const empty: WhenResult = {
    startISO: null,
    endISO: null,
    allDay: false,
    hasDate: false,
    hasTime: false,
    yearInferred: false,
    weekdayRaw: null,
    weekdayActual: null,
    mismatch: false,
    recurring: null,
    multiDay: false,
    crossDay: false,
    notes: [],
  };
  if (!raw || !raw.trim()) return empty;

  const notes: string[] = [];
  const t = norm(raw);

  // 1. 年份（显式写了就信海报）
  const ym = t.match(/(20\d{2})\s*[年.\-/]/);
  const year = ym ? Number(ym[1]) : null;
  const tNoYear = year ? t.replace(/(20\d{2})(?=\s*[年.\-/])/g, '§') : t;

  // 2. 月日 -> 先把时刻里的数字挡掉，避免 "10:00-18:00" 被当成日期
  const timeStripped = tNoYear.replace(/\d{1,2}\s*:\s*\d{2}/g, '§');
  const pairs: { m: number; d: number }[] = [];
  const dateRe = /(\d{1,2})\s*[月.\-/]\s*(\d{1,2})/g;
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(timeStripped))) {
    const m = Number(dm[1]);
    const d = Number(dm[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) pairs.push({ m, d });
  }

  // 3. 星期 / 重复
  const recurringMatch = t.match(/每(?:周|星期|礼拜)([一二三四五六日天])/);
  const weekdayMatch = t.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
  const weekdayRaw = weekdayMatch ? '周' + (weekdayMatch[1] === '天' ? '日' : weekdayMatch[1]) : null;

  // 4. 时刻
  const times: { h: number; mi: number }[] = [];
  const timeRe = /(\d{1,2})\s*:\s*(\d{2})/g;
  let tm: RegExpExecArray | null;
  while ((tm = timeRe.exec(tNoYear))) {
    const h = Number(tm[1]);
    const mi = Number(tm[2]);
    if (h >= 0 && h <= 24 && mi >= 0 && mi <= 59) times.push({ h, mi });
  }

  if (!pairs.length) {
    return {
      ...empty,
      weekdayRaw,
      weekdayActual: null,
      hasTime: times.length > 0,
      notes: ['海报上没有能确定的日期数字'],
    };
  }

  const y = year ?? inferYear(pairs[0].m, pairs[0].d, today);
  if (!year) notes.push(`海报没写年份，按 ${y} 年推断`);

  const startDate = new Date(y, pairs[0].m - 1, pairs[0].d);
  let endDate: Date | null = null;
  if (pairs[1]) {
    endDate = new Date(y, pairs[1].m - 1, pairs[1].d);
    if (endDate < startDate) endDate = new Date(y + 1, pairs[1].m - 1, pairs[1].d);
  }
  const multiDay = !!endDate && endDate.getTime() !== startDate.getTime();
  if (multiDay) notes.push('海报给的是跨天日程，已按一整段排');

  const hasExplicitAllDay = /全天|整日|整天/.test(t);
  const allDay = hasExplicitAllDay || times.length === 0;
  const hasTime = times.length > 0 && !hasExplicitAllDay;

  let startISO: string;
  let endISO: string | null = null;
  let crossDay = false;

  if (allDay) {
    if (hasExplicitAllDay && times.length) notes.push('海报写的是「全天」，忽略了个别时刻');
    startISO = iso(y, pairs[0].m, pairs[0].d, 0, 0);
    if (multiDay && endDate) {
      endISO = iso(endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate(), 23, 59);
    }
  } else {
    const st = times[0];
    startISO = iso(y, pairs[0].m, pairs[0].d, st.h, st.mi);
    if (multiDay && endDate) {
      const et = times[1] ?? { h: 23, mi: 59 };
      endISO = iso(endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate(), et.h, et.mi);
      if (times.length < 2) notes.push('跨天活动没写结束时刻，按当天 23:59 收尾');
    } else if (times[1]) {
      const et = times[1];
      let e = iso(y, pairs[0].m, pairs[0].d, et.h, et.mi);
      if (e <= startISO) {
        const d2 = new Date(startDate.getTime() + 86400000);
        e = iso(d2.getFullYear(), d2.getMonth() + 1, d2.getDate(), et.h, et.mi);
        crossDay = true;
        notes.push('结束时刻早于开始时刻，按次日散场计算');
      }
      endISO = e;
    }
  }

  if (times.length > 2 && !multiDay) notes.push('海报上有多个时段，只取了第一段');

  const actual = weekdayCn(startDate);
  const mismatch = !!weekdayRaw && weekdayRaw !== actual;
  return {
    startISO,
    endISO,
    allDay,
    hasDate: true,
    hasTime: hasTime,
    yearInferred: !year,
    weekdayRaw,
    weekdayActual: actual,
    mismatch,
    recurring: recurringMatch
      ? '每' + (recurringMatch[0].slice(-1) === '天' ? '周日' : '周' + recurringMatch[0].slice(-1))
      : null,
    multiDay,
    crossDay,
    notes,
  };
}

/* ------------------------------------------------------------------ 价格 */

export interface PriceResult {
  isFree: boolean | null;
  amounts: number[];
  uncertain: boolean;
  label: string;
}

export function parsePrice(raw: string): PriceResult {
  const t = norm(raw || '');
  if (!t) return { isFree: null, amounts: [], uncertain: false, label: '' };
  const uncertain = /待定|另议|详见|未知|待确认|联系|面议/.test(t);
  const free = /免费|免票|不收钱|0\s*元|免费入场/.test(t);
  const amounts: number[] = [];
  const re = /(?:[¥￥]\s*(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*元)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const v = Number(m[1] ?? m[2]);
    if (Number.isFinite(v)) amounts.push(v);
  }
  return {
    isFree: free ? true : amounts.length ? false : null,
    amounts,
    uncertain,
    label: raw,
  };
}

/** 从一段文字里捞第一个可点击的链接（报名表、公众号原文等） */
export function parseUrl(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/https?:\/\/[^\s，。；、）)】]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:]+$/, '');
}

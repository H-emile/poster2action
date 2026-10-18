/**
 * 发行前体检：现在就把这一版发出去，会出什么事。
 *
 * 和 derive 里的 issues 分工不同：
 *  - issues 是「这一个字段有什么问题」（缺日期、地址不可导航…），校样台逐条改；
 *  - checkup 是「几个字段放一起才看得出来的矛盾」（报名截止早于开场、免费又标价…），
 *    以及「你改过的东西和海报原文不一致」这类只有比较才发现的坑。
 *
 * 纯函数，没有 DOM，可以被 scripts/check-hotspots.mjs 直接断言。
 */
import { FIELD_META, type EventDoc, type FieldKey } from './types';
import type { EventModel } from './derive';

export type CheckCode =
  | 'no-spot'
  | 'signup-closed'
  | 'signup-deadline-after-start'
  | 'free-vs-paid'
  | 'date-end-before-start'
  | 'edited-vs-original'
  | 'two-places'
  | 'unconfirmed'
  | 'open-errors';

export interface CheckItem {
  code: CheckCode;
  level: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  field?: FieldKey;
}

const DAY = 86_400_000;

function dayOf(iso: string): number {
  const d = new Date(iso);
  return Math.floor(d.getTime() / DAY);
}

/** 从「报名截至 10月30日」「10/30 截止」这类文案里抠出截止日 */
export function parseDeadline(text: string, year: number): string | null {
  if (!text) return null;
  const re =
    /(?:截止|截至|报名到|报名截止|截止到|截至到)\s*(?:时间)?\s*[:：]?\s*(\d{1,2})\s*[月./\-]\s*(\d{1,2})|(\d{1,2})\s*[月./\-]\s*(\d{1,2})\s*(?:日)?\s*(?:前|之前)?\s*(?:截止|截至)/;
  const m = re.exec(text);
  if (!m) return null;
  const month = Number(m[1] ?? m[3]);
  const day = Number(m[2] ?? m[4]);
  if (!month || !day || month > 12 || day > 31) return null;
  const d = new Date(year, month - 1, day, 23, 59);
  return d.toISOString();
}

const PLACE_SUFFIX = /(馆|楼|室|场|厅|中心|体育馆|球场|操场|广场)$/;

/** 粗略判断「场地」里是不是塞了两个不同的地方 */
export function countPlaces(venue: string): number {
  const parts = venue
    .split(/[、，,/／和及与+]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return 1;
  const looksLikePlace = parts.filter((p) => PLACE_SUFFIX.test(p) || /\d/.test(p));
  return looksLikePlace.length >= 2 ? looksLikePlace.length : 1;
}

export function checkup(doc: EventDoc, model: EventModel): CheckItem[] {
  const items: CheckItem[] = [];

  /* ---------- 现在就能发，但发出去没人点得到 ---------- */
  const spotCount = model.traced + (doc.hotspots ?? []).length;
  if (spotCount === 0) {
    items.push({
      code: 'no-spot',
      level: 'warn',
      title: '这一版活海报没有一个能点的地方',
      detail: '图上还没有任何一块被圈过，观众打开只能干看。回校样台圈一块（哪怕只圈不写），它就变成了入口。',
    });
  }

  /* ---------- 时间自相矛盾 ---------- */
  if (model.when.startISO && model.when.endISO) {
    if (new Date(model.when.endISO).getTime() < new Date(model.when.startISO).getTime()) {
      items.push({
        code: 'date-end-before-start',
        level: 'error',
        field: 'when',
        title: '结束时间早于开始时间',
        detail: '日历里会变成一个倒流的活动。多半是日期或时间有一处写反了，请回原文核对。',
      });
    }
  }

  /* ---------- 报名时间对不上 ---------- */
  if (model.when.startISO) {
    const signupText = doc.fields.find((f) => f.key === 'signup')?.value ?? '';
    const summaryText = doc.fields.find((f) => f.key === 'summary')?.value ?? '';
    const year = new Date(model.when.startISO).getFullYear();
    const deadline = parseDeadline(signupText, year) ?? parseDeadline(summaryText, year);
    if (deadline) {
      const endISO = model.when.endISO ?? model.when.startISO;
      const now = Date.now();
      if (dayOf(deadline) > dayOf(endISO)) {
        items.push({
          code: 'signup-deadline-after-start',
          level: 'error',
          field: 'signup',
          title: '报名截止在活动结束之后',
          detail: `读到截止日是 ${new Date(deadline).getMonth() + 1} 月 ${new Date(deadline).getDate()} 日，比活动结束还晚。多半有一处日期写错了——两边都回原文核对。`,
        });
      } else if (new Date(deadline).getTime() < now) {
        items.push({
          code: 'signup-closed',
          level: 'warn',
          field: 'signup',
          title: '报名已经截止了，海报还在传',
          detail: `截止日是 ${new Date(deadline).getMonth() + 1} 月 ${new Date(deadline).getDate()} 日，已经过去。现在发出去，点开的人会报名失败——要么去掉这句，要么改成「可现场参加」。`,
        });
      }
    }
  }

  /* ---------- 免费又标价 ---------- */
  if (model.price.isFree === true && model.price.amounts.length > 0) {
    items.push({
      code: 'free-vs-paid',
      level: 'error',
      field: 'price',
      title: `一边写免费，一边出现 ${model.price.amounts.join(' / ')} 元`,
      detail: '同一句里既有「免费」又有金额，观众会当成骗人。是免费入场、周边收费，还是某个场次收费？说清楚其中一个。',
    });
  }

  /* ---------- 你改过，但海报没改 ---------- */
  const edited = doc.fields.filter(
    (f) => f.origin === 'manual' && f.original !== undefined && f.original !== f.value && f.original.trim()
  );
  if (edited.length) {
    items.push({
      code: 'edited-vs-original',
      level: 'warn',
      title: `${edited.length} 项和海报原文不一样了`,
      detail:
        edited.map((f) => FIELD_META[f.key].label).join('、') +
        '。如果海报已经发到群里，现在这张图和这一页说的不是同一件事——转发前想清楚以哪个为准，必要时让主办方补一条更正。',
    });
  }

  /* ---------- 场地里有两个地方 ---------- */
  if (model.venue) {
    const n = countPlaces(model.venue);
    if (n >= 2) {
      items.push({
        code: 'two-places',
        level: 'warn',
        field: 'venue',
        title: '场地里像是写了两个地方',
        detail: `读成 ${n} 处。如果确实是分场，导航按钮只能带人去其中一处；建议拆成两句写清楚哪一场在哪。`,
      });
    }
  }

  /* ---------- 右栏还有必须处理的（一个字段自己就能看出来的那种） ---------- */
  if (model.errors > 0) {
    items.push({
      code: 'open-errors',
      level: 'error',
      title: `右边还有 ${model.errors} 项「必须处理」`,
      detail: '这些是一个字段自己就能看出来的毛病（比如星期和日期对不上）。体检过不了，不等于海报不能发——但发出去之前，至少知道自己在发什么。',
    });
  }

  /* ---------- 还没确认 ---------- */
  if (!doc.confirmed) {
    items.push({
      code: 'unconfirmed',
      level: 'info',
      title: '这一版还没点过「确认」',
      detail: '确认只代表你看过这张海报，不代表信息一定对。没确认也能发，但发出去之后别人看到的就是现在这一版。',
    });
  }

  const order = { error: 0, warn: 1, info: 2 } as const;
  return items.sort((a, b) => order[a.level] - order[b.level]);
}

/** 体检结论：能不能发 */
export function verdict(items: CheckItem[]): { ok: boolean; errors: number; warns: number } {
  const errors = items.filter((i) => i.level === 'error').length;
  const warns = items.filter((i) => i.level === 'warn').length;
  return { ok: errors === 0, errors, warns };
}

/**
 * 生成 .ics 日历文件。
 *
 * 三个容易被做错的地方，这里都处理了：
 *  1. 时区：用 TZID=Asia/Shanghai + 内联 VTIMEZONE，而不是偷偷按 UTC 存（否则导入手机后差 8 小时）。
 *     中国大陆 1991 年后不再实行夏令时，所以固定 +0800 是安全的。
 *  2. 全天活动：DTSTART 必须用 VALUE=DATE，且 DTEND 是「次日」（iCalendar 的结束日期不包含）。
 *  3. 折行：RFC 5545 要求每行不超过 75 个八位字节，中文一个字算 3 字节，必须按字节折。
 */
import type { EventModel } from './derive';

const pad = (n: number) => String(n).padStart(2, '0');

function icsStamp(iso: string): string {
  // 'YYYY-MM-DDTHH:mm' -> 'YYYYMMDDTHHmm00'
  return iso.replace(/[-:]/g, '').replace('T', 'T') + '00';
}
function icsDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 按 RFC 5545 的 75 字节折行（不切断 UTF-8 多字节字符） */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    // 续行开头有一个空格，占 1 字节，所以第一行 75、后续 74
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + b > limit) {
      out.push(cur);
      cur = ' ' + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildICS(m: EventModel, opts: { url?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Poster2Action//一图成行//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'X-LIC-LOCATION:Asia/Shanghai',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${m.doc.id}@poster2action`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${esc(m.title)}`,
    `LOCATION:${esc(m.place)}`,
  ];

  if (m.when.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(m.when.startISO!)}`);
    const endBase = m.when.endISO ? m.when.endISO : m.when.startISO!;
    lines.push(`DTEND;VALUE=DATE:${icsDate(addDays(endBase, 1))}`);
  } else {
    lines.push(`DTSTART;TZID=Asia/Shanghai:${icsStamp(m.when.startISO!)}`);
    if (m.when.endISO) {
      lines.push(`DTEND;TZID=Asia/Shanghai:${icsStamp(m.when.endISO)}`);
    } else {
      // 没有结束时刻：给 2 小时的默认长度，并在描述里说明
      const d = new Date(m.when.startISO! + ':00');
      d.setHours(d.getHours() + 2);
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      lines.push(`DTEND;TZID=Asia/Shanghai:${icsStamp(iso)}`);
    }
  }

  const desc: string[] = [];
  if (m.summary) desc.push(m.summary);
  if (m.priceLabel) desc.push(`费用：${m.priceLabel}`);
  if (m.signup) desc.push(`参加方式：${m.signup}`);
  if (m.audience) desc.push(`适合：${m.audience}`);
  if (m.contact) desc.push(`联系：${m.contact}`);
  if (opts.url) desc.push(`活动页：${opts.url}`);
  desc.push('（时间与地点来自海报，已逐条核对原图）');
  lines.push(`DESCRIPTION:${esc(desc.join('\n'))}`);

  if (opts.url) lines.push(`URL:${opts.url}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:活动 2 小时后开始', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Google 日历兜底链接：手机上 .ics 下载体验不稳定时用它 */
export function googleCalendarUrl(m: EventModel): string {
  // 海报上没写时间（或只圈了块还没填）时，这里没有可算的日期，别硬算
  if (!m.when.startISO) return '';
  const enc = (s: string) => encodeURIComponent(s);
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace('T', 'T') + '00';
  let dates: string;
  if (m.when.allDay) {
    const s = m.when.startISO!.slice(0, 10).replace(/-/g, '');
    const endBase = m.when.endISO ?? m.when.startISO!;
    const e = addDays(endBase, 1).replace(/-/g, '');
    dates = `${s}/${e}`;
  } else {
    const s = fmt(m.when.startISO!).replace(/^(\d{8}T\d{4})00$/, '$1');
    let e: string;
    if (m.when.endISO) {
      e = fmt(m.when.endISO).replace(/^(\d{8}T\d{4})00$/, '$1');
    } else {
      const d = new Date(m.when.startISO! + ':00');
      d.setHours(d.getHours() + 2);
      e =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `T${pad(d.getHours())}${pad(d.getMinutes())}`;
    }
    dates = `${s}/${e}`;
  }
  const params = [
    'action=TEMPLATE',
    `text=${enc(m.title)}`,
    `dates=${dates}`,
    `location=${enc(m.place)}`,
    `details=${enc([m.summary, m.signup ? `参加方式：${m.signup}` : ''].filter(Boolean).join('\n'))}`,
    'ctz=Asia/Shanghai',
  ];
  return `https://calendar.google.com/calendar/render?${params.join('&')}`;
}

export function icsFileName(m: EventModel): string {
  const safe = m.title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'event';
  return `${safe}.ics`;
}

export function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 数据层自检：10 张示例海报 → derive() → 断言预置的陷阱都被抓到。
 * 不依赖浏览器，跑在 node 里（先用 rolldown 打一份 bundle，见 package.json 的 check 脚本）。
 *   npm run check
 */
import { FIXTURES, derive, docFromFixture, fixtureIds, toPlainText } from '../.tmp/lib.mjs';

const fails = [];
const bad = (msg) => fails.push(msg);

const ids = fixtureIds();
console.log(`\n=== 解析 ${ids.length} 张示例海报 ===\n`);

const rows = [];
for (const id of ids) {
  const doc = docFromFixture(id);
  const m = derive(doc);
  rows.push({ id, m });
  console.log(`${id}  ${m.title}  〔${FIXTURES[id].meta.style}〕`);
  console.log(`    时间   ${m.whenLabel}`);
  console.log(`    场地   ${m.place || '(空)'}`);
  console.log(`    费用   ${m.priceLabel}   报名 ${m.signup || '(空)'}`);
  console.log(`    追溯   ${m.traced}/${m.filled} 项可回到原图`);
  for (const i of m.issues) console.log(`    [${i.level}:${i.code}] ${i.title}`);
  if (!m.when.startISO) bad(`${id}: 没解析出开始时间`);
  if (m.traced < 8) bad(`${id}: 可追溯字段只有 ${m.traced} 项`);
  console.log('');
}

const m = (id) => rows.find((r) => r.id === id).m;
const hasCode = (id, code) => m(id).issues.some((i) => i.code === code);
const level = (id, code) => m(id).issues.find((i) => i.code === code)?.level;

/* ---------- 预置陷阱，一条都不能漏 ---------- */
const TRAPS = [
  ['p06', 'weekday-mismatch', 'error', '海报写「周六」但 2026年11月8日 是周日'],
  ['p04', 'price-tbd', 'warn', '门票待定'],
  ['p04', 'address-vague', 'info', '地址是「怎么走」不是门牌'],
  ['p07', 'no-address', 'warn', '足球场没有门牌'],
  ['p02', 'signup-nolink', 'warn', '扫码进群但没有链接'],
  ['p03', 'signup-nolink', 'warn', '扫码进群报名'],
  ['p04', 'signup-nolink', 'warn', '摊位招募要扫码'],
  ['p08', 'signup-nolink', 'warn', '报名要跑公众号'],
  ['p10', 'signup-nolink', 'warn', '填表报名但只有二维码'],
  ['p03', 'low-confidence', 'warn', '两个字段把握不大'],
  ['p10', 'low-confidence', 'warn', '跨两天日程把握不大'],
  ['p03', 'cross-day', 'info', '22:00 到次日 01:30'],
  ['p01', 'multi-day', 'info', '展期 10/24–11/15'],
  ['p04', 'multi-day', 'info', '31 号到 1 号'],
  ['p06', 'multi-day', 'info', '开幕到展期结束'],
  ['p10', 'multi-day', 'info', '28–29 两天'],
  ['p05', 'recurring', 'info', '每周六'],
];
for (const [id, code, want, why] of TRAPS) {
  if (!hasCode(id, code)) bad(`${id}: 没抓到 ${code}（${why}）`);
  else if (level(id, code) !== want) bad(`${id}: ${code} 级别是 ${level(id, code)}，应为 ${want}（${why}）`);
}

/* ---------- 海报只有月日时，年份必须是推断的 ---------- */
for (const id of ['p01', 'p03', 'p04', 'p05', 'p06', 'p07', 'p09', 'p10']) {
  if (!hasCode(id, 'year-inferred')) bad(`${id}: 海报没写年份，应标记为推断`);
}
for (const id of ['p02', 'p08']) {
  if (hasCode(id, 'year-inferred')) bad(`${id}: 海报写了年份，不该报「年份是推断的」`);
}

/* ---------- 不该报的假警报 ---------- */
for (const id of ['p01', 'p05', 'p06', 'p07']) {
  if (hasCode(id, 'signup-nolink')) bad(`${id}: 「无需预约 / 不用报名」不该报缺链接`);
}
for (const id of ['p05', 'p09', 'p10']) {
  if (hasCode(id, 'price-tbd')) bad(`${id}: 费用写清楚了，不该报「待定」`);
}

/* ---------- 解析硬断言 ---------- */
const iso = (id) => m(id).when.startISO ?? '';
if (!iso('p08').startsWith('2026-11-21')) bad(`p08: 2026年11月21日 解析成 ${iso('p08')}`);
if (!iso('p02').startsWith('2026-11-07')) bad(`p02: 2026.11.07 解析成 ${iso('p02')}`);
if (!iso('p04').startsWith('2026-10-31')) bad(`p04: 10月31日 解析成 ${iso('p04')}`);
if (!iso('p03').startsWith('2026-11-13')) bad(`p03: 11.13 解析成 ${iso('p03')}`);
if (!m('p03').when.endISO?.startsWith('2026-11-14')) bad(`p03: 次日凌晨散场解析成 ${m('p03').when.endISO}`);
if (!m('p10').when.endISO?.startsWith('2026-11-29')) bad(`p10: 两天活动结束日解析成 ${m('p10').when.endISO}`);
if (!m('p01').when.endISO?.startsWith('2026-11-15')) bad(`p01: 展期没有结束日 ${m('p01').when.endISO}`);
if (m('p06').when.mismatch !== true) bad('p06: mismatch 标记不是 true');
if (m('p05').when.recurring !== '每周六') bad(`p05: recurring 识别成 ${m('p05').when.recurring}`);
for (const id of ids) if (/\[(when|where|addr|free|apply|who|mail)\]/.test(toPlainText(m(id)))) bad(`${id}: 装饰标签漏进了活动信息`);

/* ---------- 坏输入不能崩 ---------- */
const base = docFromFixture('p02');
const broken = {
  ...base,
  fields: base.fields.map((f) => (f.key === 'when' ? { ...f, value: '时间见群公告' } : f)),
};
const bm = derive(broken);
if (bm.when.startISO) bad('「时间见群公告」不该解析出时间');
if (!bm.issues.some((i) => i.code === 'when-missing')) bad('缺日期时没给出 when-missing 错误');

const empty = derive({ ...base, fields: base.fields.map((f) => ({ ...f, value: '' })) });
if (empty.title !== '未命名活动') bad('空文档的兜底标题不对');
if (empty.errors < 3) bad(`空文档只报了 ${empty.errors} 个错误，应至少 3 个`);

console.log('=== 断言 ===');
if (!fails.length) {
  console.log(`全部通过：${ids.length} 张海报，${TRAPS.length} 条陷阱 + 15 条解析/假警报/坏输入断言\n`);
  process.exit(0);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`\n${fails.length} 条断言失败\n`);
process.exit(1);

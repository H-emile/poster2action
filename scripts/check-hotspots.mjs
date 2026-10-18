/**
 * 活海报 + 发行前体检的纯函数断言。
 * 跑法：node scripts/check-hotspots.mjs
 */
import {
  checkup,
  collectSpots,
  countPlaces,
  derive,
  docFromFixture,
  emptyFields,
  fixtureIds,
  parseDeadline,
  packDoc,
  parseWhen,
  spotCapabilities,
  unpackDoc,
} from '../.tmp/lib.mjs';

let pass = 0;
const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

/** 造一个假文档：只填想测的字段 */
function makeDoc(over = {}) {
  const { fields: wanted = {}, ...rest } = over;
  const fields = emptyFields().map((f) => ({ ...f }));
  for (const [key, value] of Object.entries(wanted)) {
    const f = fields.find((x) => x.key === key);
    if (f) {
      f.value = value;
      f.confidence = 'high';
      f.origin = 'poster';
      f.rect = { x: 0.1, y: 0.1, w: 0.3, h: 0.05 };
    }
  }
  return {
    v: 1,
    id: 'test',
    createdAt: 0,
    updatedAt: 0,
    source: 'upload',
    posterUrl: '',
    posterName: '测试',
    posterW: 1200,
    posterH: 1600,
    styleTag: '',
    fields,
    confirmed: false,
    ...rest,
  };
}

console.log('=== 1. 可点区域：字段 + 自定义块合并 ===');
const ids = fixtureIds();
ok('10 张示例海报都在', ids.length === 10);

let allCount = 0;
let orderOk = true;
for (const id of ids) {
  const doc = docFromFixture(id);
  const spots = collectSpots(doc);
  const traced = doc.fields.filter((f) => f.rect).length;
  allCount += spots.length;
  if (spots.length !== traced) ok(`${id} 热点数 = 有坐标的字段数`, false, `${spots.length} vs ${traced}`);
  if (spots.some((s, i) => s.index !== i + 1)) orderOk = false;
  // 阅读顺序：后一个的 y 不能明显小于前一个（同档按 x）
  for (let i = 1; i < spots.length; i++) {
    const a = spots[i - 1].rect;
    const b = spots[i].rect;
    const rowA = Math.round(a.y * 20);
    const rowB = Math.round(b.y * 20);
    if (rowB < rowA) orderOk = false;
  }
}
ok(`10 张合计 ${allCount} 个可点区域`, allCount >= 60);
ok('编号从 1 连续，且按从上到下、从左到右', orderOk);

const p06 = docFromFixture('p06');
const s06 = collectSpots(p06);
ok('时间块的 id 是 f-when', s06.some((s) => s.id === 'f-when'));
ok('时间块的动作是 when', s06.find((s) => s.id === 'f-when')?.action === 'when');
ok('场地块的动作是 place', s06.find((s) => s.id === 'f-venue')?.action === 'place');
ok('标题块只能放大', s06.find((s) => s.id === 'f-title')?.action === 'zoom');

console.log('=== 2. 自定义块 ===');
const withBlocks = {
  ...p06,
  hotspots: [
    { id: 'b1', rect: { x: 0.2, y: 0.5, w: 0.4, h: 0.06 }, label: '特别提醒', text: '猫可入场', action: 'zoom' },
    { id: 'b2', rect: { x: 0.2, y: 0.6, w: 0.4, h: 0.06 }, label: '自带耳机', text: '', action: 'zoom' },
  ],
};
const sBlocks = collectSpots(withBlocks);
ok('自定义块并进来了', sBlocks.length === collectSpots(p06).length + 2);
ok('自定义块 id 带 h- 前缀', sBlocks.some((s) => s.id === 'h-b1'));
ok('自定义块的文字跟着走', sBlocks.find((s) => s.id === 'h-b1')?.text === '猫可入场');
ok('空的自定义块也在（只放大也有用）', sBlocks.some((s) => s.id === 'h-b2' && s.text === ''));
const zeroRect = { ...withBlocks, hotspots: [{ id: 'z', rect: { x: 0, y: 0, w: 0, h: 0 }, label: 'x', text: '', action: 'zoom' }] };
ok('零面积的块被丢掉', !collectSpots(zeroRect).some((s) => s.id === 'h-z'));

console.log('=== 3. 能力判定 ===');
const m06 = derive(p06);
const whenSpot = s06.find((s) => s.id === 'f-when');
ok('时间填好了就能加日历', spotCapabilities(whenSpot, m06).canCalendar === true);
const empty = makeDoc();
const mEmpty = derive(empty);
ok('没圈过的文档一个点都没有', collectSpots(empty).length === 0);
const emptyWhenSpot = { id: 'f-when', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 }, label: '时间', text: '', action: 'when', fieldKey: 'when', index: 1 };
const capEmpty = spotCapabilities(emptyWhenSpot, mEmpty);
ok('时间没填，日历按钮就是禁用的', capEmpty.canCalendar === false);
ok('时间没填也没有文字 → 只剩放大', capEmpty.zoomOnly === true);

console.log('=== 4. 发行前体检 ===');
ok('没圈过任何一块 → no-spot', checkup(empty, mEmpty).some((i) => i.code === 'no-spot'));
ok('10 张示例都不报 no-spot', ids.every((id) => !checkup(docFromFixture(id), derive(docFromFixture(id))).some((i) => i.code === 'no-spot')));

const freePaid = makeDoc({ fields: { title: 'x', when: '11月8日 14:00', venue: '美术馆', price: '免费，学生票 15 元' } });
const mFreePaid = derive(freePaid);
ok('免费 + 标价 → free-vs-paid', checkup(freePaid, mFreePaid).some((i) => i.code === 'free-vs-paid'));

const afterDoc = makeDoc({
  fields: { title: 'x', when: '11月8日 14:00', venue: '美术馆', signup: '报名截至 12月30日' },
});
ok(
  '报名截止晚于活动结束 → signup-deadline-after-start',
  checkup(afterDoc, derive(afterDoc)).some((i) => i.code === 'signup-deadline-after-start')
);

const okDeadline = makeDoc({
  fields: { title: 'x', when: '11月8日 14:00', venue: '美术馆', signup: '报名截至 11月7日' },
});
const okDeadlineItems = checkup(okDeadline, derive(okDeadline));
ok(
  '提前一天截止是正常的，不报错',
  !okDeadlineItems.some((i) => i.code === 'signup-deadline-after-start') &&
    !okDeadlineItems.some((i) => i.code === 'signup-closed')
);

const closedDoc = makeDoc({
  fields: { title: 'x', when: '12月20日 14:00', venue: '美术馆', signup: '报名截至 10月1日' },
});
ok('截止日已经过去 → signup-closed', checkup(closedDoc, derive(closedDoc)).some((i) => i.code === 'signup-closed'));

const editedDoc = makeDoc({ fields: { title: 'x', when: '11月8日 周日 14:00', venue: '美术馆' } });
const wf = editedDoc.fields.find((f) => f.key === 'when');
wf.original = '11月8日 周六 14:00';
wf.origin = 'manual';
ok('改过且与原文不同 → edited-vs-original', checkup(editedDoc, derive(editedDoc)).some((i) => i.code === 'edited-vs-original'));

const twoPlace = makeDoc({ fields: { title: 'x', when: '11月8日 14:00', venue: '美术馆、图书馆' } });
ok('场地写了两个地方 → two-places', checkup(twoPlace, derive(twoPlace)).some((i) => i.code === 'two-places'));
ok('countPlaces 单场地返回 1', countPlaces('美术馆 二层 白盒子展厅') === 1);

ok('没确认 → unconfirmed', checkup(docFromFixture('p06'), derive(docFromFixture('p06'))).some((i) => i.code === 'unconfirmed'));

console.log('=== 5. 解析小件 ===');
ok('「截至 10月30日」能解析', Boolean(parseDeadline('报名截至 10月30日', 2026)));
ok('「10/30 前截止」能解析', Boolean(parseDeadline('10/30 前截止', 2026)));
ok('没有截止日返回 null', parseDeadline('扫码进群报名', 2026) === null);

const reversed = parseWhen('11月8日 14:00 到 11月7日 17:00');
ok(
  '倒着的日期至少能被识别出开始时间',
  Boolean(reversed.startISO),
  JSON.stringify({ s: reversed.startISO, e: reversed.endISO })
);

console.log('=== 6. 分享链接带自定义块 ===');
const shared = unpackDoc(packDoc(withBlocks));
ok('往返后自定义块还在', (shared?.hotspots ?? []).length === 2);
ok('往返后坐标没变', shared?.hotspots?.[0]?.rect.w === 0.4);
ok('往返后动作没变', shared?.hotspots?.[0]?.action === 'zoom');
ok('往返后文字没丢', shared?.hotspots?.[0]?.text === '猫可入场');
const sw = shared?.fields.find((f) => f.key === 'when')?.rect?.w ?? -1;
const ow = p06.fields.find((f) => f.key === 'when')?.rect?.w ?? -2;
ok('字段的坐标也还在（两位小数内一致）', Math.abs(sw - ow) < 0.01, `${sw} vs ${ow}`);

let maxLen = 0;
let maxId = '';
for (const id of ids) {
  const doc = docFromFixture(id);
  const two = {
    ...doc,
    hotspots: [
      { id: 'x1', rect: { x: 0.2, y: 0.5, w: 0.4, h: 0.06 }, label: '特别提醒', text: '这条信息海报上写在最下面', action: 'zoom' },
      { id: 'x2', rect: { x: 0.2, y: 0.7, w: 0.4, h: 0.06 }, label: '自带耳机', text: '', action: 'zoom' },
    ],
  };
  const len = 60 + packDoc(two).length; // 60 ≈ 域名与路径
  if (len > maxLen) {
    maxLen = len;
    maxId = id;
  }
}
ok(`最长分享链接 ${maxLen} 字符（${maxId}）仍在 1600 以内`, maxLen <= 1600);

console.log('');
if (fails.length) {
  console.log(`失败 ${fails.length} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`全部通过：${pass} 条断言`);

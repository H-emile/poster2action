/**
 * 生成 10 张不同风格的活动海报（SVG）+ 提取基准数据（fixtures.json）
 *
 * 关键点：海报不是拿来做"截图假数据"的。文字是在已知坐标上排版的，
 * 所以每一段文字的包围盒就是它在海报上的真实位置 —— 这正是产品主张的
 * "来源可追溯"所需的数据。真实场景里这份数据由 OCR / 视觉模型提供，
 * 这里用生成器代替模型，好让原型在没有 API Key 的情况下也能完整演示。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const W = 900;
const H = 1270;

const SANS = `'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif`;
const SERIF = `'Noto Serif SC','Songti SC','SimSun',serif`;
const MONO = `'JetBrains Mono','Consolas','Courier New',monospace`;
const SLAB = `'Rockwell','Roboto Slab',Georgia,serif`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ 排版工具 */

// 粗略字宽估算：CJK 全宽；数字/大写偏窄；标点/空格更窄。
function charW(ch, size) {
  const c = ch.codePointAt(0);
  if (/\s/.test(ch)) return size * 0.28;
  if (c >= 0x4e00 && c <= 0x9fff) return size * 1.0;
  if (c >= 0x3000 && c <= 0x303f) return size * 1.0;
  if (c >= 0xff00 && c <= 0xffef) return size * 1.0;
  if (/[0-9]/.test(ch)) return size * 0.58;
  if (/[A-Z]/.test(ch)) return size * 0.68;
  if (/[a-z]/.test(ch)) return size * 0.54;
  if (/[,.·:;!|'"()\[\]]/.test(ch)) return size * 0.34;
  return size * 0.62;
}
function meas(str, size, ls = 0) {
  let w = 0;
  for (const ch of str) w += charW(ch, size);
  return w + ls * Math.max(0, [...str].length - 1);
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 输出一段文字，同时返回它在海报上的包围盒 */
function T(str, x, y, o = {}) {
  const {
    size = 32,
    weight = 700,
    fill = '#111',
    fam = SANS,
    anchor = 'start',
    ls = 0,
    opacity = 1,
    rotate = 0,
    outline = false,
    strokeW = 0,
  } = o;
  const w = meas(str, size, ls);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  let rect = { x: x0, y: y - size * 0.82, w, h: size * 1.1 };
  if (rotate) {
    const d = Math.hypot(rect.w, rect.h);
    rect = { x: x - d / 2, y: y - d / 2, w: d, h: d };
  }
  const transform = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : '';
  const paint = outline
    ? `fill="none" stroke="${fill}" stroke-width="${strokeW || Math.max(1.5, size * 0.035)}"`
    : `fill="${fill}"`;
  const svg =
    `<text x="${x}" y="${y}" font-family="${fam}" font-size="${size}" font-weight="${weight}" ` +
    `letter-spacing="${ls}" ${paint} opacity="${opacity}" text-anchor="${anchor}"${transform}>${esc(str)}</text>`;
  return { svg, rect };
}

/* --------------------------------------------------------------- 图形小工具 */

const rect = (x, y, w, h, fill, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, sw = 2, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;
const circle = (cx, cy, r, fill, extra = '') =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;

function halftone(x, y, w, h, color, step = 14, r = 3, opacity = 1) {
  let d = '';
  for (let yy = y; yy < y + h; yy += step) {
    for (let xx = x; xx < x + w; xx += step) {
      const rad = r * (0.55 + 0.45 * Math.sin((xx / w) * Math.PI * 1.6) * Math.cos((yy / h) * Math.PI * 1.2));
      d += `M${xx.toFixed(1)} ${yy.toFixed(1)}m-${Math.abs(rad).toFixed(1)} 0a${Math.abs(rad).toFixed(1)} ${Math.abs(rad).toFixed(1)} 0 1 0 ${(Math.abs(rad) * 2).toFixed(1)} 0a${Math.abs(rad).toFixed(1)} ${Math.abs(rad).toFixed(1)} 0 1 0 -${(Math.abs(rad) * 2).toFixed(1)} 0`;
    }
  }
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}

function stripes(x, y, w, h, color, step = 22, sw = 8, rotate = 45) {
  const gid = 'st' + Math.random().toString(36).slice(2, 7);
  return `<defs><pattern id="${gid}" width="${step}" height="${step}" patternTransform="rotate(${rotate})" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="${step}" stroke="${color}" stroke-width="${sw}"/></pattern></defs>` +
    rect(x, y, w, h, `url(#${gid})`);
}

function tape(x, y, w, h, rotate = -4) {
  return `<g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">${rect(
    x,
    y,
    w,
    h,
    '#d9cdb4',
    'opacity="0.92"'
  )}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#00000018"/></g>`;
}

/* ---------------------------------------------------------------- 海报组装 */

function build(id, paint, meta) {
  const pieces = [];
  const regions = {};
  const values = {};

  const add = (key, str, x, y, o) => {
    const r = T(str, x, y, o);
    pieces.push(r.svg);
    (regions[key] ||= []).push(r.rect);
    (values[key] ||= []).push(String(str));
    return r;
  };
  const addRects = (key, rects) => {
    regions[key] ||= [];
    regions[key].push(...rects);
  };
  const shape = (s) => pieces.push(s);

  paint({ add, shape, addRects });

  // 每个字段：文字拼接 + 包围盒合并
  const fields = {};
  for (const [k, rects] of Object.entries(regions)) {
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w));
    const y1 = Math.max(...rects.map((r) => r.y + r.h));
    fields[k] = {
      value: (values[k] || []).join(' '),
      rect: {
        x: +Math.max(0, x0 / W - 0.006).toFixed(4),
        y: +Math.max(0, y0 / H - 0.008).toFixed(4),
        w: +Math.min(1, (x1 - x0) / W + 0.012).toFixed(4),
        h: +Math.min(1, (y1 - y0) / H + 0.016).toFixed(4),
      },
    };
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    pieces.join('') +
    `</svg>`;

  return { id, svg, fields, meta: { ...meta, width: W, height: H } };
}

/* ============================================================== 1. 双色凸版 */
const p01 = build(
  'p01',
  ({ add, shape }) => {
    const PAPER = '#F1EBDD';
    const INK = '#14120E';
    const PINK = '#FF3B6B';
    const BLUE = '#1B34C8';

    shape(rect(0, 0, W, H, PAPER));
    shape(halftone(470, 120, 430, 300, PINK, 15, 7, 0.55));
    shape(rect(0, 0, 64, H, BLUE));
    shape(rect(0, 0, 64, H, PINK, 'opacity="0.45" transform="translate(9 0)"'));
    // 大圆环
    shape(`<circle cx="700" cy="880" r="210" fill="none" stroke="${INK}" stroke-width="3" opacity="0.35"/>`);
    shape(`<circle cx="700" cy="880" r="150" fill="none" stroke="${PINK}" stroke-width="14" opacity="0.85"/>`);

    add('subtitle', '陶艺系 · 2023 级毕业作品展', 110, 150, {
      size: 27, weight: 600, fill: INK, ls: 2.4,
    });
    add('title', '余 震', 96, 330, { size: 172, weight: 900, fill: INK, ls: 8 });
    add('title', 'AFTERSHOCK', 100, 412, { size: 62, weight: 800, fill: BLUE, ls: 6 });
    add('summary', '二十三件带着裂纹的器物。', 108, 520, { size: 30, weight: 600, fill: INK });
    add('summary', '烧坏的、塌陷的、重新拼回去的。', 108, 566, { size: 30, weight: 600, fill: INK });

    shape(line(108, 620, 800, 620, INK, 3));

    add('when', '10月24日 — 11月15日', 108, 700, { size: 44, weight: 800, fill: INK });
    add('when', '每周二至周日 11:00–19:00', 108, 748, { size: 27, weight: 600, fill: BLUE });

    add('venue', '旧厂房艺术区 A 栋 2 层 · 三号展厅', 108, 838, { size: 31, weight: 700, fill: INK });
    add('address', '云栖路 88 号（地铁 4 号线 云栖站 B 口）', 108, 882, { size: 24, weight: 500, fill: INK });

    add('price', '免费', 108, 1004, { size: 40, weight: 900, fill: PINK });
    add('audience', '面向全校师生及校外观众', 190, 1000, { size: 23, weight: 500, fill: INK });

    add('contact', '咨询：陶艺系办公室 0571-8800 1234', 108, 1092, { size: 21, weight: 500, fill: INK });
    add('signup', '无需预约，现场入场', 108, 1130, { size: 21, weight: 500, fill: INK });

    shape(rect(560, 1020, 240, 90, INK));
    add('signup', '扫 码 看 展 品 清 单', 680, 1076, { size: 24, weight: 800, fill: PAPER, anchor: 'middle' });
  },
  {
    title: '余震 AFTERSHOCK',
    style: '双色凸版 · 陶艺系毕业展',
    month: 10, day: 24, endMonth: 11, endDay: 15,
    note: '展期跨月，海报只给了开馆时段',
  }
);

/* ============================================================== 2. 瑞士网格 */
const p02 = build(
  'p02',
  ({ add, shape }) => {
    const BG = '#FBFAF7';
    const INK = '#141414';
    const RED = '#E8402A';

    shape(rect(0, 0, W, H, BG));
    for (let i = 1; i < 6; i++) shape(line((W / 6) * i, 60, (W / 6) * i, H - 60, '#00000012', 1));

    add('subtitle', '设计学院 · 公开讲座 第 12 期', 60, 108, { size: 22, weight: 600, ls: 3, fill: INK });
    shape(rect(60, 128, 130, 6, RED));

    add('title', '当街道', 60, 258, { size: 96, weight: 800, fill: INK });
    add('title', '开始说话', 60, 356, { size: 96, weight: 800, fill: INK });
    shape(rect(60, 372, 520, 10, RED));

    add('summary', '一块招牌、一张贴纸、一行涂鸦，', 60, 470, { size: 28, weight: 500, fill: '#3a3a3a' });
    add('summary', '城市里没人署名的设计如何改变我们的路线。', 60, 512, { size: 28, weight: 500, fill: '#3a3a3a' });

    shape(line(60, 596, W - 60, 596, '#00000022', 1));

    add('when', '2026.11.07', 60, 690, { size: 52, weight: 800, fill: INK });
    add('when', '19:30 — 21:00', 60, 742, { size: 34, weight: 600, fill: INK, fam: MONO });
    add('venue', '设计学院报告厅（主楼 B101）', 60, 830, { size: 27, weight: 600, fill: INK });
    add('address', '长桥校区 南区 3 号门 直行 150 米', 60, 868, { size: 22, weight: 500, fill: '#555' });

    add('audience', '全校开放 · 无需报名 · 有签到', 60, 960, { size: 24, weight: 600, fill: INK });

    shape(line(60, 1012, W - 60, 1012, INK, 2));
    add('contact', '主讲｜林一舟（城市观察者）', 60, 1076, { size: 26, weight: 700, fill: INK });
    add('contact', '对谈｜学报编辑部', 60, 1116, { size: 22, weight: 500, fill: '#555' });

    add('price', '免费', H - 70, 1160, { size: 26, weight: 800, fill: RED, anchor: 'end' });
    shape(circle(790, 1152, 44, 'none', `stroke="${RED}" stroke-width="3"`));
    add('signup', '扫码进群', 790, 1160, { size: 18, weight: 700, fill: RED, anchor: 'middle' });
  },
  { title: '当街道开始说话', style: '瑞士网格 · 设计学院讲座', month: 11, day: 7 }
);

/* ============================================================== 3. 霓虹夜 */
const p03 = build(
  'p03',
  ({ add, shape }) => {
    const BG = '#0A0920';
    const VIO = '#8B6BFF';
    const CYAN = '#35E0D0';
    const PINK = '#FF4E9B';

    shape(rect(0, 0, W, H, BG));
    shape(halftone(0, 0, W, 420, '#1a1746', 26, 9, 0.9));
    // 地平线网格
    for (let i = -6; i <= 6; i++)
      shape(line(W / 2, 640, W / 2 + i * 190, H, CYAN, 1.6, 'opacity="0.32"'));
    for (let i = 1; i <= 9; i++) {
      const y = 640 + Math.pow(i / 9, 2.1) * 520;
      shape(line(0, y, W, y, CYAN, 1.4, 'opacity="0.22"'));
    }
    shape(`<circle cx="450" cy="600" r="120" fill="${PINK}" opacity="0.55"/>`);
    shape(`<circle cx="450" cy="600" r="180" fill="${PINK}" opacity="0.15"/>`);

    add('subtitle', 'CAMPUS FILM SOCIETY PRESENTS', 450, 120, { size: 22, weight: 700, fill: CYAN, anchor: 'middle', ls: 5 });
    add('title', '午夜放映', 450, 268, { size: 108, weight: 900, fill: '#fff', anchor: 'middle', ls: 6 });
    add('title', 'BLADE RUNNER', 450, 330, { size: 40, weight: 800, fill: VIO, anchor: 'middle', ls: 8 });

    add('when', '11.13 周五 22:00', 450, 470, { size: 40, weight: 800, fill: '#fff', anchor: 'middle', fam: MONO });
    add('when', '通宵连映 · 散场约 01:30', 450, 512, { size: 22, weight: 500, fill: CYAN, anchor: 'middle' });

    add('venue', '图书馆负一层 · 影音厅', 450, 760, { size: 34, weight: 800, fill: '#fff', anchor: 'middle' });
    add('address', '电梯直达 B1，出电梯左手边', 450, 800, { size: 21, weight: 500, fill: '#9d99c9', anchor: 'middle' });

    add('price', '¥15 / 人（含爆米花）', 450, 900, { size: 30, weight: 800, fill: PINK, anchor: 'middle' });
    add('audience', '限 60 人 · 影迷会成员优先', 450, 942, { size: 22, weight: 500, fill: '#9d99c9', anchor: 'middle' });

    shape(rect(250, 1000, 400, 96, 'none', `stroke="${CYAN}" stroke-width="2.5" stroke-dasharray="10 8"`));
    add('signup', '扫码进群报名，人满即止', 450, 1058, { size: 25, weight: 700, fill: CYAN, anchor: 'middle' });
    add('contact', '联系人：周 18600001111', 450, 1140, { size: 19, weight: 500, fill: '#7c78a6', anchor: 'middle' });
  },
  {
    title: '午夜放映 BLADE RUNNER',
    style: '霓虹夜场 · 校园电影社',
    month: 11, day: 13,
    notes: {
      title: { confidence: 'low', note: '发光描边字压在粉紫色光晕上，边缘对比度不足' },
      signup: { confidence: 'low', note: '只写了“扫码进群”，海报上没有链接或二维码本体' },
    },
  }
);

/* ============================================================== 4. 手作市集 */
const p04 = build(
  'p04',
  ({ add, shape }) => {
    const BG = '#D8BE96';
    const INK = '#2B2118';
    const RED = '#B23A2E';
    const CREAM = '#F3E7D2';

    shape(rect(0, 0, W, H, BG));
    shape(halftone(0, 0, W, H, '#c2a67c', 18, 2.2, 0.5));
    shape(rect(46, 46, W - 92, H - 92, CREAM, 'opacity="0.55"'));
    shape(`<rect x="46" y="46" width="${W - 92}" height="${H - 92}" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="14 10" opacity="0.5"/>`);

    shape(tape(120, 18, 200, 46, -6));
    shape(tape(600, 14, 190, 44, 5));

    add('subtitle', 'HANDMADE MARKET 第 7 回', 90, 168, { size: 22, weight: 700, fill: RED, ls: 3.5 });
    add('title', '秋日', 88, 300, { size: 118, weight: 700, fill: INK, fam: SERIF });
    add('title', '手作市集', 88, 420, { size: 118, weight: 700, fill: INK, fam: SERIF });
    add('summary', '三十个摊位：陶、木、布、纸、旧物改造，', 92, 500, { size: 25, weight: 500, fill: INK, fam: SERIF });
    add('summary', '还有现场织布和印章摊。', 92, 540, { size: 25, weight: 500, fill: INK, fam: SERIF });

    shape(line(92, 600, 800, 600, INK, 2, 'opacity="0.5"'));

    add('when', '10月31日 周六 · 10:00–18:00', 92, 684, { size: 38, weight: 700, fill: INK, fam: SLAB });
    add('when', '11月1日 周日 · 10:00–17:00', 92, 732, { size: 38, weight: 700, fill: INK, fam: SLAB });

    add('venue', '东门 · 老槐树下小广场', 92, 828, { size: 32, weight: 700, fill: INK });
    add('address', '从东门进来右手边，看到帐篷就是', 92, 868, { size: 22, weight: 500, fill: '#5a4a3a' });

    add('price', '门票待定，详见群公告', 92, 962, { size: 27, weight: 700, fill: RED, fam: SLAB });
    add('audience', '适合带朋友、带小孩乱逛', 92, 1004, { size: 22, weight: 500, fill: '#5a4a3a' });
    add('contact', '摊主报名：市集筹备组（微信见海报下方）', 92, 1090, { size: 20, weight: 500, fill: INK });
    add('signup', '摊位招募截止 10月26日', 92, 1130, { size: 20, weight: 600, fill: RED });

    shape(circle(700, 1030, 96, RED, 'opacity="0.92"'));
    add('signup', '扫码', 700, 1016, { size: 30, weight: 800, fill: CREAM, anchor: 'middle', fam: SERIF });
    add('signup', '看摊位图', 700, 1058, { size: 20, weight: 700, fill: CREAM, anchor: 'middle' });
  },
  {
    title: '秋日手作市集',
    style: '牛皮纸手作 · 学生市集',
    month: 10, day: 31, endMonth: 11, endDay: 1,
    notes: {
      price: { confidence: 'low', note: '原文是“待定，详见群公告”，没有给出具体价格' },
      address: { confidence: 'low', note: '“看到帐篷就是”属于描述性说法，不是可导航地址' },
    },
  }
);

/* ============================================================ 5. 粗野主义 */
const p05 = build(
  'p05',
  ({ add, shape }) => {
    const BG = '#E8E4DA';
    const INK = '#0E0E0E';
    const ORANGE = '#FF5A1F';

    shape(rect(0, 0, W, H, BG));
    shape(rect(0, 0, W, 120, INK));
    add('subtitle', '社团招新 · 每年只招一次', 30, 78, { size: 24, weight: 700, fill: BG, ls: 3 });

    shape(rect(0, 150, W, 300, ORANGE));
    add('title', '我们要', 40, 300, { size: 120, weight: 900, fill: INK });
    add('title', '你', 40, 430, { size: 150, weight: 900, fill: INK });

    add('title', '独立音乐社', 40, 540, { size: 64, weight: 900, fill: INK, ls: 2 });
    add('summary', '排歌、排练、上台。每周一次在旧礼堂地下室，', 44, 610, { size: 26, weight: 700, fill: INK });
    add('summary', '会什么乐器都行，不会也行。', 44, 650, { size: 26, weight: 700, fill: INK });

    shape(rect(0, 700, W, 6, INK));
    add('when', '每周六 14:00–17:30', 44, 790, { size: 52, weight: 900, fill: INK });
    add('when', '首次见面：10月31日', 44, 842, { size: 30, weight: 700, fill: INK });

    add('venue', '旧礼堂地下室 B1', 44, 936, { size: 44, weight: 900, fill: INK });
    add('address', '南门进来后一直走到头，楼梯下去', 44, 976, { size: 23, weight: 600, fill: '#3b3b3b' });

    add('price', '免费', 44, 1070, { size: 44, weight: 900, fill: ORANGE });
    add('audience', '不限年级 · 不限水平', 180, 1066, { size: 26, weight: 700, fill: INK });
    add('signup', '不用报名，直接来', 44, 1120, { size: 26, weight: 900, fill: INK });
    add('contact', '微信：indie_music_club', 44, 1170, { size: 22, weight: 600, fill: '#3b3b3b' });

    shape(rect(700, 1080, 150, 150, INK));
    add('contact', '扫码', 775, 1170, { size: 26, weight: 800, fill: ORANGE, anchor: 'middle' });
  },
  {
    title: '独立音乐社招新',
    style: '粗野主义 · 社团招新',
    month: 10, day: 31, recurring: '每周六',
    notes: {
      when: { confidence: 'low', note: '海报同时写了“每周六”和“首次见面 10月31日”，需要确认按哪一次建日程' },
    },
  }
);

/* ============================================================ 6. 极简展览 */
const p06 = build(
  'p06',
  ({ add, shape }) => {
    const BG = '#FCFCFA';
    const INK = '#1A1A1A';
    const SAGE = '#C7D6C0';

    shape(rect(0, 0, W, H, BG));
    shape(circle(660, 300, 168, SAGE, 'opacity="0.55"'));
    shape(circle(700, 340, 96, '#9fb69a', 'opacity="0.35"'));

    add('subtitle', '摄影系 2024 级 期末呈现', 96, 132, { size: 20, weight: 500, ls: 4, fill: '#6c6c6c' });
    add('title', '空的', 92, 268, { size: 104, weight: 400, fill: INK, fam: SERIF });
    add('title', '房间', 92, 380, { size: 104, weight: 400, fill: INK, fam: SERIF });
    add('title', 'THE EMPTY ROOM', 96, 432, { size: 20, weight: 500, ls: 6, fill: '#8a8a8a' });

    shape(line(96, 500, 340, 500, INK, 1));

    add('summary', '十四位同学，把镜头对准没人待的房间。', 96, 556, { size: 24, weight: 400, fill: '#3f3f3f', fam: SERIF });
    add('summary', '空教室、空宿舍、走廊尽头。', 96, 594, { size: 24, weight: 400, fill: '#3f3f3f', fam: SERIF });

    add('when', '11月8日 周六', 96, 730, { size: 34, weight: 500, fill: INK, fam: SERIF });
    add('when', '14:00 开幕 · 展至 11月22日', 96, 772, { size: 22, weight: 400, fill: '#5c5c5c' });

    add('venue', '美术馆 二层 白盒子展厅', 96, 862, { size: 26, weight: 500, fill: INK });
    add('address', '美院东侧，进门左转上楼梯', 96, 898, { size: 19, weight: 400, fill: '#6c6c6c' });

    add('price', '免费', 96, 986, { size: 24, weight: 500, fill: INK, fam: SERIF });
    add('audience', '欢迎所有人，包括猫', 200, 986, { size: 19, weight: 400, fill: '#6c6c6c' });
    add('contact', '策展：陈某某 · 摄影系 2024 级', 96, 1060, { size: 18, weight: 400, fill: '#6c6c6c' });
    add('signup', '无需报名', 96, 1098, { size: 18, weight: 400, fill: '#6c6c6c' });

    shape(rect(96, 1150, 300, 1, '#cfcfcf'));
  },
  {
    title: '空的房间 THE EMPTY ROOM',
    style: '极简留白 · 摄影系期末展',
    month: 11, day: 8,
    // 刻意设置的错误：2026-11-08 是周日，海报写“周六”
    expectIssue: '海报把 11月8日 标成“周六”，与当年日历冲突',
  }
);

/* ============================================================ 7. 球赛斜切 */
const p07 = build(
  'p07',
  ({ add, shape }) => {
    const BG = '#10233F';
    const YEL = '#FFD12E';
    const WHITE = '#F4F6FA';

    shape(rect(0, 0, W, H, BG));
    shape(stripes(0, 0, W, 300, '#1b355c', 26, 10, 32));
    shape(rect(-100, 520, W + 200, 340, YEL, 'transform="rotate(-7 450 690)"'));
    shape(rect(-100, 380, W + 200, 26, WHITE, 'transform="rotate(-7 450 690)" opacity="0.5"'));

    add('subtitle', '校际联赛 · 第 9 轮', 60, 120, { size: 24, weight: 700, fill: YEL, ls: 4 });
    add('title', '设计学院', 60, 262, { size: 76, weight: 900, fill: WHITE });
    add('title', 'VS', 60, 330, { size: 46, weight: 900, fill: YEL });

    add('title', '计算机学院', 60, 460, { size: 76, weight: 900, fill: '#0E0E0E', rotate: 0 });
    // 斜切色带上的文字（深色压在黄底上）
    add('when', '11月15日 周日 15:00 开球', 470, 700, { size: 46, weight: 900, fill: '#10233F', anchor: 'middle', rotate: -7 });

    add('venue', '东区 田径场 足球场', 60, 900, { size: 40, weight: 900, fill: WHITE });
    add('price', '免费观赛', 60, 990, { size: 32, weight: 800, fill: YEL });
    add('audience', '带喇叭、带旗帜、带朋友', 60, 1040, { size: 24, weight: 600, fill: WHITE });
    add('signup', '无需报名，直接来喊', 60, 1090, { size: 22, weight: 600, fill: '#9fb0c9' });
    add('contact', '啦啦队招新：体育部 张同学', 60, 1140, { size: 20, weight: 500, fill: '#9fb0c9' });

    shape(circle(740, 1000, 70, YEL));
    add('contact', '加', 740, 1014, { size: 34, weight: 900, fill: '#10233F', anchor: 'middle' });
  },
  {
    title: '设计学院 VS 计算机学院',
    style: '运动斜切 · 校际联赛',
    month: 11, day: 15,
    // 只给了场地名，没有可导航地址
    omitAddress: true,
  }
);

/* ============================================================ 8. 学术深绿 */
const p08 = build(
  'p08',
  ({ add, shape }) => {
    const BG = '#16302A';
    const IVORY = '#F2EAD8';
    const GOLD = '#C9A227';

    shape(rect(0, 0, W, H, BG));
    shape(`<rect x="44" y="44" width="${W - 88}" height="${H - 88}" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity="0.7"/>`);
    shape(`<rect x="58" y="58" width="${W - 116}" height="${H - 116}" fill="none" stroke="${GOLD}" stroke-width="0.8" opacity="0.4"/>`);

    add('subtitle', '文学院 · 中国思想史系列讲座 第 4 讲', 90, 150, { size: 21, weight: 600, fill: GOLD, ls: 3, fam: SERIF });
    add('title', '笔记', 88, 300, { size: 110, weight: 600, fill: IVORY, fam: SERIF, ls: 6 });
    add('title', '作为方法', 88, 420, { size: 110, weight: 600, fill: IVORY, fam: SERIF, ls: 6 });
    add('title', 'NOTES AS METHOD', 90, 476, { size: 18, weight: 500, fill: GOLD, ls: 7 });

    shape(line(90, 540, 400, 540, GOLD, 1));

    add('summary', '从宋人读书札记到今天的手机备忘录，', 90, 600, { size: 25, weight: 400, fill: '#d9d0bd', fam: SERIF });
    add('summary', '我们为什么总觉得“记下来”就算读过了。', 90, 642, { size: 25, weight: 400, fill: '#d9d0bd', fam: SERIF });

    add('when', '2026年11月21日（周六）', 90, 760, { size: 30, weight: 600, fill: IVORY, fam: SERIF });
    add('when', '14:30–16:10，含 20 分钟提问', 90, 802, { size: 22, weight: 400, fill: '#bfb6a3' });

    add('venue', '人文楼 三楼 学术报告厅', 90, 892, { size: 27, weight: 600, fill: IVORY, fam: SERIF });
    add('address', '人文楼位于图书馆西侧，与档案馆相连', 90, 930, { size: 19, weight: 400, fill: '#bfb6a3' });

    add('price', '免费 · 需报名占座', 90, 1014, { size: 24, weight: 600, fill: GOLD, fam: SERIF });
    add('audience', '限 80 座', 320, 1014, { size: 19, weight: 400, fill: '#bfb6a3' });
    add('signup', '报名：文学院公众号 → 讲座 → 第 4 讲', 90, 1064, { size: 19, weight: 400, fill: '#d9d0bd' });
    add('contact', '主讲：周明远 教授', 90, 1132, { size: 22, weight: 600, fill: IVORY, fam: SERIF });
  },
  {
    title: '笔记作为方法',
    style: '深绿衬线 · 文学院讲座',
    month: 11, day: 21,
    notes: {
      signup: { confidence: 'low', note: '报名靠公众号菜单，无法生成直达链接' },
    },
  }
);

/* ============================================================ 9. 暖橘圆贴 */
const p09 = build(
  'p09',
  ({ add, shape }) => {
    const BG = '#F6E3D0';
    const ORANGE = '#F0603C';
    const BROWN = '#3B2A22';
    const CREAM = '#FFF8EE';

    shape(rect(0, 0, W, H, BG));
    shape(circle(470, 340, 250, ORANGE, 'opacity="0.9"'));
    shape(circle(470, 340, 250, 'none', 'stroke="#fff" stroke-width="3" stroke-dasharray="2 12" opacity="0.7"'));
    shape(halftone(0, 900, W, 370, '#e9cdb2', 16, 3, 0.8));

    add('subtitle', '校园公益 · 旧物交换', 60, 110, { size: 22, weight: 700, fill: BROWN, ls: 3 });
    add('title', '换掉', 470, 300, { size: 96, weight: 900, fill: CREAM, anchor: 'middle' });
    add('title', '不用的', 470, 400, { size: 96, weight: 900, fill: CREAM, anchor: 'middle' });
    add('title', 'SWAP DAY', 470, 452, { size: 24, weight: 800, fill: CREAM, anchor: 'middle', ls: 8 });

    add('summary', '衣服、书、台灯、没用完的颜料。', 60, 620, { size: 28, weight: 700, fill: BROWN });
    add('summary', '带三件来，带三件走。', 60, 664, { size: 28, weight: 700, fill: BROWN });

    add('when', '11月21日 周六 13:00–17:00', 60, 760, { size: 36, weight: 800, fill: ORANGE });
    add('venue', '学生活动中心 一层 中庭', 60, 830, { size: 30, weight: 700, fill: BROWN });
    add('address', '从北门进，正对喷泉那栋', 60, 868, { size: 21, weight: 500, fill: '#6b5449' });

    add('price', '免费入场', 60, 950, { size: 28, weight: 900, fill: ORANGE });
    add('audience', '带上你的旧东西就行', 60, 992, { size: 21, weight: 500, fill: '#6b5449' });
    add('signup', '想摆摊：提前一天在群里报名', 60, 1074, { size: 20, weight: 600, fill: BROWN });
    add('contact', '咨询：青协 李同学 13900002222', 60, 1114, { size: 19, weight: 500, fill: '#6b5449' });

    shape(circle(758, 1080, 62, BROWN));
    add('contact', '扫码', 758, 1090, { size: 22, weight: 800, fill: CREAM, anchor: 'middle' });
  },
  { title: 'SWAP DAY 旧物交换', style: '暖橘圆贴 · 校园公益', month: 11, day: 21 }
);

/* ============================================================ 10. 终端横条 */
const p10 = build(
  'p10',
  ({ add, shape }) => {
    const BG = '#0C0C0C';
    const GREEN = '#6BFF9E';
    const GREY = '#8A8A8A';
    const AMBER = '#FFC24B';

    shape(rect(0, 0, W, H, BG));
    shape(`<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${GREEN}" stroke-width="1.4" opacity="0.55"/>`);
    for (let y = 90; y < H - 100; y += 34) shape(line(70, y, W - 70, y, '#ffffff', 0.4, 'opacity="0.05"'));

    add('subtitle', '> 48H HACKATHON // 主题：校园', 78, 120, { size: 22, weight: 600, fill: GREEN, fam: MONO });
    add('title', 'HACK', 74, 260, { size: 132, weight: 700, fill: '#fff', fam: MONO, ls: 2 });
    add('title', 'CAMPUS', 74, 386, { size: 132, weight: 700, fill: GREEN, fam: MONO, ls: 2 });
    add('summary', '// 两天，从想法到能跑的原型', 78, 452, { size: 24, weight: 500, fill: GREY, fam: MONO });
    add('summary', '// 提供场地、电源、泡面和三位导师', 78, 490, { size: 24, weight: 500, fill: GREY, fam: MONO });

    shape(rect(70, 540, W - 140, 1, GREEN, 'opacity="0.5"'));

    add('when', '[when] 11月28日 09:00 起 至 11月29日 21:00', 78, 630, { size: 27, weight: 600, fill: '#fff', fam: MONO });
    add('venue', '[where] 创客空间 3 楼 · 全天开放', 78, 712, { size: 27, weight: 600, fill: '#fff', fam: MONO });
    add('address', '[addr] 大学生活动中心 西门 上三楼', 78, 754, { size: 20, weight: 500, fill: GREY, fam: MONO });

    add('price', '[free] 免费，含餐', 78, 836, { size: 25, weight: 600, fill: AMBER, fam: MONO });
    add('audience', '[who] 不限专业，欢迎单人报名（会被组队）', 78, 878, { size: 20, weight: 500, fill: GREY, fam: MONO });

    add('signup', '[apply] 11月24日 23:59 截止，填表报名', 78, 966, { size: 24, weight: 600, fill: GREEN, fam: MONO });
    add('contact', '[mail] hack@example.edu', 78, 1008, { size: 21, weight: 500, fill: GREY, fam: MONO });

    shape(rect(70, 1070, 700, 92, 'none', `stroke="${GREEN}" stroke-width="1.4" stroke-dasharray="6 6"`));
    add('signup', '扫码或打开报名表 →', 96, 1128, { size: 26, weight: 700, fill: GREEN, fam: MONO });
    shape(rect(710, 1090, 56, 52, GREEN, 'opacity="0.9"'));
  },
  {
    title: 'HACK CAMPUS 48H',
    style: '终端风格 · 校园黑客松',
    month: 11, day: 28, endDay: 29,
    notes: {
      when: { confidence: 'low', note: '跨两天（28 日 09:00 – 29 日 21:00），需要确认日程按整段还是按首日结束' },
    },
  }
);

/* ------------------------------------------------------------------ 输出 */

const posters = [p01, p02, p03, p04, p05, p06, p07, p08, p09, p10];

await mkdir(resolve(root, 'public/posters'), { recursive: true });
await mkdir(resolve(root, 'src/lib/samples'), { recursive: true });

const fixtures = {};
for (const p of posters) {
  await writeFile(resolve(root, `public/posters/${p.id}.svg`), p.svg, 'utf8');
  fixtures[p.id] = {
    id: p.id,
    posterUrl: `/posters/${p.id}.svg`,
    meta: p.meta,
    fields: p.fields,
  };
}

await writeFile(
  resolve(root, 'src/lib/samples/fixtures.json'),
  JSON.stringify(fixtures, null, 2),
  'utf8'
);

console.log(`已生成 ${posters.length} 张海报 → public/posters/`);
for (const p of posters) {
  const keys = Object.keys(p.fields);
  const missing = ['title', 'when', 'venue', 'price', 'signup'].filter((k) => !keys.includes(k));
  console.log(`  ${p.id}  ${keys.length} 个字段${missing.length ? '  缺少: ' + missing.join(',') : ''}`);
}

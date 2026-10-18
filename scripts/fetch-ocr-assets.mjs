#!/usr/bin/env node
/**
 * 拉取本机 OCR 需要的静态资源（约 37MB，所以不进 git）。
 *
 *   node scripts/fetch-ocr-assets.mjs        # 缺什么补什么，已存在就跳过
 *   node scripts/fetch-ocr-assets.mjs --force
 *
 * 产出：
 *   public/tesseract/worker.min.js                     tesseract.js 的 worker
 *   public/tesseract/tesseract-core-simd-lstm.wasm.js  wasm 内核
 *   public/tessdata/chi_sim.traineddata.gz             中文（19.2MB）
 *   public/tessdata/eng.traineddata.gz                 英文（10.4MB）
 *
 * 训练数据来自 https://tessdata.projectnaptha.com/4.0.0/（Tesseract 官方数据，Apache-2.0）。
 */
import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const LANGS = ['chi_sim', 'eng'];
const TESSDATA_BASE = 'https://tessdata.projectnaptha.com/4.0.0';

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function copyIfNeeded(from, to, label) {
  if (!force && (await exists(to))) {
    console.log(`  · ${label} 已存在，跳过`);
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  const s = await stat(to);
  console.log(`  ✓ ${label} ← node_modules (${(s.size / 1024 / 1024).toFixed(2)} MB)`);
}

async function downloadIfNeeded(url, to, label) {
  if (!force && (await exists(to))) {
    console.log(`  · ${label} 已存在，跳过`);
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${label} 下载失败：HTTP ${res.status}`);
  const out = createWriteStream(to);
  const total = Number(res.headers.get('content-length') || 0);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total) process.stdout.write(`\r  ↓ ${label} ${((got / total) * 100).toFixed(0)}%   `);
  }
  await new Promise((r) => out.end(r));
  if (total) process.stdout.write('\r');
  const s = await stat(to);
  console.log(`  ✓ ${label} ← ${url} (${(s.size / 1024 / 1024).toFixed(2)} MB)`);
}

console.log('本机 OCR 资源：');

await copyIfNeeded(
  join(root, 'node_modules/tesseract.js/dist/worker.min.js'),
  join(root, 'public/tesseract/worker.min.js'),
  'tesseract/worker.min.js'
);
await copyIfNeeded(
  join(root, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
  join(root, 'public/tesseract/tesseract-core-simd-lstm.wasm.js'),
  'tesseract/tesseract-core-simd-lstm.wasm.js'
);

for (const lang of LANGS) {
  await downloadIfNeeded(
    `${TESSDATA_BASE}/${lang}.traineddata.gz`,
    join(root, `public/tessdata/${lang}.traineddata.gz`),
    `tessdata/${lang}.traineddata.gz`
  );
}

// 留个标记文件，方便 README 与界面判断「资源到底在不在」
await writeFile(
  join(root, 'public/tessdata/.ready'),
  `fetched ${new Date().toISOString()}\nlanguages: ${LANGS.join(',')}\n`,
  'utf8'
);

console.log('完成。本机 OCR 现在可以离线用了（npm run dev）。');

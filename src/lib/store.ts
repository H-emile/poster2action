/**
 * 首版本地存储。没有后端，所以「我的活动」只在这台设备上。
 * 界面上要如实说明这一点，而不是让人以为上传的海报被传到了服务器。
 */
import type { EventDoc } from './types';

const DOCS_KEY = 'p2a.docs.v1';
const RUNS_KEY = 'p2a.runs.v1';

export interface Run {
  id: string;
  docId: string;
  title: string;
  posterId: string;
  startedAt: number;
  ms: number;
  edits: number;
  /** 确认时仍未处理的问题数 */
  openIssues: number;
  errors: number;
  warns: number;
  confirmed: boolean;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 配额满了（dataURL 海报很容易撑爆 5MB），静默失败，界面另行提示
    return false;
  }
}

export function loadDocs(): EventDoc[] {
  return read<EventDoc[]>(DOCS_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveDoc(doc: EventDoc): boolean {
  const docs = read<EventDoc[]>(DOCS_KEY, []);
  const i = docs.findIndex((d) => d.id === doc.id);
  if (i >= 0) docs[i] = doc;
  else docs.unshift(doc);
  // 只留最近 12 份，避免把 localStorage 撑爆
  return write(DOCS_KEY, docs.slice(0, 12));
}

export function removeDoc(id: string): void {
  write(
    DOCS_KEY,
    read<EventDoc[]>(DOCS_KEY, []).filter((d) => d.id !== id)
  );
}

export function loadRuns(): Run[] {
  return read<Run[]>(RUNS_KEY, []);
}

export function logRun(run: Run): void {
  write(RUNS_KEY, [run, ...read<Run[]>(RUNS_KEY, [])].slice(0, 60));
}

export function runStats() {
  const runs = loadRuns();
  if (!runs.length) return { count: 0, avgMs: 0, avgEdits: 0, caught: 0, openRate: 0 };
  const avgMs = runs.reduce((s, r) => s + r.ms, 0) / runs.length;
  const avgEdits = runs.reduce((s, r) => s + r.edits, 0) / runs.length;
  const caught = runs.reduce((s, r) => s + r.errors + r.warns, 0);
  const clean = runs.filter((r) => r.openIssues === 0).length;
  return {
    count: runs.length,
    avgMs,
    avgEdits,
    caught,
    openRate: 1 - clean / runs.length,
  };
}

export function newId(prefix = 'evt'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 上次在看哪一份：刷新后回到同一张，不用重新找 */
const LAST_KEY = 'p2a.current.v1';

export function lastDocId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastDocId(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* 存不下就算了，不影响用 */
  }
}

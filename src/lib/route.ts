import { unpackDoc } from './share';
import type { EventDoc } from './types';

/** 分享出去的链接长这样：#/v/<压缩后的活动数据> */
export type Route = { view: 'desk' } | { view: 'page'; doc: EventDoc };

const PAGE_RE = /^#\/v\/(.+)$/;

export function readRoute(): Route {
  const m = PAGE_RE.exec(window.location.hash);
  if (m) {
    const doc = unpackDoc(m[1]);
    if (doc) return { view: 'page', doc };
  }
  return { view: 'desk' };
}

export function goDesk() {
  // 用 replaceState 清掉 hash，不新增历史记录里的一堆空步骤
  history.replaceState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

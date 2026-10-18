import { useMemo, useState } from 'react';
import { buildICS, downloadFile, googleCalendarUrl, icsFileName } from '../lib/ics';
import { mapLinks } from '../lib/maps';
import { toPlainText } from '../lib/derive';
import { shareUrl } from '../lib/share';
import type { EventModel } from '../lib/derive';
import type { EventDoc } from '../lib/types';
import '../styles/event.css';

export type PageMode = 'standard' | 'large' | 'brief' | 'structured';

export const MODE_META: Record<PageMode, { name: string; hint: string }> = {
  standard: { name: '标准版', hint: '手机上从上往下读，关键信息在最前面。' },
  large: { name: '大字版', hint: '正文 22px、按钮 48px 起，给看不清小字的人。' },
  brief: { name: '简明版', hint: '只留时间、地点、怎么参加，其他都收起来。' },
  structured: { name: '结构化', hint: 'dt/dd 线性排列、去掉装饰，屏幕阅读器从头读到尾。' },
};

interface Props {
  doc: EventDoc;
  model: EventModel;
  mode: PageMode;
  /** 单独打开分享链接时，多一点「这一页是怎么来的」的交代 */
  standalone?: boolean;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 老浏览器/无 HTTPS 时的兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export default function EventPage({ doc, model, mode, standalone }: Props) {
  const [done, setDone] = useState<string | null>(null);
  const maps = useMemo(() => mapLinks(model.venue, model.address), [model.venue, model.address]);

  const flash = (msg: string) => {
    setDone(msg);
    window.setTimeout(() => setDone(null), 3200);
  };

  const addToCalendar = () => {
    const url = shareUrl(doc);
    downloadFile(icsFileName(model), buildICS(model, { url }), 'text/calendar');
    flash('已下载 .ics：手机上点开就能存进日历');
  };

  const whenClass = model.whenParts ? 'ep-when-big is-stacked' : 'ep-when-big';
  const whenNode = model.whenParts ? (
    model.whenParts.map((line) => (
      <span key={line} className="ep-when-line">
        {line}
      </span>
    ))
  ) : (
    model.whenLabel
  );
  const placeMain = model.venue || model.address || '';
  const placeSub = model.venue && model.address ? model.address : '';

  const facts = [
    { label: '时间', value: model.whenLabel, strong: true },
    { label: '地点', value: placeMain || '海报上没写', strong: true },
    { label: '费用', value: model.priceLabel },
    { label: '怎么参加', value: model.signup || '直接到场' },
  ].filter((f) => f.value);

  const googleUrl = googleCalendarUrl(model);
  const actions = (
    <div className="ep-actions">
      {model.when.startISO ? (
        <>
          <button type="button" className="ep-btn ep-btn-main" onClick={addToCalendar}>
            加入手机日历
          </button>
          <a className="ep-btn" href={googleUrl} target="_blank" rel="noreferrer">
            用 Google 日历
          </a>
        </>
      ) : (
        <p className="ep-btn-note">时间还没写全，所以还加不了日历——把海报上的时间补进「时间」这一项就行。</p>
      )}
      {maps[0] && (
        <a className="ep-btn" href={maps[0].url} target="_blank" rel="noreferrer">
          导航到这里
        </a>
      )}
      <button
        type="button"
        className="ep-btn ep-btn-ghost"
        onClick={async () => {
          const ok = await copyText(toPlainText(model));
          flash(ok ? '活动信息已复制，可以贴到群里' : '复制失败，手动选中下面的文字试试');
        }}
      >
        复制活动信息
      </button>
    </div>
  );

  if (mode === 'structured') {
    return (
      <article className="ep ep-structured" lang="zh-CN" aria-label="活动信息">
        <h1 className="ep-h1">{model.title || '（活动名称待补）'}</h1>
        {model.subtitle && <p className="ep-sub">{model.subtitle}</p>}
        <p className="ep-lede">
          本页由一张活动海报生成。以下每一条都能回到海报上的原位置核对；写的是「待定」「没写」的地方，就是海报上确实没有。
        </p>
        <dl className="ep-dl">
          {facts.map((f) => (
            <div key={f.label} className="ep-dl-row">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
          {model.address && (
            <div className="ep-dl-row">
              <dt>地址</dt>
              <dd>{model.address}</dd>
            </div>
          )}
          {model.audience && (
            <div className="ep-dl-row">
              <dt>适合谁</dt>
              <dd>{model.audience}</dd>
            </div>
          )}
          {model.contact && (
            <div className="ep-dl-row">
              <dt>联系方式</dt>
              <dd>{model.contact}</dd>
            </div>
          )}
          {model.summary && (
            <div className="ep-dl-row">
              <dt>活动介绍</dt>
              <dd>{model.summary}</dd>
            </div>
          )}
        </dl>
        {actions}
        <p className="ep-foot">
          一图成行 · 由海报生成的活动页。若与海报不符，以海报和主办方通知为准。
        </p>
      </article>
    );
  }

  if (mode === 'brief') {
    return (
      <article className="ep ep-brief" lang="zh-CN">
        <h1 className="ep-h1">{model.title || '（活动名称待补）'}</h1>
        <p className={whenClass}>{whenNode}</p>
        <p className="ep-place-big">{placeMain || '地点待确认'}</p>
        {placeSub && <p className="ep-price">{placeSub}</p>}
        <p className="ep-price">{model.priceLabel}</p>
        <p className="ep-signup">{model.signup || '直接到场'}</p>
        {actions}
        <p className="ep-foot mono">只有三件事要看：什么时候、在哪、怎么去。</p>
      </article>
    );
  }

  return (
    <article className={`ep ep-${mode}`} lang="zh-CN">
      <header className="ep-hero">
        <p className="ep-kicker mono">
          活动 · {doc.source === 'fixture' ? doc.styleTag : '海报'}
        </p>
        <h1 className="ep-h1">{model.title || '（活动名称待补）'}</h1>
        {model.subtitle && <p className="ep-sub">{model.subtitle}</p>}
        <p className={whenClass}>{whenNode}</p>
      </header>

      <dl className="ep-facts">
        <div className="ep-fact">
          <dt>地点</dt>
          <dd>
            <strong>{placeMain || '海报上没写'}</strong>
            {placeSub && <span className="ep-fact-sub">{placeSub}</span>}
          </dd>
        </div>
        <div className="ep-fact">
          <dt>费用</dt>
          <dd>{model.priceLabel}</dd>
        </div>
        <div className="ep-fact">
          <dt>怎么参加</dt>
          <dd>
            {model.signup || '直接到场'}
            {model.signupUrl && (
              <a className="ep-link" href={model.signupUrl} target="_blank" rel="noreferrer">
                报名链接
              </a>
            )}
          </dd>
        </div>
        {model.audience && (
          <div className="ep-fact">
            <dt>适合谁</dt>
            <dd>{model.audience}</dd>
          </div>
        )}
        {model.contact && (
          <div className="ep-fact">
            <dt>联系</dt>
            <dd>{model.contact}</dd>
          </div>
        )}
      </dl>

      {model.summary && (
        <section className="ep-body">
          <h2>活动介绍</h2>
          <p>{model.summary}</p>
        </section>
      )}

      {actions}

      {standalone && doc.posterUrl && (
        <details className="ep-source">
          <summary>看看原海报（这一页就是从它读出来的）</summary>
          <img src={doc.posterUrl} alt={`原海报：${doc.posterName}`} />
          <p>海报上写了什么，这一页就写什么。图上没有的内容，这里不会凭空多出来。</p>
        </details>
      )}

      <footer className="ep-foot mono">
        一图成行 · 由海报生成
        {standalone ? ' · 信息来自原海报，可核对' : ''}
      </footer>

      {done && (
        <p className="ep-done" role="status">
          {done}
        </p>
      )}
    </article>
  );
}

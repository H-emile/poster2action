import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import EventPage, { MODE_META, type PageMode } from './EventPage';
import LivePoster from './LivePoster';
import { buildICS, downloadFile, icsFileName } from '../lib/ics';
import { mapLinks, mapQuery } from '../lib/maps';
import { shareUrl, shareFitness } from '../lib/share';
import { copyText } from '../lib/clipboard';
import type { EventModel } from '../lib/derive';
import type { EventDoc } from '../lib/types';
import '../styles/action.css';

const MODES: PageMode[] = ['standard', 'large', 'brief', 'structured'];

type View = 'live' | PageMode;

const TABS: { id: View; name: string; hint: string }[] = [
  { id: 'live', name: '活海报', hint: '原图铺满：图上被圈过的每一块都能点。' },
  ...MODES.map((m) => ({ id: m as View, name: MODE_META[m].name, hint: MODE_META[m].hint })),
];

interface Props {
  doc: EventDoc;
  model: EventModel;
  onBack: () => void;
  onToast: (msg: string) => void;
}

export default function ActionView({ doc, model, onBack, onToast }: Props) {
  const [view, setView] = useState<View>('live');
  const [qrErr, setQrErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const url = shareUrl(doc);
  const fit = shareFitness(url);
  const maps = mapLinks(model.venue, model.address);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setQrErr(null);
    QRCode.toCanvas(canvas, url, {
      margin: 1,
      width: 216,
      errorCorrectionLevel: 'M',
      color: { dark: '#15171bff', light: '#fbf8f1ff' },
    }).catch((e: unknown) => setQrErr(e instanceof Error ? e.message : String(e)));
  }, [url]);

  const todo = model.errors + model.warns;

  return (
    <div className="av">
      <header className="av-head">
        <div className="av-head-left">
          <button type="button" className="av-back" onClick={onBack}>
            ← 回到校样台
          </button>
          <h2>这一页可以发出去了</h2>
          <p>
            同一份信息有四种读法。改校样台里的任何一个字，这四页会同时变；发出去的链接里存的就是这一份。
          </p>
        </div>
        <p className={`av-status ${todo ? 'is-warn' : 'is-ok'}`}>
          {todo ? `还有 ${model.errors} 错 · ${model.warns} 警 没处理` : '没有待处理的问题'}
          <span className="sep">·</span>
          {doc.confirmed ? '已确认这版' : '尚未确认这版'}
        </p>
      </header>

      <div className="av-grid">
        {/* 左：来源 */}
        <aside className="av-source" aria-label="信息来源">
          <h3 className="av-h3 mono">这一页从哪来</h3>
          <img className="av-poster" src={doc.posterUrl} alt={`海报：${doc.posterName}`} />
          <p className="av-src-note">
            每条信息都来自左边这张海报。
            {model.traced > 0 ? `其中 ${model.traced} 项能点到原图位置。` : ''}
            没读到的地方写成「海报上没写」，没有替你编。
          </p>
          <ul className="av-src-list">
            <li>
              <span className="mono">标题</span>
              <span>{model.title || '—'}</span>
            </li>
            <li>
              <span className="mono">时间</span>
              <span>{model.whenShort}</span>
            </li>
            <li>
              <span className="mono">地点</span>
              <span>{model.place || '—'}</span>
            </li>
          </ul>
          {todo > 0 && (
            <p className="av-caution">
              还没处理的 {todo} 个问题不会拦住发布，但发出去之后别人看到的就是现在这一版。点「回到校样台」能逐条修。
            </p>
          )}
        </aside>

        {/* 中：手机预览 */}
        <section className="av-phone" aria-label="手机上的样子">
          <div className="av-modes" role="tablist" aria-label="这一页长什么样">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={view === t.id}
                className={`av-mode ${view === t.id ? 'is-on' : ''}`}
                onClick={() => setView(t.id)}
                data-view={t.id}
              >
                <span className="av-mode-name">{t.name}</span>
              </button>
            ))}
          </div>
          <p className="av-mode-hint mono">{TABS.find((t) => t.id === view)?.hint}</p>

          <div className="phone-shell">
            <div className="phone-notch" aria-hidden />
            <div className="phone-body" id="phone-body">
              {view === 'live' ? (
                <LivePoster doc={doc} model={model} inline onToast={onToast} onSwitchText={() => setView('brief')} />
              ) : (
                <EventPage doc={doc} model={model} mode={view} />
              )}
            </div>
          </div>
          <p className="av-phone-note mono">
            {view === 'live'
              ? '点海报上任何一个虚线框试试：时间能加日历、场地能导航、别的能放大。'
              : '页面里的按钮是真的：点「加入手机日历」会下载 .ics（手机上打开即入日历）。'}
          </p>
        </section>

        {/* 右：发出去 */}
        <aside className="av-share" aria-label="发布与分享">
          <h3 className="av-h3 mono">发出去</h3>

          <label className="av-label mono" htmlFor="share-url">
            活动链接
          </label>
          <div className="av-url-row">
            <input id="share-url" className="av-url" value={url} readOnly onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="av-mini"
              onClick={async () => onToast((await copyText(url)) ? '链接已复制' : '复制失败，手动选中链接')}
            >
              复制
            </button>
          </div>
          <p className={`av-fit mono ${fit.ok ? '' : 'is-bad'}`}>
            {url.length} 字符
            {fit.ok ? ' · 长度正常，二维码扫得开' : ' · 太长了，有些扫码器会失败，建议用示例海报或导出 JSON'}
          </p>

          <div className="av-qr">
            {qrErr ? (
              <p className="av-qr-err mono">二维码生成失败：{qrErr}</p>
            ) : (
              <canvas ref={canvasRef} width={216} height={216} aria-label="活动链接二维码" />
            )}
            <p className="av-qr-note mono">手机相机扫这张，打开的是一整页活动，不是压缩包链接。</p>
          </div>

          <div className="av-actions">
            <button
              type="button"
              className="av-act"
              onClick={() => {
                downloadFile(icsFileName(model), buildICS(model, { url }), 'text/calendar');
                onToast('已下载 .ics，手机上打开就能进日历');
              }}
            >
              <span>下载日历文件</span>
              <span className="mono">.ics</span>
            </button>
            <button
              type="button"
              className="av-act"
              onClick={async () =>
                onToast((await copyText(url)) ? '链接已复制，可以贴到群里' : '复制失败，手动选中链接')
              }
            >
              <span>复制活动链接</span>
              <span className="mono">URL</span>
            </button>
            <a className="av-act" href={url} target="_blank" rel="noreferrer">
              <span>在新标签看这一页</span>
              <span className="mono">OPEN</span>
            </a>
            <button
              type="button"
              className="av-act"
              onClick={() => {
                const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${(model.title || 'event').slice(0, 30)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                onToast('已导出 JSON：这是可以被别的工具接手的原始数据');
              }}
            >
              <span>导出原始数据</span>
              <span className="mono">JSON</span>
            </button>
          </div>

          {maps.length > 0 && (
            <div className="av-maps">
              <h3 className="av-h3 mono">导航链接</h3>
              <p className="av-maps-q mono">搜：「{mapQuery(model.venue, model.address)}」</p>
              <ul>
                {maps.map((m) => (
                  <li key={m.id}>
                    <a href={m.url} target="_blank" rel="noreferrer">
                      {m.name}
                    </a>
                    <span className="mono">{m.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

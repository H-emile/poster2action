/**
 * 活海报：把海报本身变成入口。
 *
 * 不给观众看一份「整理过的摘要」，而是把原图铺满屏幕，图上被圈过的地方都能点：
 * 点时间 → 加日历、点场地 → 导航、点任何一块 → 放大到看得清。
 * 字段一个都没录也行——只圈不写，它照样是能点的入口。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import '../styles/live.css';
import { buildICS, downloadFile, googleCalendarUrl, icsFileName } from '../lib/ics';
import { mapLinks } from '../lib/maps';
import { copyText } from '../lib/clipboard';
import { shareUrl } from '../lib/share';
import { collectSpots, SPOT_ACTION_LABEL, spotCapabilities, type Spot } from '../lib/hotspots';
import type { EventDoc } from '../lib/types';
import type { EventModel } from '../lib/derive';

interface Props {
  doc: EventDoc;
  model: EventModel;
  /** 有文字版可切时给一个出口 */
  onSwitchText?: () => void;
  /** 提示（复制成功等） */
  onToast?: (msg: string) => void;
  /** 单独打开（分享落地页）时顶部不显示「回到校样台」 */
  standalone?: boolean;
  /** 塞在手机预览框里：抽屉跟着框走，不铺满整页 */
  inline?: boolean;
}

function pct(n: number): string {
  return `${Math.round(n * 10000) / 100}%`;
}

/** 放大图：只用 rect 控制 background-size / position，不裁图 */
function cropStyle(url: string, spot: Spot): CSSProperties {
  // 框通常卡着字边，放大时留一点呼吸：四周各放 2.5%
  const pad = 0.025;
  const x = Math.max(0, spot.rect.x - pad);
  const y = Math.max(0, spot.rect.y - pad);
  const w = Math.min(Math.max(spot.rect.w + pad * 2, 0.02), 1 - x);
  const h = Math.min(Math.max(spot.rect.h + pad * 2, 0.02), 1 - y);
  const gx = w >= 1 ? 0 : x / (1 - w);
  const gy = h >= 1 ? 0 : y / (1 - h);
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${100 / w}% ${100 / h}%`,
    backgroundPosition: `${pct(Math.min(Math.max(gx, 0), 1))} ${pct(Math.min(Math.max(gy, 0), 1))}`,
    aspectRatio: `${w} / ${h}`,
  };
}

export default function LivePoster({ doc, model, onSwitchText, onToast, standalone, inline }: Props) {
  const spots = useMemo(() => collectSpots(doc), [doc]);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const open = spots.find((s) => s.id === openId) ?? null;
  const caps = open ? spotCapabilities(open, model) : null;

  const close = useCallback(() => {
    setOpenId(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const flash = (msg: string) => onToast?.(msg);

  const addToCalendar = () => {
    const text = buildICS(model, { url: doc.source === 'upload' ? undefined : shareUrl(doc) });
    downloadFile(icsFileName(model), text, 'text/calendar');
    flash('已下载日历文件：在手机上打开它就能加进日历。');
  };

  async function copyLine(line: string, what: string) {
    const ok = await copyText(line);
    flash(ok ? `${what}已复制。` : '这台浏览器不让复制，选中文字手动抄一下。');
  }

  const link = model.signupUrl || '';
  const nav = open?.action === 'place' ? mapLinks(model.venue, model.address) : [];

  return (
    <section className={`lp${standalone ? ' lp-standalone' : ''}${inline ? ' lp-inline' : ''}`} aria-label="活海报">
      <header className="lp-bar">
        <div className="lp-bar-main">
          <h1 className="lp-title">{model.title || '（活动名称待补）'}</h1>
          <p className="lp-when mono">{model.whenShort || '时间待补'}</p>
        </div>
        <div className="lp-bar-actions">
          <button type="button" className="lp-btn lp-btn-quiet" onClick={addToCalendar} disabled={!model.when.startISO}>
            加入日历
          </button>
          {onSwitchText && (
            <button type="button" className="lp-btn lp-btn-quiet" onClick={onSwitchText}>
              看文字版
            </button>
          )}
        </div>
      </header>

      {spots.length > 0 && !openId && (
        <p className="lp-hint">
          图上 <b>{spots.length}</b> 个虚线框都能点：点开能放大看字，时间和地点还能直接加日历、开导航。
        </p>
      )}

      {doc.posterUrl ? (
        <>
          <div className="lp-plate">
            <div className="lp-canvas" style={{ aspectRatio: `${doc.posterW} / ${doc.posterH}` }}>
              <img className="lp-img" src={doc.posterUrl} alt={`海报：${doc.posterName}`} draggable={false} />
              {spots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`lp-spot${openId === s.id ? ' is-open' : ''}`}
                  data-spot={s.id}
                  style={{ left: pct(s.rect.x), top: pct(s.rect.y), width: pct(s.rect.w), height: pct(s.rect.h) }}
                  aria-label={`第 ${s.index} 块：${s.label}，${SPOT_ACTION_LABEL[s.action]}`}
                  aria-expanded={openId === s.id}
                  onClick={(e) => {
                    openerRef.current = e.currentTarget;
                    setOpenId(openId === s.id ? null : s.id);
                  }}
                >
                  <span className="lp-spot-idx mono">{s.index}</span>
                  <span className="lp-spot-tag mono">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="lp-hint">
            {spots.length
              ? `图上有 ${spots.length} 块能点：${[...new Set(spots.map((s) => SPOT_ACTION_LABEL[s.action]))].join('、')}。点一下看清楚，能用的动作就在下面。`
              : '这张图还没有能点的地方。回校样台圈一块（哪怕只写个名字），它就变成入口了。'}
          </p>
        </>
      ) : (
        <div className="lp-noposter">
          <p className="lp-noposter-title">原图没跟过来</p>
          <p>
            分享链接只带得动文字和框的位置，带不动照片本身。这一页仍然能用——点下面的编号看文字，或者让发链接的人改用文字版。
          </p>
          <ul className="lp-noposter-list">
            {spots.map((s) => (
              <li key={s.id}>
                <button type="button" className="lp-btn lp-btn-line" onClick={() => setOpenId(s.id)}>
                  <span className="mono">{s.index}</span> {s.label}
                  {s.text ? <em> — {s.text}</em> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <div className="lp-backdrop" onClick={close} role="presentation">
          <div
            className="lp-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`第 ${open.index} 块：${open.label}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lp-sheet-head">
              <span className="lp-sheet-idx mono">第 {open.index} 块</span>
              <span className="lp-sheet-label">{open.label}</span>
              <button ref={closeRef} type="button" className="lp-close" onClick={close} aria-label="关掉">
                ✕
              </button>
            </div>

            {doc.posterUrl && <div className="lp-crop" style={cropStyle(doc.posterUrl, open)} role="img" aria-label="这一块在原图上的样子" />}

            <p className={`lp-sheet-text${open.text ? '' : ' is-empty'}`}>
              {open.text || '这一块还没有人抄成文字——框在了，字还没写。'}
            </p>

            <div className="lp-sheet-actions">
              {open.action === 'when' && (
                <>
                  <button type="button" className="lp-btn lp-btn-solid" onClick={addToCalendar} disabled={!caps?.canCalendar}>
                    加入手机日历
                  </button>
                  {caps?.canCalendar ? (
                    <a className="lp-btn lp-btn-line" href={googleCalendarUrl(model)} target="_blank" rel="noreferrer">
                      Google 日历
                    </a>
                  ) : (
                    <span className="lp-why">时间还没填完整，加不了日历</span>
                  )}
                </>
              )}

              {open.action === 'place' &&
                (nav.length ? (
                  nav.map((m) => (
                    <a key={m.url} className="lp-btn lp-btn-line" href={m.url} target="_blank" rel="noreferrer">
                      导航到「{m.name}」
                    </a>
                  ))
                ) : (
                  <span className="lp-why">场地还没填，导航不知道去哪</span>
                ))}

              {open.action === 'signup' &&
                (link ? (
                  <a className="lp-btn lp-btn-solid" href={link} target="_blank" rel="noreferrer">
                    去报名
                  </a>
                ) : open.text ? (
                  <button type="button" className="lp-btn lp-btn-line" onClick={() => copyLine(open.text, '报名方式')}>
                    复制报名方式
                  </button>
                ) : (
                  <span className="lp-why">海报只写了怎么报名，没给链接——让主办方补一条</span>
                ))}

              {open.action === 'price' && open.text && (
                <button type="button" className="lp-btn lp-btn-line" onClick={() => copyLine(open.text, '价格')}>
                  复制价格
                </button>
              )}

              {open.text && open.action !== 'signup' && open.action !== 'price' && (
                <button type="button" className="lp-btn lp-btn-quiet" onClick={() => copyLine(open.text, '这段文字')}>
                  复制这段文字
                </button>
              )}

              {caps?.zoomOnly && <span className="lp-why">这一块没有别的动作，留着放大看字。</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

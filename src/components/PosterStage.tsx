import { useEffect, useRef, useState } from 'react';
import {
  CONF_LABEL,
  FIELD_META,
  FIELD_ORDER,
  type EventDoc,
  type FieldKey,
  type Rect,
  type SpotAction,
} from '../lib/types';
import type { EventModel } from '../lib/derive';

export type Zoom = 'fit' | '1x' | '2x';

const ZOOMS: { id: Zoom; label: string }[] = [
  { id: 'fit', label: '适应' },
  { id: '1x', label: '100%' },
  { id: '2x', label: '200%' },
];

const actionWord = (a: SpotAction): string =>
  a === 'when' ? '加进日历' : a === 'place' ? '打开地图' : a === 'signup' ? '去报名' : a === 'price' ? '复制这句话' : '放大看字';

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
const idx = (k: FieldKey) => String(FIELD_ORDER.indexOf(k) + 1).padStart(2, '0');
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Props {
  doc: EventDoc;
  model: EventModel;
  pinned: FieldKey | null;
  hovered: FieldKey | null;
  onPin: (key: FieldKey | null) => void;
  onHover: (key: FieldKey | null) => void;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  showRects: boolean;
  onShowRects: (v: boolean) => void;
  onEditField: (key: FieldKey) => void;
  armField: FieldKey | null;
  onRectCommit: (rect: Rect) => void;
  onCancelArm: () => void;
  onMsg: (msg: string) => void;
  /** 上传的海报还没圈过任何一处：脚下提醒一句「这张没识别」 */
  needBoxes: boolean;
  /** 删掉自己圈的一块 */
  onRemoveHotspot: (id: string) => void;
  /** 正在圈一块「图上别的东西」（自定义块，不进字段） */
  customArm: boolean;
  onStartCustom: () => void;
}

type Drag = { x0: number; y0: number; x1: number; y1: number };

export default function PosterStage({
  doc,
  model,
  pinned,
  hovered,
  onPin,
  onHover,
  zoom,
  onZoom,
  showRects,
  onShowRects,
  onEditField,
  armField,
  onRectCommit,
  onCancelArm,
  onMsg,
  needBoxes,
  onRemoveHotspot,
  customArm,
  onStartCustom,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const traced = doc.fields.filter((f) => f.rect);
  const hotspots = doc.hotspots ?? [];
  const arming = armField !== null || customArm;

  useEffect(() => {
    if (!pinned) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-rect="${pinned}"]`);
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [pinned, zoom]);

  useEffect(() => {
    if (arming) setDrag(null);
  }, [arming]);

  const width = zoom === 'fit' ? '100%' : zoom === '1x' ? `${doc.posterW}px` : `${doc.posterW * 2}px`;

  const point = (e: React.PointerEvent) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: clamp01((e.clientX - box.left) / box.width), y: clamp01((e.clientY - box.top) / box.height) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!arming) return;
    const p = point(e);
    if (!p) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = point(e);
    if (!p) return;
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };

  const onUp = () => {
    if (!drag) return;
    const rect: Rect = {
      x: Math.min(drag.x0, drag.x1),
      y: Math.min(drag.y0, drag.y1),
      w: Math.abs(drag.x1 - drag.x0),
      h: Math.abs(drag.y1 - drag.y0),
    };
    setDrag(null);
    if (rect.w < 0.015 || rect.h < 0.008) {
      onMsg('框太小了：按住往右下拖一段，把整句文字盖住再松手。');
      return;
    }
    onRectCommit(rect);
  };

  const preview: Rect | null = drag
    ? {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
    : null;

  return (
    <section className="stage" aria-label="原海报">
      <div className="stage-bar">
        <div className="stage-title">
          <span className="mono" aria-hidden>
            原图
          </span>
          <span className="poster-dim mono">
            {doc.posterW} × {doc.posterH}
          </span>
          <span className="stage-count mono">
            {traced.length} 个框 / {model.filled} 项有内容
          </span>
        </div>

        <div className="stage-tools">
          <div className="seg" role="group" aria-label="缩放">
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                className={zoom === z.id ? 'is-on' : ''}
                aria-pressed={zoom === z.id}
                onClick={() => onZoom(z.id)}
              >
                {z.label}
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={showRects} onChange={(e) => onShowRects(e.target.checked)} />
            <span>框线</span>
          </label>
        </div>
      </div>

      {arming && (
        <div className="stage-arm" role="status">
          <p>
            {customArm ? (
              <>
                正在圈 <b>一块图上别的东西</b>：按住拖出范围，松手以后再给它起名、选它点开能干什么。
              </>
            ) : (
              <>
                正在框 <b>{FIELD_META[armField!].label}</b>：在海报上按住，从文字左上角拖到右下角，松手就定住。
              </>
            )}
          </p>
          <button type="button" className="stage-arm-cancel mono" onClick={onCancelArm}>
            Esc 取消
          </button>
        </div>
      )}

      <div className="stage-scroll" ref={scrollRef}>
        <div className="poster-frame" style={{ width }}>
          <div className="frame-mark tl" aria-hidden />
          <div className="frame-mark tr" aria-hidden />
          <div className="frame-mark bl" aria-hidden />
          <div className="frame-mark br" aria-hidden />

          {!doc.posterUrl ? (
            <div className="poster-missing">
              <p className="mono">原图没在这台设备上</p>
              <p>这张海报的图片不在本机了（换浏览器、清了数据，或当初没存下来）。字段还在，可以接着改；要重看原图，请重新上传同一张。</p>
            </div>
          ) : (
            <div
              ref={wrapRef}
              className={`poster-wrap ${showRects ? '' : 'no-rects'} ${arming ? 'is-arming' : ''}`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <img src={doc.posterUrl} alt={`活动海报：${model.title}`} width={doc.posterW} height={doc.posterH} draggable={false} />

              {traced.map((f) => {
                const r = f.rect!;
                const isActive = pinned === f.key || hovered === f.key;
                const isDim = pinned !== null && pinned !== f.key;
                const labelInside = r.y < 0.055;
                return (
                  <button
                    key={f.key}
                    type="button"
                    data-rect={f.key}
                    className={[
                      'rect',
                      `conf-${f.confidence}`,
                      isActive ? 'is-active' : '',
                      isDim ? 'is-dim' : '',
                      labelInside ? 'label-inside' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
                    onMouseEnter={() => onHover(f.key)}
                    onMouseLeave={() => onHover(null)}
                    onFocus={() => onHover(f.key)}
                    onBlur={() => onHover(null)}
                    onClick={() => (isActive ? onEditField(f.key) : onPin(f.key))}
                    aria-label={`原图定位：${FIELD_META[f.key].label}（${CONF_LABEL[f.confidence]}）`}
                  >
                    <span className="rect-idx mono">{idx(f.key)}</span>
                    <span className="rect-tag">
                      <b>{FIELD_META[f.key].label}</b>
                      <span className="mono">{CONF_LABEL[f.confidence]}</span>
                    </span>
                  </button>
                );
              })}

              {hotspots.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  data-rect={`hot-${h.id}`}
                  className="rect rect-hot"
                  style={{ left: pct(h.rect.x), top: pct(h.rect.y), width: pct(h.rect.w), height: pct(h.rect.h) }}
                  aria-label={`图上的一块：${h.label}（点开能${actionWord(h.action)}）`}
                  onClick={() => onPin(null)}
                >
                  <span className="rect-idx mono">{`H${i + 1}`}</span>
                  <span className="rect-tag">
                    <b>{h.label}</b>
                    <span className="mono">能点</span>
                  </span>
                </button>
              ))}

              {preview && (
                <div
                  className="rect-preview"
                  style={{ left: pct(preview.x), top: pct(preview.y), width: pct(preview.w), height: pct(preview.h) }}
                  aria-hidden
                >
                  <span className="rect-tag">
                    <b>{armField ? FIELD_META[armField].label : customArm ? '图上的一块' : ''}</b>
                    <span className="mono">{Math.round(preview.w * doc.posterW)}×{Math.round(preview.h * doc.posterH)}px</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="stage-foot">
        {needBoxes && (
          <p className="stage-hint">
            这张没被识别过，所以图上还没有框。点右栏任意一项的「框出原文」，在这里圈住那段字——圈过的地方以后能点回原图。
          </p>
        )}
        <p>
          点一个框，右边对应的那一行会亮起来；再点一次框，直接进那一行改字。
          <span className="mono"> Esc </span>取消选中。
        </p>
        {doc.source === 'upload' && (
          <p className="stage-add">
            <button type="button" className="add-spot mono" onClick={onStartCustom}>
              ＋ 圈一块图上别的东西
            </button>
            <span className="mono">{hotspots.length ? `已经圈了 ${hotspots.length} 块` : '免费入场、猫可入场这类碎信息也能圈'}</span>
          </p>
        )}
        {hotspots.length > 0 && (
          <ul className="stage-hots">
            {hotspots.map((h) => (
              <li key={h.id}>
                <span>{h.label}</span>
                <button
                  type="button"
                  className="hot-del"
                  aria-label={`删掉「${h.label}」这一块`}
                  onClick={() => onRemoveHotspot(h.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="legend">
          <span className="key conf-high">实线</span> 看得清
          <span className="key conf-low">虚线</span> 不太确定
          <span className="key conf-none">点线</span> 图上没有
        </p>
      </div>
    </section>
  );
}

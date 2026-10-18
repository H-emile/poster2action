/**
 * 圈完一块之后：给它起名、选「点开能干什么」、可以顺手写下这块的字。
 * 文字不是必填——只圈不写也能发，这正是「活海报」比「抄字段」轻的地方。
 */
import { useEffect, useRef, useState } from 'react';
import { SPOT_ACTION_HINT, SPOT_ACTION_LABEL } from '../lib/hotspots';
import { type Rect, type SpotAction } from '../lib/types';

const ACTIONS: SpotAction[] = ['when', 'place', 'signup', 'price', 'zoom'];

interface Props {
  rect: Rect;
  posterUrl: string;
  posterW: number;
  posterH: number;
  onSave: (label: string, action: SpotAction, text: string) => void;
  onCancel: () => void;
}

export default function SpotEditor({ rect, posterUrl, posterW, posterH, onSave, onCancel }: Props) {
  const [label, setLabel] = useState('');
  const [action, setAction] = useState<SpotAction>('zoom');
  const [text, setText] = useState('');
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const w = Math.max(rect.w, 0.02);
  const h = Math.max(rect.h, 0.02);
  const crop = {
    backgroundImage: `url("${posterUrl}")`,
    backgroundSize: `${100 / w}% ${100 / h}%`,
    backgroundPosition: `${w >= 1 ? 0 : rect.x / (1 - w)}% ${h >= 1 ? 0 : rect.y / (1 - h)}%`,
    aspectRatio: `${w * posterW} / ${h * posterH}`,
  };

  return (
    <div className="kind-backdrop" role="dialog" aria-modal="true" aria-label="给这一块起个名字">
      <div className="kind-card">
        <header className="kind-head">
          <p className="kind-kicker mono">你圈出来的一块</p>
          <h2>这块点开以后干什么？</h2>
          <button type="button" className="kind-close mono" onClick={onCancel} aria-label="取消">
            Esc
          </button>
        </header>

        <div className="kind-crop" style={crop} aria-hidden />

        <label className="kind-field">
          <span className="kind-label mono">叫它什么（观众看得见）</span>
          <input
            ref={labelRef}
            className="kind-input"
            value={label}
            maxLength={12}
            placeholder="例如：免费入场 / 猫可入场 / 摊位还有 3 个"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <div className="kind-field">
          <span className="kind-label mono">点开能做什么</span>
          <div className="kind-actions" role="group">
            {ACTIONS.map((a) => (
              <button
                key={a}
                type="button"
                className={`kind-act${action === a ? ' is-on' : ''}`}
                aria-pressed={action === a}
                onClick={() => setAction(a)}
              >
                <b>{SPOT_ACTION_LABEL[a]}</b>
                <span>{SPOT_ACTION_HINT[a]}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="kind-field">
          <span className="kind-label mono">这一块的字（可以不写）</span>
          <textarea
            className="kind-textarea"
            value={text}
            maxLength={80}
            rows={2}
            placeholder="照着海报抄，或写一句给观众的话。不写也能发——只是点开时只有放大图。"
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <footer className="kind-foot">
          <button type="button" className="kind-save" onClick={() => onSave(label, action, text)}>
            加进活海报
          </button>
          <button type="button" className="kind-cancel mono" onClick={onCancel}>
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}

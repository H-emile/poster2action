import { useEffect, useId, useRef } from 'react';
import { CONF_LABEL, FIELD_META, type Confidence, type Field, type FieldKey } from '../lib/types';

interface Props {
  field: Field;
  index: number;
  isActive: boolean;
  /** 用户点了「框出原文」，正在等他在海报上拖 */
  isArming: boolean;
  /** 自己上传的海报才能框（示例海报的框是排版时记下的真坐标） */
  canAnnotate: boolean;
  onChange: (key: FieldKey, value: string) => void;
  onFocusField: (key: FieldKey | null) => void;
  onHover: (key: FieldKey | null) => void;
  onLocate: (key: FieldKey) => void;
  onUndo: (key: FieldKey) => void;
  onArm: (key: FieldKey) => void;
  onConfidence: (key: FieldKey, c: Confidence) => void;
  registerRef: (key: FieldKey, el: HTMLLIElement | null) => void;
}

export default function FieldItem({
  field,
  index,
  isActive,
  isArming,
  canAnnotate,
  onChange,
  onFocusField,
  onHover,
  onLocate,
  onUndo,
  onArm,
  onConfidence,
  registerRef,
}: Props) {
  const meta = FIELD_META[field.key];
  const id = useId();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [field.value]);

  const empty = field.value.trim() === '';
  const edited = field.original !== undefined;
  /* 自己圈的框、字也是自己打的 —— 可信度由人来定，点一下就换 */
  const calibratable = canAnnotate && field.origin === 'manual' && !empty;

  return (
    <li
      id={`field-${field.key}`}
      ref={(el) => registerRef(field.key, el)}
      className={[
        'field',
        `conf-${field.confidence}`,
        isActive ? 'is-active' : '',
        isArming ? 'is-arming' : '',
        empty && meta.core ? 'is-empty' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={() => onHover(field.key)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="field-head">
        <span className="field-idx mono" aria-hidden>
          {String(index + 1).padStart(2, '0')}
        </span>
        <label className="field-label" htmlFor={id}>
          {meta.label}
          {meta.core && (
            <span className="req" title="生成活动页必须有这一项">
              必填
            </span>
          )}
        </label>

        {field.origin === 'poster' && field.note?.startsWith('模型') && (
          <span className="ai-chip mono" title={field.note}>
            模型读的
          </span>
        )}

        {calibratable ? (
          <button
            type="button"
            className={`conf-chip is-switch conf-${field.confidence}`}
            title="点一下换一档：看得清 ↔ 不太确定"
            aria-label={`可信度：${CONF_LABEL[field.confidence]}，点击切换`}
            onClick={() => onConfidence(field.key, field.confidence === 'high' ? 'low' : 'high')}
          >
            {CONF_LABEL[field.confidence]}
          </button>
        ) : (
          <span className={`conf-chip conf-${field.confidence}`} title={meta.hint}>
            {CONF_LABEL[field.confidence]}
          </span>
        )}

        {isArming ? (
          <span className="arm-hint mono">在海报上拖…</span>
        ) : field.rect ? (
          <button type="button" className="locate" onClick={() => onLocate(field.key)}>
            原图
          </button>
        ) : canAnnotate ? (
          <button type="button" className="locate is-arm" onClick={() => onArm(field.key)}>
            框出原文
          </button>
        ) : (
          <span className="nocite mono">无出处</span>
        )}
      </div>

      <textarea
        id={id}
        ref={taRef}
        rows={1}
        spellCheck={false}
        className="field-input"
        value={field.value}
        placeholder={meta.placeholder}
        onChange={(e) => onChange(field.key, e.target.value)}
        onFocus={() => onFocusField(field.key)}
        onBlur={() => onFocusField(null)}
      />

      {field.note && <p className="field-note">{field.note}</p>}

      {edited && (
        <p className="field-diff">
          <span className="mark">已手改</span>
          <span className="old mono" title="你第一次改动前海报上的原文">
            原：{field.original?.trim() ? field.original : '（空）'}
          </span>
          <button type="button" className="undo" onClick={() => onUndo(field.key)}>
            撤销
          </button>
        </p>
      )}
    </li>
  );
}

/**
 * 发行前体检：把「几个字段放一起才看得出来」的矛盾摆到台面上。
 * 和下面「必须处理 / 建议核对」不同——那些是一个字段的问题，这里是拼起来才成立的判断。
 */
import { checkup, verdict, type CheckItem } from '../lib/checkup';
import type { EventDoc } from '../lib/types';
import type { EventModel } from '../lib/derive';

const LEVEL_LABEL: Record<CheckItem['level'], string> = {
  error: '现在发会出事',
  warn: '发之前先看一眼',
  info: '说明',
};

interface Props {
  doc: EventDoc;
  model: EventModel;
  onJump: (key: NonNullable<CheckItem['field']>) => void;
}

export default function CheckupPanel({ doc, model, onJump }: Props) {
  const items = checkup(doc, model);
  const v = verdict(items);
  const errors = items.filter((i) => i.level === 'error');
  const warns = items.filter((i) => i.level === 'warn');
  const infos = items.filter((i) => i.level === 'info');

  return (
    <details className={`checkup ${v.ok ? 'is-ok' : 'is-bad'}`} open={!v.ok}>
      <summary className="checkup-sum">
        <span className="checkup-name">发行前体检</span>
        <span className={`checkup-verdict mono${v.ok ? ' is-ok' : ' is-bad'}`}>
          {v.ok ? '可以发' : `${v.errors} 项会出事`}
          {v.warns ? ` · ${v.warns} 项看一眼` : ''}
        </span>
      </summary>

      {!items.length && <p className="checkup-empty">没查出矛盾。可以发，发完记得回来看有没有人点。</p>}

      {[
        { level: 'error' as const, list: errors },
        { level: 'warn' as const, list: warns },
        { level: 'info' as const, list: infos },
      ]
        .filter((g) => g.list.length)
        .map((g) => (
          <div key={g.level} className={`checkup-group is-${g.level}`}>
            <h4 className="checkup-h4 mono">{LEVEL_LABEL[g.level]}</h4>
            <ul className="checkup-list">
              {g.list.map((i) => (
                <li key={i.code} className={`checkup-item is-${i.level}`}>
                  <p className="checkup-title">{i.title}</p>
                  <p className="checkup-detail">{i.detail}</p>
                  {i.field && (
                    <button type="button" className="checkup-jump mono" onClick={() => onJump(i.field!)}>
                      去看看这一项 →
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </details>
  );
}

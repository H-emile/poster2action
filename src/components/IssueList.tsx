import { FIELD_META } from '../lib/types';
import type { Issue } from '../lib/derive';

const GROUPS = [
  { level: 'error', label: '必须处理', hint: '发出去会被骂的那种错' },
  { level: 'warn', label: '建议核对', hint: '不致命，但会让人白跑一趟' },
  { level: 'info', label: '说明', hint: '系统替你记下的判断依据' },
] as const;

interface Props {
  issues: Issue[];
  onJump: (issue: Issue) => void;
}

export default function IssueList({ issues, onJump }: Props) {
  if (!issues.length) {
    return (
      <div className="issues empty">
        <p className="issues-ok">
          <span className="dot-ok" aria-hidden />
          没发现问题。日期、场地、费用、报名方式都能对上，可以去生成活动页了。
        </p>
      </div>
    );
  }

  return (
    <div className="issues">
      {GROUPS.map((g) => {
        const list = issues.filter((i) => i.level === g.level);
        if (!list.length) return null;
        return (
          <section key={g.level} className={`issue-group g-${g.level}`}>
            <header>
              <h3>
                {g.label}
                <span className="count mono">{list.length}</span>
              </h3>
              <p>{g.hint}</p>
            </header>
            <ul>
              {list.map((i) => (
                <li key={i.id}>
                  <button type="button" className="issue" onClick={() => onJump(i)}>
                    <span className="issue-title">{i.title}</span>
                    <span className="issue-detail">{i.detail}</span>
                    <span className="issue-dest mono">
                      {i.field === 'doc' ? '在整份信息里' : `定位到「${FIELD_META[i.field].label}」→`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

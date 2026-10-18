import { useRef } from 'react';
import type { SampleCard } from '../lib/samples';

export interface UploadCard {
  id: string;
  title: string;
  posterName: string;
  posterUrl: string;
  whenShort: string;
  errors: number;
  warns: number;
  filled: number;
  traced: number;
  lost: boolean;
}

interface Props {
  cards: SampleCard[];
  uploads: UploadCard[];
  current: string;
  onPick: (docId: string) => void;
  onUpload: (file: File) => void;
  onRemove: (docId: string) => void;
  uploading: boolean;
}

export default function SampleRail({ cards, uploads, current, onPick, onUpload, onRemove, uploading }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="rail" aria-label="海报列表">
      <header className="rail-head">
        <h2>示例海报</h2>
        <span className="mono">{cards.length} 张</span>
      </header>
      <p className="rail-intro">
        十种完全不同的排版，字段坐标是排版时记下来的 —— 等价于「模型已经读过了」。
        为了让你能验证「读出来了没有」，这里先不藏起原图。
      </p>

      <ul className="rail-list">
        {cards.map((c, i) => {
          const docId = `fx-${c.id}`;
          const isOn = current === docId;
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`card ${isOn ? 'is-on' : ''}`}
                onClick={() => onPick(docId)}
                aria-current={isOn ? 'true' : undefined}
              >
                <span className="card-no mono" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <img src={c.posterUrl} alt="" width={44} height={58} loading="lazy" />
                <span className="card-body">
                  <span className="card-title">{c.title}</span>
                  <span className="card-style">{c.style}</span>
                  <span className="card-meta mono">
                    {c.whenShort}
                    {c.errors > 0 && <b className="dot-err"> {c.errors} 错</b>}
                    {c.warns > 0 && <b className="dot-warn"> {c.warns} 警</b>}
                    {c.errors === 0 && c.warns === 0 && <b className="dot-ok"> 干净</b>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="rail-upload">
        <h3>我的海报</h3>
        <p className="rail-upload-note">
          没有模型也能用：上传后自己拖框标一遍，标过的那一项就能点回原图。
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          data-testid="upload-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="upload-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '正在读这张图…' : '上传一张海报'}
        </button>
        <p className="rail-upload-drop mono">也可以直接把图片拖进这个页面</p>

        {uploads.length > 0 && (
          <ul className="rail-list rail-list-up">
            {uploads.map((u) => {
              const isOn = current === u.id;
              return (
                <li key={u.id}>
                  <div className={`card card-up ${isOn ? 'is-on' : ''}`}>
                    <button type="button" className="card-pick" onClick={() => onPick(u.id)} aria-current={isOn ? 'true' : undefined}>
                      <span className="card-no mono" aria-hidden>
                        自
                      </span>
                      {u.posterUrl ? (
                        <img src={u.posterUrl} alt="" width={44} height={58} />
                      ) : (
                        <span className="card-no-img mono">没图</span>
                      )}
                      <span className="card-body">
                        <span className="card-title">{u.title}</span>
                        <span className="card-style">{u.posterName}</span>
                        <span className="card-meta mono">
                          {u.filled ? `${u.whenShort} · ${u.traced}/${u.filled} 有出处` : '还是空的'}
                          {u.errors > 0 && <b className="dot-err"> {u.errors} 错</b>}
                          {u.warns > 0 && <b className="dot-warn"> {u.warns} 警</b>}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="card-del"
                      title="删掉这张海报和它的原图"
                      aria-label={`删掉 ${u.title}`}
                      onClick={() => onRemove(u.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="rail-foot">
        <p>
          <b>示例海报的坐标是排版时记的</b>，上传的海报则是你自己拖框标的 ——
          界面会把两种来源分清楚，不假装上传的图也能自动识别。
        </p>
        <p className="mono">所有改动只存在这台设备（localStorage + IndexedDB），没有服务器。</p>
      </footer>
    </aside>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FIELD_META,
  FIELD_ORDER,
  type Confidence,
  type EventDoc,
  type FieldKey,
  type Rect,
  type SpotAction,
} from './lib/types';
import { docFromFixture, docFromUpload, fixtureIds } from './lib/extract';
import { derive } from './lib/derive';
import { loadDocs, saveDoc, removeDoc, logRun, runStats, newId, lastDocId, setLastDocId } from './lib/store';
import { putPoster, getPoster, delPoster } from './lib/imageStore';
import { loadPosterFile } from './lib/upload';
import { sampleCards } from './lib/samples';
import PosterStage, { type Zoom } from './components/PosterStage';
import FieldItem from './components/FieldItem';
import IssueList from './components/IssueList';
import CheckupPanel from './components/CheckupPanel';
import LivePoster from './components/LivePoster';
import SpotEditor from './components/SpotEditor';
import SampleRail from './components/SampleRail';
import ActionView from './components/ActionView';
import EventPage from './components/EventPage';
import { goDesk, readRoute, type Route } from './lib/route';
import { collectSpots } from './lib/hotspots';
import { applyVision, isMockModel, readPoster, visionHealth, type VisionHealth } from './lib/vision';
import { copyText } from './lib/clipboard';
import { runLocalOcr } from './lib/localOcr';

const CARDS = sampleCards();
const DEFAULT_ID = 'fx-p06';

/** 一个动作在中文里怎么说 */
const actionWord = (a: SpotAction): string =>
  a === 'when'
    ? '加进日历'
    : a === 'place'
      ? '打开地图导航'
      : a === 'signup'
        ? '去报名'
        : a === 'price'
          ? '把这句话复制走'
          : '放大了看字';

/** 下一个空着的必填项：上传海报时用来一项一项领着圈 */
function nextEmptyCore(d: EventDoc, skip?: FieldKey): FieldKey | null {
  for (const key of FIELD_ORDER) {
    if (!FIELD_META[key].core || key === skip) continue;
    const f = d.fields.find((x) => x.key === key);
    if (f && !f.value.trim()) return key;
  }
  return null;
} // 这张的日期和日历对不上，一进来就能看到系统在干什么

type SaveState = 'ok' | 'saving' | 'fail';

/** 把人改的值写回文档；改回原样就把 original 清掉，撤销标记自然消失 */
function applyField(doc: EventDoc, key: FieldKey, value: string): EventDoc {
  const fields = doc.fields.map((f) => {
    if (f.key !== key || f.value === value) return f;
    const original = f.original ?? f.value;
    return {
      ...f,
      value,
      original: value === original ? undefined : original,
      origin: value.trim() ? ('manual' as const) : ('blank' as const),
    };
  });
  return { ...doc, fields, updatedAt: Date.now() };
}

function hydrateDocs(): Record<string, EventDoc> {
  const map: Record<string, EventDoc> = {};
  for (const id of fixtureIds()) map[`fx-${id}`] = docFromFixture(id);
  for (const d of loadDocs()) map[d.id] = d; // 改过的覆盖示例
  return map;
}

export default function App() {
  const [docs, setDocs] = useState<Record<string, EventDoc>>(hydrateDocs);
  const [current, setCurrent] = useState(() => {
    const saved = lastDocId();
    return saved && hydrateDocs()[saved] ? saved : DEFAULT_ID;
  });
  const [pinned, setPinned] = useState<FieldKey | null>(null);
  const [hovered, setHovered] = useState<FieldKey | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [showRects, setShowRects] = useState(true);
  const [edits, setEdits] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('ok');
  const [toast, setToast] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [screen, setScreen] = useState<'proof' | 'action'>('proof');
  const [route, setRoute] = useState<Route>(readRoute);
  const [armField, setArmField] = useState<FieldKey | null>(null);
  // 「圈一块图上别的东西」：画完框先落一个草稿，再让用户命名、选动作
  const [customArm, setCustomArm] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [landingView, setLandingView] = useState<'live' | 'text'>('live');
  /** 上传海报时「一项一项领着圈」的模式：圈完自动跳到下一个必填项 */
  const [guided, setGuided] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [vision, setVision] = useState<VisionHealth | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionMsg, setVisionMsg] = useState<string | null>(null);
  const [visionLines, setVisionLines] = useState<string[] | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);

  const startedRef = useRef(Date.now());
  const fieldRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const saveTimer = useRef<number | null>(null);

  const doc = docs[current] ?? docs[DEFAULT_ID];
  const model = useMemo(() => derive(doc), [doc]);
  const infos = model.issues.filter((i) => i.level === 'info').length;

  /* ---------------------------------------------------------- 存 */
  useEffect(() => {
    setSaveState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState(saveDoc(doc) ? 'ok' : 'fail');
    }, 420);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [doc]);

  /* ---------------------------------------------------------- 分享链接进来 */
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* ---------------------------------------------------------- 键盘 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setArmField(null);
        setGuided(false);
        setPinned(null);
        setHovered(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5200);
  }, []);

  /* ---------------------------------------------------------- 动作 */
  const update = useCallback(
    (key: FieldKey, value: string) => {
      setDocs((prev) => ({ ...prev, [current]: applyField(prev[current], key, value) }));
      setEdits((n) => n + 1);
    },
    [current]
  );

  const undo = useCallback(
    (key: FieldKey) => {
      const f = docs[current].fields.find((x) => x.key === key);
      if (!f || f.original === undefined) return;
      setDocs((prev) => ({ ...prev, [current]: applyField(prev[current], key, f.original!) }));
      setPinned(key);
    },
    [current, docs]
  );

  const locate = useCallback((key: FieldKey, alsoScrollField = false) => {
    setPinned(key);
    if (alsoScrollField) {
      requestAnimationFrame(() => {
        fieldRefs.current[key]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  }, []);

  const jumpTo = useCallback(
    (issue: { field: FieldKey | 'doc' }) => {
      if (issue.field === 'doc') {
        setPinned(null);
        return;
      }
      locate(issue.field, true);
    },
    [locate]
  );

  const pick = useCallback((docId: string) => {
    setCurrent(docId);
    setLastDocId(docId);
    setPinned(null);
    setHovered(null);
    setZoom('fit');
    setEdits(0);
    setArmed(false);
    setArmField(null);
    startedRef.current = Date.now();
  }, []);

  /* ---------------------------------------------------------- 上传的海报：把图从 IndexedDB 取回来 */
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    (async () => {
      for (const d of Object.values(docs)) {
        if (d.source !== 'upload' || !d.posterId || d.posterUrl) continue;
        const blob = await getPoster(d.posterId);
        if (!alive || !blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        setDocs((prev) => (prev[d.id] ? { ...prev, [d.id]: { ...prev[d.id], posterUrl: url } } : prev));
      }
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // 只在挂载时跑一次；之后新上传的文档在 handler 里已经带 url 了
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    visionHealth().then((h) => {
      if (alive) setVision(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 把海报 blob 转成 data URL：模型要的是 data: 前缀，不是 blob: */
  const posterToDataUrl = useCallback(async (url: string): Promise<string> => {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('图片读不出来'));
      fr.readAsDataURL(blob);
    });
  }, []);

  /** 让模型先读一遍：只填空字段，绝不覆盖人写过的东西 */
  const runVision = useCallback(async () => {
    const d = docs[current];
    if (!d?.posterUrl) return;
    setVisionBusy(true);
    setVisionMsg('模型正在看这张海报……慢的话要二十几秒，别关页面。');
    try {
      const dataUrl = await posterToDataUrl(d.posterUrl);
      const run = await readPoster(dataUrl, vision?.model || 'Qwen/Qwen3-VL-8B-Instruct');
      const secs = (run.ms / 1000).toFixed(1);

      if (run.mode === 'ocr') {
        // 纯 OCR 模型只抄字、不给位置：位置仍然要人圈，这里只解决「打中文慢」
        setVisionLines(run.lines ?? []);
        setVisionMsg(`它只抄了字，没有给位置——${run.lines?.length ?? 0} 行，${secs} 秒。点一行就复制，圈住哪块就粘到哪一项。`);
        flash(`抄下来 ${run.lines?.length ?? 0} 行（${secs} 秒）。位置还得你圈，框和字对得上才算数。`);
        return;
      }

      const { doc: next, stats } = applyVision(d, run);
      setVisionLines(null);
      setDocs((prev) => ({ ...prev, [current]: next }));
      setEdits((n) => n + 1);
      const parts = [
        `模型读到 ${stats.filled} 项`,
        stats.hotspots ? `${stats.hotspots} 个可点块` : '',
        stats.kept ? `${stats.kept} 项你已经填过、没覆盖` : '',
        stats.noBox ? `${stats.noBox} 项没给位置` : '',
      ].filter(Boolean);
      setVisionMsg(`${run.model} · ${secs} 秒 · ${parts.join(' · ')}。每一项都标了「模型读的」，请对照原图核一遍。`);
      flash(`模型读完了（${secs} 秒）。它给的框不一定准，逐项核过再发。`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVisionMsg(`没有读成：${msg}`);
      flash(`模型这一步失败了：${msg}`);
    } finally {
      setVisionBusy(false);
    }
  }, [current, docs, flash, posterToDataUrl, vision]);

  /** 本机 OCR：不联网、不花钱，只把字抄下来，位置还得人圈 */
  const runLocal = useCallback(async () => {
    const d = docs[current];
    if (!d?.posterUrl) return;
    setOcrBusy(true);
    setOcrProgress(0);
    setVisionMsg('本机正在认字：第一次要加载中文包（约 19MB），之后会快一些。');
    try {
      const dataUrl = await posterToDataUrl(d.posterUrl);
      const run = await runLocalOcr(dataUrl, ({ progress }) => setOcrProgress(progress));
      setVisionLines(run.lines);
      const secs = (run.ms / 1000).toFixed(1);
      setVisionMsg(`本机抄下来 ${run.lines.length} 行，${secs} 秒。点一行就复制，圈住哪块粘到哪一项——位置它不知道，得你圈。`);
      flash(`本机 OCR 抄了 ${run.lines.length} 行（${secs} 秒），没联网也没花钱。`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVisionMsg(`本机 OCR 失败了：${msg}`);
      flash(`本机 OCR 失败：${msg}`);
    } finally {
      setOcrBusy(false);
      setOcrProgress(null);
    }
  }, [current, docs, flash, posterToDataUrl]);

  const onUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const poster = await loadPosterFile(file);
        const base = docFromUpload(poster.url, poster.name, poster.w, poster.h);
        const where = await putPoster(base.id, poster.blob);
        const doc: EventDoc = { ...base, posterId: base.id, posterStore: where };
        saveDoc(doc);
        setDocs((prev) => ({ ...prev, [doc.id]: doc }));
        pick(doc.id);
        flash(
          where === 'memory'
            ? '海报读进来了。但这个浏览器不让存图片，刷新后要重新上传一次。'
            : `海报读进来了（${poster.w}×${poster.h}）。接下来它只做一件事——记住每条信息来自图上哪一块。点右栏「从『活动名称』开始」我带你一项一项圈。`
        );
      } catch (err) {
        flash(err instanceof Error ? err.message : '这张图读不进来');
      } finally {
        setUploading(false);
      }
    },
    [flash, pick]
  );

  const removeUpload = useCallback(
    async (id: string) => {
      const target = docs[id];
      setDocs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      removeDoc(id);
      if (target?.posterId) await delPoster(target.posterId);
      if (target?.posterUrl.startsWith('blob:')) URL.revokeObjectURL(target.posterUrl);
      if (current === id) pick(DEFAULT_ID);
      flash('删掉了这张上传的海报，原图也从这台设备上清掉了。');
    },
    [current, docs, flash, pick]
  );

  const arm = useCallback(
    (key: FieldKey) => {
      setArmField(key);
      setPinned(key);
      flash(`在海报上圈出「${FIELD_META[key].label}」的位置：按住往右下拖，松开就定住。Esc 取消。`);
    },
    [flash]
  );

  const commitRect = useCallback(
    (rect: Rect) => {
      if (customArm) {
        setDraft(rect);
        setCustomArm(false);
        return;
      }
      const key = armField;
      if (!key) return;
      let nextKey: FieldKey | null = null;
      setDocs((prev) => {
        const d = prev[current];
        const fields = d.fields.map((f) =>
          f.key === key
            ? {
                ...f,
                rect,
                confidence: (f.confidence === 'high' ? 'high' : 'low') as Confidence,
                origin: 'manual' as const,
                note: '这个框是你自己圈的；框里的字也是你打的，没有自动识别',
              }
            : f
        );
        nextKey = nextEmptyCore({ ...d, fields }, key);
        return { ...prev, [current]: { ...d, fields, updatedAt: Date.now() } };
      });
      setArmField(null);
      setPinned(key);
      setEdits((n) => n + 1);
      // 圈完就该打字：把光标直接放进那一行的输入框
      requestAnimationFrame(() => {
        const el = fieldRefs.current[key];
        const input = el?.querySelector('textarea');
        if (input instanceof HTMLTextAreaElement) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
      const next = nextKey as FieldKey | null;
      if (guided) {
        if (next) {
          setTimeout(() => {
            setArmField(next);
            setPinned(next);
          }, 260);
          flash(`框好了。接着圈「${FIELD_META[next].label}」——把字打进去，然后直接在海报上拖下一个。`);
        } else {
          setGuided(false);
          flash('这几项都圈完了。剩下的可选项想填再填，然后点「确认」。');
        }
      } else {
        flash('框好了：这一项现在能「点回原图」。可信度默认记「不太确定」，看得清的话点一下那个小标签。');
      }
    },
    [armField, current, customArm, flash]
  );

  const removeHotspot = useCallback(
    (id: string) => {
      setDocs((prev) => {
        const d = prev[current];
        if (!d.hotspots?.length) return prev;
        return {
          ...prev,
          [current]: {
            ...d,
            hotspots: d.hotspots.filter((h) => h.id !== id),
            updatedAt: Date.now(),
          },
        };
      });
      setEdits((n) => n + 1);
      flash('这一块删掉了。海报上的字还在，只是不再是一个能点的地方。');
    },
    [current, flash]
  );

  const cancelArm = useCallback(() => {
    setArmField(null);
    setGuided(false);
    setCustomArm(false);
    setDraft(null);
  }, []);

  const startGuided = useCallback(() => {
    const first = nextEmptyCore(docs[current]) ?? 'title';
    setGuided(true);
    setArmField(first);
    setPinned(first);
    flash(`从「${FIELD_META[first].label}」开始：在海报上圈住这段字，圈完我自动带你到下一项。Esc 退出。`);
  }, [current, docs, flash]);

  /** 圈一块「图上别的东西」：不进字段，直接变成一个可点的块 */
  const startCustom = useCallback(() => {
    setArmField(null);
    setGuided(false);
    setDraft(null);
    setCustomArm(true);
    setPinned(null);
    flash('圈一块图上别的东西（免费入场、猫可入场、温馨提示都算）：按住拖出来，松手再给它起名。Esc 取消。');
  }, [flash]);

  const saveHotspot = useCallback(
    (label: string, action: SpotAction, text: string) => {
      const rect = draft;
      if (!rect) return;
      const id = `h${Date.now().toString(36).slice(-5)}`;
      setDocs((prev) => {
        const d = prev[current];
        const hotspots = [...(d.hotspots ?? []), { id, rect, label: label.trim() || '图上的一块', text: text.trim(), action }];
        return { ...prev, [current]: { ...d, hotspots, updatedAt: Date.now() } };
      });
      setDraft(null);
      setEdits((n) => n + 1);
      flash('这块加进去了：观众点它会弹出来，还能' + actionWord(action) + '。');
    },
    [current, draft, flash]
  );

  const setConfidence = useCallback(
    (key: FieldKey, confidence: Confidence) => {
      setDocs((prev) => {
        const d = prev[current];
        const fields = d.fields.map((f) =>
          f.key === key
            ? {
                ...f,
                confidence,
                note:
                  confidence === 'high'
                    ? '你说这一项看得清'
                    : '标了「不太确定」——发出去之前最好回原图再看一眼',
              }
            : f
        );
        return { ...prev, [current]: { ...d, fields, updatedAt: Date.now() } };
      });
      setEdits((n) => n + 1);
    },
    [current]
  );

  /* 拖一张图到页面任意地方就能上传 */
  useEffect(() => {
    const hasFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      if (screen === 'proof') void onUpload(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [onUpload, screen]);

  const registerRef = useCallback((key: FieldKey, el: HTMLLIElement | null) => {
    fieldRefs.current[key] = el;
  }, []);

  const uploadCards = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.source === 'upload')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((d) => {
          const m = derive(d);
          return {
            id: d.id,
            title: m.title || '（还没写活动名称）',
            posterName: d.posterName,
            posterUrl: d.posterUrl,
            whenShort: m.whenShort,
            errors: m.errors,
            warns: m.warns,
            filled: m.filled,
            traced: m.traced,
            lost: !d.posterUrl,
          };
        }),
    [docs]
  );

  const openIssueCount = model.errors + model.warns;

  const confirm = useCallback(() => {
    if (openIssueCount > 0 && !armed) {
      setArmed(true);
      flash(`还有 ${openIssueCount} 个问题没处理。再点一次就按现在这版确认。`);
      return;
    }
    const now = Date.now();
    const ms = now - startedRef.current;
    const ok = saveDoc({ ...doc, confirmed: true });
    setDocs((prev) => ({ ...prev, [current]: { ...prev[current], confirmed: true } }));
    logRun({
      id: newId('run'),
      docId: current,
      title: model.title,
      posterId: doc.posterName,
      startedAt: startedRef.current,
      ms,
      edits,
      openIssues: openIssueCount,
      errors: model.errors,
      warns: model.warns,
      confirmed: true,
    });
    setArmed(false);
    flash(
      ok
        ? `已确认这一版：用了 ${Math.max(1, Math.round(ms / 1000))} 秒，改了 ${edits} 处，还剩 ${openIssueCount} 个问题。下一步是生成活动页。`
        : '确认了，但本机存储写不进去了（配额满），刷新后会丢。'
    );
  }, [armed, current, doc, edits, flash, model.title, model.errors, model.warns, openIssueCount]);

  const stats = useMemo(() => runStats(), [toast]);

  if (route.view === 'page') {
    const pageModel = derive(route.doc);
    const spots = collectSpots(route.doc);
    const canLive = Boolean(route.doc.posterUrl) && spots.length > 0;
    const view = canLive ? landingView : 'text';
    return (
      <div className="ep-standalone">
        <div className="landing-switch mono" role="tablist" aria-label="这一页怎么看">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'live'}
            className="landing-tab"
            onClick={() => setLandingView('live')}
            disabled={!canLive}
          >
            活海报
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'text'}
            className="landing-tab"
            onClick={() => setLandingView('text')}
          >
            文字版
          </button>
        </div>
        {!canLive && (
          <p className="landing-note">
            这张海报的原图没有跟着链接过来（分享链接只带文字和坐标），所以只能看文字版。
            {spots.length === 0 && '这一页也还没有圈出任何可点的块。'}
          </p>
        )}
        {view === 'live' ? (
          <LivePoster doc={route.doc} model={pageModel} standalone onSwitchText={() => setLandingView('text')} />
        ) : (
          <EventPage doc={route.doc} model={pageModel} mode="standard" standalone />
        )}
        <p className="standalone-back mono">
          这是别人分享给你的活动页 · <button type="button" onClick={goDesk}>打开校样台</button>
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark mono" aria-hidden>
            ①→
          </span>
          <div>
            <h1>一图成行</h1>
            <p className="mono">POSTER → ACTION · 校样台</p>
          </div>
        </div>

        <p className="topbar-mid">
          海报负责吸引人，这一页负责让你核对清楚：每一条信息都能点回原图，改过的都留着痕。
        </p>

        <div className="topbar-right">
          <span className={`save mono s-${saveState}`}>
            {saveState === 'ok' ? '已存本机' : saveState === 'saving' ? '保存中…' : '存不下（配额满）'}
          </span>
        </div>
      </header>

      {screen === 'action' ? (
        <ActionView doc={doc} model={model} onBack={() => setScreen('proof')} onToast={flash} />
      ) : (
      <main className="workspace">
        <SampleRail
          cards={CARDS}
          uploads={uploadCards}
          current={current}
          onPick={pick}
          onUpload={onUpload}
          onRemove={removeUpload}
          uploading={uploading}
        />

        <PosterStage
          doc={doc}
          model={model}
          pinned={pinned}
          hovered={hovered}
          onPin={setPinned}
          onHover={setHovered}
          zoom={zoom}
          onZoom={setZoom}
          showRects={showRects}
          onShowRects={setShowRects}
          armField={armField}
          onRectCommit={commitRect}
          onCancelArm={cancelArm}
          onMsg={flash}
          needBoxes={doc.source === 'upload' && model.traced === 0}
          onRemoveHotspot={removeHotspot}
          customArm={customArm}
          onStartCustom={startCustom}
          onEditField={(key) => {
            setPinned(key);
            document.getElementById(`field-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            window.setTimeout(() => {
              const el = document.getElementById(`field-${key}`)?.querySelector('textarea');
              el?.focus();
            }, 260);
          }}
        />

        <section className="console" aria-label="核对字段">
          <header className="console-head">
            <p className="eyebrow mono">
              {doc.source === 'fixture' ? (
                <>
                  {doc.styleTag}
                  <span className="sep">/</span>
                  示例海报
                </>
              ) : (
                <>你上传的这张海报 · 没有人替你填过</>
              )}
              {doc.confirmed && <span className="stamp">已确认</span>}
            </p>
            <h2>{model.title}</h2>
            {model.subtitle && <p className="sub">{model.subtitle}</p>}

            <div className="tally">
              <span className={model.errors ? 't-err' : 't-zero'}>{model.errors} 个必须处理</span>
              <span className={model.warns ? 't-warn' : 't-zero'}>{model.warns} 个建议核对</span>
              <span className="t-info">{infos} 条说明</span>
              <span className="t-src mono">
                {model.traced}/{model.filled} 项可回到原图
              </span>
            </div>
          </header>

          {doc.source === 'upload' && model.filled === 0 && (
            <section className="upload-guide" aria-label="这张要你自己圈">
              <p className="upload-guide-kicker mono">这张海报我没有替你识别</p>
              <p className="upload-guide-body">
                默认不进任何模型，所以字段是空的——不是坏了。两条路你挑一条：<b>用模型先读一遍</b>（下面那张卡，读到的每一项都会标「模型读的」，核过才算数），或者自己圈——
                <b>①</b> 点某一项右边的「框出原文」<b>②</b> 在海报上圈住那段字
                <b>③</b> 照着圈里的字打进去。系统只负责记住「这条信息来自图上的哪一块」。
              </p>
              <div className="upload-guide-actions">
                <button type="button" className="guide-start" onClick={startGuided}>
                  从「活动名称」开始，带我一项一项圈
                </button>
                <span className="guide-alt mono">或者自己挑一行点「框出原文」</span>
              </div>
            </section>
          )}

          {vision?.ok && doc.source === 'upload' && (
            <section className="vision-card" aria-label="让模型先读一遍">
              <h3>
                让机器先抄一遍（可选）
                {isMockModel(vision.model || '') && <span className="vision-mock mono">模拟数据</span>}
              </h3>
              <p>
                两条路，都只解决「打中文慢」：<b>本机 OCR 免费、离线</b>，把整页字抄成一行一条；
                {vision?.ok
                  ? '云端模型还能顺手给字段和位置，但要花钱、要联网。'
                  : '云端模型现在是关着的。'}
                位置一律你圈——框和字两边都对得上才算数。
              </p>
              <div className="vision-buttons">
                <button type="button" className="vision-run" onClick={runLocal} disabled={ocrBusy || visionBusy}>
                  {ocrBusy
                    ? ocrProgress !== null
                      ? `本机认字中 ${Math.round(ocrProgress * 100)}%`
                      : '本机认字中…'
                    : '用本机 OCR 抄字（免费 · 离线）'}
                </button>
                {vision?.ok && (
                  <button type="button" className="vision-run is-ghost" onClick={runVision} disabled={visionBusy || ocrBusy}>
                    {visionBusy ? '模型正在看…' : `用 ${vision.model || '视觉模型'} 读一遍`}
                  </button>
                )}
              </div>
              {visionMsg && <p className="vision-status">{visionMsg}</p>}
              {visionLines && visionLines.length > 0 && (
                <div className="vision-lines">
                  <div className="vision-lines-head mono">
                    <span>它抄下来的 {visionLines.length} 行</span>
                    <button
                      type="button"
                      className="vision-copy-all"
                      onClick={async () => {
                        const ok = await copyText(visionLines.join('\n'));
                        flash(ok ? '整页文字已复制' : '复制没成功，手动选一下');
                      }}
                    >
                      整页复制
                    </button>
                  </div>
                  <ol>
                    {visionLines.map((line, i) => (
                      <li key={`${i}-${line.slice(0, 8)}`}>
                        <button
                          type="button"
                          className="vision-line"
                          onClick={async () => {
                            const ok = await copyText(line);
                            flash(ok ? `已复制：${line.slice(0, 18)}${line.length > 18 ? '…' : ''}` : '复制没成功，手动选一下');
                          }}
                        >
                          {line}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}

          <CheckupPanel doc={doc} model={model} onJump={(key) => jumpTo({ field: key })} />

          <IssueList issues={model.issues} onJump={jumpTo} />

          <div className="fields-head">
            <h3>十项信息</h3>
            <p>照海报原样抄。看不清就标出来，不要替海报补内容。</p>
          </div>

          <ul className="fields">
            {FIELD_ORDER.map((key, i) => {
              const f = doc.fields.find((x) => x.key === key);
              if (!f) return null;
              return (
                <FieldItem
                  key={key}
                  field={f}
                  index={i}
                  isActive={pinned === key || hovered === key}
                  isArming={armField === key}
                  canAnnotate={doc.source === 'upload'}
                  onChange={update}
                  onFocusField={(k) => k && setPinned(k)}
                  onHover={setHovered}
                  onLocate={(k) => locate(k, true)}
                  onUndo={undo}
                  onArm={arm}
                  onConfidence={setConfidence}
                  registerRef={registerRef}
                />
              );
            })}
          </ul>

          <div className="console-notes">
            <p className="foot-note">
              确认只代表你看过这张海报，不代表信息一定对。每一行右边的小字是「这一项是怎么来的」：
              <span className="k">原图</span>能点回去，<span className="k">无出处</span>是你自己填的。
            </p>
            <p className="foot-stat mono">
              {stats.count > 0
                ? `本机已记录 ${stats.count} 次核对 · 平均 ${Math.round(stats.avgMs / 1000)} 秒 · 平均改 ${stats.avgEdits.toFixed(1)} 处`
                : '还没确认过任何一版。确认后这里会开始记录耗时和改动量，用来跟手工整理做对比。'}
            </p>
            <p className="foot-next mono">
              下一步：点「生成活动页」，同一份信息会排成四种读法，并能加日历、导航、扫码分享。
            </p>
            <p className="foot-warn mono">
              现在只有 {FIELD_META.when.short}、{FIELD_META.venue.short} 这类必填项会挡路；其余留空也能确认。
            </p>
          </div>

          <footer className="console-foot">
            <button
              type="button"
              className="to-page"
              onClick={() => setScreen('action')}
              disabled={model.filled === 0 && (doc.hotspots?.length ?? 0) === 0}
            >
              发出去 →
              <span className="mono">活海报 · 大字版 · 简明版 · 结构化</span>
            </button>
            <button
              type="button"
              className={`confirm ${armed ? 'is-armed' : ''}`}
              onClick={confirm}
              disabled={model.filled === 0}
            >
              {openIssueCount === 0
                ? '确认这一版信息'
                : armed
                  ? `仍然确认（跳过 ${openIssueCount} 个问题）`
                  : `确认（还有 ${openIssueCount} 个问题）`}
            </button>
            <p className="foot-tip mono">
              {model.errors + model.warns === 0 ? '没有待处理的问题' : `${model.errors} 错 · ${model.warns} 警 待处理`}
              <span className="sep">·</span>
              {edits} 处改动
              <span className="sep">·</span>
              {doc.confirmed ? '已确认' : '未确认'}
            </p>
          </footer>
        </section>
      </main>
      )}

      {draft && doc.posterUrl && (
        <SpotEditor
          rect={draft}
          posterUrl={doc.posterUrl}
          posterW={doc.posterW}
          posterH={doc.posterH}
          onSave={saveHotspot}
          onCancel={() => setDraft(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { AppState, Carpet, DamageBox, Origin, Rect } from "./types";
import {
  ORIGINS,
  advanceStep,
  findOverlaps,
  loadState,
  lowStockCards,
  makeSteps,
  progressOf,
  recallByMove,
  releaseCarpet,
  releasedUsage,
  remainingOf,
  saveState,
  uid,
  validateRelease,
} from "./lib";
import PatternStage from "./PatternStage";
import BoxPanel from "./BoxPanel";

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [originFilter, setOriginFilter] = useState<Origin | "全部">("全部");
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const r = saveState(state);
    setStorageError(!r.ok);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const usage = useMemo(() => releasedUsage(state, ""), [state]);
  const reviewQueue = useMemo(
    () => state.carpets.filter((c) => c.status === "review"),
    [state.carpets]
  );
  const releasedCount = state.carpets.length - reviewQueue.length;

  const progress = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const c of state.carpets) {
      const p = progressOf(c);
      done += p.done;
      total += p.total;
    }
    return { done, total };
  }, [state.carpets]);

  const lows = useMemo(() => lowStockCards(state), [state]);
  const visible = state.carpets.filter(
    (c) => originFilter === "全部" || c.origin === originFilter
  );

  function updateCarpet(id: string, fn: (c: Carpet) => Carpet) {
    setState((s) => ({
      ...s,
      carpets: s.carpets.map((c) => (c.id === id ? fn(c) : c)),
    }));
  }

  function updateBox(carpetId: string, boxId: string, fn: (b: DamageBox) => DamageBox) {
    updateCarpet(carpetId, (c) => ({
      ...c,
      boxes: c.boxes.map((b) => (b.id === boxId ? fn(b) : b)),
    }));
  }

  function handleDraw(carpet: Carpet, rect: Rect) {
    const code = state.cards[0]?.code ?? "";
    const box: DamageBox = {
      id: uid("box"),
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      colorCode: code,
      prePhoto: null,
      postPhoto: null,
      steps: makeSteps(),
    };
    updateCarpet(carpet.id, (c) => ({ ...c, boxes: [...c.boxes, box] }));
    setSelected((m) => ({ ...m, [carpet.id]: box.id }));
  }

  function handleCommitGeometry(carpet: Carpet, boxId: string, rect: Rect) {
    if (carpet.status === "released") {
      updateCarpet(carpet.id, (c) => recallByMove(c, boxId));
      setToast(
        `${carpet.id}：破损框已移动，该框及后续工序失效，档案退回复核，色卡余量与队列恢复`
      );
      return;
    }
    updateBox(carpet.id, boxId, (b) => ({ ...b, ...rect }));
  }

  function handleRelease(carpet: Carpet) {
    const reasons = validateRelease(state, carpet);
    if (reasons.length > 0) {
      setToast(`${carpet.id} 不能放行：${reasons[0].text}（共 ${reasons.length} 项）`);
      return;
    }
    updateCarpet(carpet.id, (c) => releaseCarpet(c));
    setToast(`${carpet.id} 已放行，色卡余量按破损框占用，工序进度已启动`);
  }

  function handleAddCarpet(origin: Origin) {
    const maxNo = state.carpets.reduce((m, c) => {
      const n = Number(c.id.replace("CAR-", ""));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 90);
    const carpet: Carpet = {
      id: `CAR-${maxNo + 1}`,
      origin,
      era: "",
      knot: "",
      material: "",
      dye: "",
      seed: Math.floor(Math.random() * 1e9),
      status: "review",
      everReleased: false,
      releasedAt: null,
      boxes: [],
    };
    setState((s) => ({ ...s, carpets: [...s.carpets, carpet] }));
    setOriginFilter("全部");
    setToast(`已建档 ${carpet.id}，进入放行队列末尾等待标记`);
  }

  function resetDemo() {
    localStorage.removeItem("rug-release-console:v1");
    setState(loadState());
    setSelected({});
    setToast("已恢复演示数据");
  }

  const rate =
    state.carpets.length === 0
      ? 0
      : Math.round((releasedCount / state.carpets.length) * 100);

  return (
    <main className="app">
      <section className="hero">
        <p>纹样标记放行台 · hxyfront-62009 · 数据仅存本机浏览器</p>
        <h1>地毯修复纹样标记放行台</h1>
        <span>
          每张地毯在纹样图上标出破损框，登记框坐标、补线色号与施工前照片后方可申请放行。
          同毯破损框相交、色号不在材料色卡或照片缺失时整张档案不能放行；已放行后移动任一破损框，
          该框及后续工序失效并退回复核，施工前后照片只读留档。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>放行队列（待复核）</small>
          <strong>{reviewQueue.length}</strong>
        </article>
        <article>
          <small>已放行档案</small>
          <strong>
            {releasedCount}
            <em> / {state.carpets.length}</em>
          </strong>
        </article>
        <article>
          <small>工序进度</small>
          <strong>
            {progress.done}
            <em> / {progress.total}</em>
          </strong>
        </article>
        <article>
          <small>放行率 / 色卡预警</small>
          <strong>
            {rate}%<em> · {lows.length} 项告急</em>
          </strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel side">
          <h2>产地筛选</h2>
          <div className="chips">
            <button
              className={originFilter === "全部" ? "active" : ""}
              onClick={() => setOriginFilter("全部")}
            >
              全部
            </button>
            {ORIGINS.map((o) => (
              <button
                key={o}
                className={originFilter === o ? "active" : ""}
                onClick={() => setOriginFilter(o)}
              >
                {o}
              </button>
            ))}
          </div>

          <h2 className="side-h2">放行队列</h2>
          <ol className="queue">
            {reviewQueue.map((c, i) => (
              <li key={c.id}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                <div>
                  <strong>{c.id}</strong>
                  <span>
                    {c.origin} · {c.boxes.length} 框
                  </span>
                </div>
              </li>
            ))}
            {reviewQueue.length === 0 && <li className="queue-empty">队列为空</li>}
          </ol>

          <h2 className="side-h2">新建档案</h2>
          <div className="chips">
            {ORIGINS.map((o) => (
              <button key={o} onClick={() => handleAddCarpet(o)}>
                ＋{o}
              </button>
            ))}
          </div>

          <button className="ghost reset" onClick={resetDemo}>
            恢复演示数据
          </button>
        </aside>

        <section className="panel cards-panel">
          <h2 className="side-h2">
            档案{originFilter !== "全部" ? ` · ${originFilter}` : ""}（{visible.length}）
          </h2>
          <div className="carpet-list">
            {visible.map((carpet) => (
              <CarpetCard
                key={carpet.id}
                state={state}
                carpet={carpet}
                selectedBoxId={selected[carpet.id] ?? null}
                onSelectBox={(id) =>
                  setSelected((m) => ({ ...m, [carpet.id]: id }))
                }
                onDrawBox={(r) => handleDraw(carpet, r)}
                onCommitGeometry={(id, r) => handleCommitGeometry(carpet, id, r)}
                onRelease={() => handleRelease(carpet)}
                onPatchBox={(boxId, patch) =>
                  updateBox(carpet.id, boxId, (b) => ({ ...b, ...patch }))
                }
                onPatchBoxGeometry={(boxId, patch) =>
                  updateBox(carpet.id, boxId, (b) => ({ ...b, ...patch }))
                }
                onDeleteBox={(boxId) =>
                  updateCarpet(carpet.id, (c) => ({
                    ...c,
                    boxes: c.boxes.filter((b) => b.id !== boxId),
                  }))
                }
                onAdvanceStep={(boxId, i) =>
                  updateBox(carpet.id, boxId, (b) => advanceStep(b, i))
                }
                onPhoto={(boxId, kind, url) =>
                  updateBox(carpet.id, boxId, (b) => ({ ...b, [kind]: url }))
                }
                onPatchMeta={(patch) => updateCarpet(carpet.id, (c) => ({ ...c, ...patch }))}
              />
            ))}
            {visible.length === 0 && <p className="empty-tip">该产地暂无档案。</p>}
          </div>
        </section>
      </section>

      <section className="panel palette-panel">
        <div className="heading">
          <div>
            <p>材料色卡</p>
            <h2>色号余量统计（放行占用实时同步）</h2>
          </div>
        </div>
        <div className="palette">
          {state.cards.map((card) => {
            const remain = remainingOf(card, usage[card.code] ?? 0);
            return (
              <article
                key={card.code}
                className={`pcard${remain <= 2 ? " low" : ""}`}
              >
                <i className="pcard-swatch" style={{ background: card.hex }} />
                <div>
                  <strong>
                    {card.code} · {card.name}
                  </strong>
                  <span>
                    余量 {remain} 份
                    <small>（库存 {card.stock} · 已占用 {usage[card.code] ?? 0}）</small>
                  </span>
                </div>
                {remain <= 2 && <em className="pcard-warn">告急</em>}
              </article>
            );
          })}
        </div>
      </section>

      <footer className="foot">
        {storageError && (
          <span className="storage-err">
            ⚠ 浏览器存储写入失败（可能空间不足），重开页面后无法恢复最新数据
          </span>
        )}
        所有标记、照片、色卡与工序数据仅保存在本浏览器 localStorage，重开页面自动恢复。
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

interface CarpetCardProps {
  state: AppState;
  carpet: Carpet;
  selectedBoxId: string | null;
  onSelectBox: (id: string | null) => void;
  onDrawBox: (r: Rect) => void;
  onCommitGeometry: (id: string, r: Rect) => void;
  onRelease: () => void;
  onPatchBox: (boxId: string, patch: Partial<DamageBox>) => void;
  onPatchBoxGeometry: (boxId: string, patch: Partial<DamageBox>) => void;
  onDeleteBox: (boxId: string) => void;
  onAdvanceStep: (boxId: string, stepIndex: number) => void;
  onPhoto: (boxId: string, kind: "prePhoto" | "postPhoto", url: string) => void;
  onPatchMeta: (patch: Partial<Carpet>) => void;
}

function CarpetCard({
  state,
  carpet,
  selectedBoxId,
  onSelectBox,
  onDrawBox,
  onCommitGeometry,
  onRelease,
  onPatchBox,
  onPatchBoxGeometry,
  onDeleteBox,
  onAdvanceStep,
  onPhoto,
  onPatchMeta,
}: CarpetCardProps) {
  const released = carpet.status === "released";
  const reasons = validateRelease(state, carpet);
  const overlapIds = findOverlaps(carpet.boxes);
  const p = progressOf(carpet);
  const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100);
  const colorOf = (code: string) =>
    state.cards.find((c) => c.code === code)?.hex;

  const metaFields: Array<["era" | "knot" | "material" | "dye", string]> = [
    ["era", "年代"],
    ["knot", "结密度"],
    ["material", "材质"],
    ["dye", "染色类型"],
  ];

  return (
    <article className={`carpet-card${released ? " is-released" : ""}`}>
      <header className="carpet-head">
        <div>
          <h3>
            {carpet.id}
            <span className={`status ${released ? "st-ok" : "st-wait"}`}>
              {released ? "已放行" : "待复核"}
            </span>
            {carpet.boxes.some((b) => b.steps.some((s) => s.status === "invalid")) && (
              <span className="status st-invalid">移动失效·复核中</span>
            )}
          </h3>
          <p>
            {carpet.origin}产地 · 破损框 {carpet.boxes.length} 个
            {released && carpet.releasedAt
              ? ` · 放行于 ${new Date(carpet.releasedAt).toLocaleString("zh-CN")}`
              : ""}
          </p>
        </div>
        <button
          className={released ? "ghost" : "primary"}
          disabled={released}
          onClick={onRelease}
          title={reasons.length > 0 ? reasons.map((r) => r.text).join("\n") : "校验通过"}
        >
          {released ? "已放行" : `申请放行${reasons.length > 0 ? `（${reasons.length} 项不通过）` : ""}`}
        </button>
      </header>

      <div className="meta-grid">
        {metaFields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              disabled={released}
              value={carpet[key]}
              placeholder={`填写${label}`}
              onChange={(e) => onPatchMeta({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      {!released && reasons.length > 0 && (
        <ul className="blockers">
          {reasons.map((r) => (
            <li key={r.text} data-kind={r.kind}>
              ✕ {r.text}
            </li>
          ))}
        </ul>
      )}
      {!released && reasons.length === 0 && carpet.boxes.length > 0 && (
        <p className="ok-note">✓ 相交、色卡、照片、余量校验均通过，可放行。</p>
      )}

      <PatternStage
        carpet={carpet}
        selectedBoxId={selectedBoxId}
        overlapIds={overlapIds}
        colorOf={colorOf}
        onSelectBox={onSelectBox}
        onDrawBox={onDrawBox}
        onCommitGeometry={onCommitGeometry}
      />

      <div className="progress-line">
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span>
          工序进度 {p.done}/{p.total}
        </span>
      </div>

      {carpet.boxes.length > 0 && (
        <div className="box-list">
          {carpet.boxes.map((box, i) => {
            const active = selectedBoxId === box.id;
            return (
              <div key={box.id} className="box-slot">
                <button
                  className={`box-tab${active ? " active" : ""}`}
                  onClick={() => onSelectBox(active ? null : box.id)}
                >
                  框 {i + 1} · {box.colorCode}
                  {!box.prePhoto && <em className="warn">缺前照</em>}
                  {overlapIds.has(box.id) && <em className="warn">相交</em>}
                  {!colorOf(box.colorCode) && <em className="warn">色卡无效</em>}
                </button>
                {active && (
                  <BoxPanel
                    carpet={carpet}
                    box={box}
                    index={i}
                    cards={state.cards}
                    onPatch={(patch) => onPatchBox(box.id, patch)}
                    onPatchGeometry={(patch) => onPatchBoxGeometry(box.id, patch)}
                    onDelete={() => onDeleteBox(box.id)}
                    onAdvanceStep={(step) => onAdvanceStep(box.id, step)}
                    onPhoto={(kind, url) => onPhoto(box.id, kind, url)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {carpet.boxes.length === 0 && (
        <p className="empty-tip">在纹样图空白处拖画，标出第一个破损框。</p>
      )}
    </article>
  );
}

import { useEffect, useRef, useState } from "react";
import "./styles.css";
import PatternCanvas from "./PatternCanvas";
import {
  CANVAS_H,
  CANVAS_W,
  ORIGINS,
  STEP_NAMES,
  STORAGE_KEY,
  boxLabel,
  carpetProgress,
  carpetStatusText,
  clamp,
  invalidateFrom,
  loadState,
  releaseCarpet,
  saveState,
  seedState,
  validateCarpet,
} from "./model";
import type { AppState, Carpet, DamageBox } from "./model";

const project = {
  id: "hxyfront-62009",
  sourceNo: 2,
  port: 62009,
};

interface Notice {
  carpetId: string;
  kind: "blocked" | "released" | "invalidated";
  text: string;
}

/** 照片压缩为 dataURL，避免撑爆 localStorage */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 360;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<{ boxId: string; kind: "pre" | "post" } | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const filtered = state.carpets.filter(
    (c) => state.filter === "全部" || c.origin === state.filter
  );
  const selected =
    state.carpets.find((c) => c.id === state.selectedId) ?? state.carpets[0];
  const validation = validateCarpet(selected, state.palette);
  const progress = carpetProgress(selected);
  const doneSteps = selected.boxes.reduce(
    (n, b) => n + b.steps.filter((s) => s.done).length,
    0
  );
  const totalSteps = selected.boxes.length * STEP_NAMES.length;

  // ---------- 指标（随产地筛选同步） ----------
  const pendingCount = filtered.filter((c) => carpetProgress(c) < 1).length;
  const avgProgress =
    filtered.length === 0
      ? 0
      : filtered.reduce((n, c) => n + carpetProgress(c), 0) / filtered.length;
  const metrics = [
    { label: "待修复", value: String(pendingCount) },
    { label: "纹样档案", value: String(filtered.length) },
    { label: "色卡数量", value: String(state.palette.length) },
    { label: "完工率", value: `${Math.round(avgProgress * 100)}%` },
  ];

  // ---------- 状态更新 ----------
  const patchCarpet = (id: string, fn: (c: Carpet) => Carpet) =>
    setState((s) => ({
      ...s,
      carpets: s.carpets.map((c) => (c.id === id ? fn(c) : c)),
    }));

  const patchBox = (boxId: string, fn: (b: DamageBox) => DamageBox) =>
    patchCarpet(selected.id, (c) => ({
      ...c,
      boxes: c.boxes.map((b) => (b.id === boxId ? fn(b) : b)),
    }));

  /** 几何变更：已放行档案移动破损框 → 该框及后续工序失效并退回复核 */
  const moveBox = (boxId: string, x: number, y: number, w?: number, h?: number) => {
    const carpet = state.carpets.find((c) => c.id === selected.id);
    if (!carpet) return;
    const idx = carpet.boxes.findIndex((b) => b.id === boxId);
    if (idx < 0) return;
    const box = carpet.boxes[idx];
    const nw = clamp(Math.round(w ?? box.w), 16, CANVAS_W);
    const nh = clamp(Math.round(h ?? box.h), 16, CANVAS_H);
    const nx = clamp(Math.round(x), 0, CANVAS_W - nw);
    const ny = clamp(Math.round(y), 0, CANVAS_H - nh);
    if (nx === box.x && ny === box.y && nw === box.w && nh === box.h) return;

    let carpets = state.carpets.map((c) =>
      c.id === carpet.id
        ? {
            ...c,
            boxes: c.boxes.map((b) =>
              b.id === boxId ? { ...b, x: nx, y: ny, w: nw, h: nh } : b
            ),
          }
        : c
    );
    let palette = state.palette;

    if (carpet.status === "released") {
      const moved = carpets.find((c) => c.id === carpet.id)!;
      const res = invalidateFrom(moved, idx, palette);
      carpets = carpets.map((c) => (c.id === carpet.id ? res.carpet : c));
      palette = res.palette;
      setNotice({
        carpetId: carpet.id,
        kind: "invalidated",
        text: `${boxLabel(idx)}被移动：该框及后续工序已失效，档案退回复核；施工前后照片只读留档。`,
      });
    }
    setState((s) => ({ ...s, carpets, palette }));
  };

  /** 放行：校验不过则拦截，队列、色卡余量与工序进度均不变 */
  const onRelease = () => {
    const v = validateCarpet(selected, state.palette);
    if (!v.ok) {
      setNotice({
        carpetId: selected.id,
        kind: "blocked",
        text: "放行已拦截：存在未通过的复核项，原队列、色卡余量与工序进度均未变动。",
      });
      return;
    }
    const res = releaseCarpet(selected, state.palette);
    setState((s) => ({
      ...s,
      carpets: s.carpets.map((c) => (c.id === selected.id ? res.carpet : c)),
      palette: res.palette,
    }));
    setNotice({
      carpetId: selected.id,
      kind: "released",
      text: "档案已放行：色卡余量已扣减，可登记各框工序与施工后照片。",
    });
  };

  const toggleStep = (boxId: string, stepIdx: number) => {
    if (selected.status !== "released") return;
    patchBox(boxId, (b) =>
      b.invalidated
        ? b
        : {
            ...b,
            steps: b.steps.map((s, i) =>
              i === stepIdx ? { ...s, done: !s.done } : s
            ),
          }
    );
  };

  const addBox = () => {
    if (selected.everReleased) return;
    const n = selected.boxes.length;
    const box: DamageBox = {
      id: `${selected.id}-b${Date.now().toString(36)}`,
      x: 40 + ((n * 34) % 220),
      y: 42 + ((n * 28) % 150),
      w: 84,
      h: 62,
      colorCode: state.palette[0]?.code ?? "",
      prePhoto: null,
      postPhoto: null,
      steps: STEP_NAMES.map((name) => ({ name, done: false })),
      invalidated: false,
      stockDeducted: false,
    };
    patchCarpet(selected.id, (c) => ({ ...c, boxes: [...c.boxes, box] }));
    setActiveBoxId(box.id);
  };

  const removeBox = (boxId: string) => {
    if (selected.everReleased) return;
    patchCarpet(selected.id, (c) => ({
      ...c,
      boxes: c.boxes.filter((b) => b.id !== boxId),
    }));
    if (activeBoxId === boxId) setActiveBoxId(null);
  };

  const pickPhoto = (boxId: string, kind: "pre" | "post") => {
    photoTargetRef.current = { boxId, kind };
    photoInputRef.current?.click();
  };

  const onPhotoChosen = async (file: File | undefined) => {
    const target = photoTargetRef.current;
    if (!file || !target) return;
    const url = await fileToDataUrl(file);
    patchBox(target.boxId, (b) =>
      target.kind === "pre" ? { ...b, prePhoto: url } : { ...b, postPhoto: url }
    );
  };

  const resetAll = () => {
    localStorage.removeItem(STORAGE_KEY);
    setNotice(null);
    setActiveBoxId(null);
    setState(seedState());
  };

  const selectCarpet = (id: string) => {
    setState((s) => ({ ...s, selectedId: id }));
    setActiveBoxId(null);
  };

  const noticeForSelected = notice && notice.carpetId === selected.id ? notice : null;

  return (
    <main className="app">
      <section className="hero">
        <p>
          {project.id} · 源提示词{project.sourceNo} · Port {project.port}
        </p>
        <h1>地毯修复纹样档案 · 纹样标记放行台</h1>
        <span>
          在纹样图上为每张地毯标出破损框，登记框坐标、补线色号与施工前照片。
          同毯破损框相交、色号不在材料色卡或照片缺失时，整张档案不能放行，原队列、
          色卡余量与工序进度保持不变；已放行档案移动任一破损框，该框及后续工序失效并退回复核，
          施工前后照片只读留档。数据仅保存于本浏览器，重开页面自动恢复。
        </span>
        <div className="hero-actions">
          <small>本地存储：{STORAGE_KEY}</small>
          <button type="button" onClick={resetAll}>
            重置示例数据
          </button>
        </div>
      </section>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel side">
          <h2>产地筛选</h2>
          <div className="chips">
            {["全部", ...ORIGINS].map((origin) => (
              <button
                key={origin}
                className={state.filter === origin ? "chip active" : "chip"}
                onClick={() => setState((s) => ({ ...s, filter: origin }))}
              >
                {origin}
              </button>
            ))}
          </div>

          <h2 className="queue-title">档案队列</h2>
          <div className="queue">
            {filtered.length === 0 && <p className="empty">该产地暂无档案</p>}
            {filtered.map((c) => {
              const p = carpetProgress(c);
              const status = carpetStatusText(c);
              return (
                <button
                  key={c.id}
                  className={
                    c.id === selected.id ? "queue-card selected" : "queue-card"
                  }
                  onClick={() => selectCarpet(c.id)}
                >
                  <span className="queue-head">
                    <b>{c.id}</b>
                    <i className={`badge ${c.status === "released" ? "ok" : c.everReleased ? "warn" : ""}`}>
                      {status}
                    </i>
                  </span>
                  <span className="queue-meta">
                    {c.origin} · {c.material} · {c.era}
                  </span>
                  <span className="queue-note">{c.damageNote}</span>
                  <span className="bar">
                    <span style={{ width: `${Math.round(p * 100)}%` }} />
                  </span>
                  <span className="queue-meta">
                    破损框 {c.boxes.length} · 工序 {Math.round(p * 100)}%
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel detail">
          <div className="heading">
            <div>
              <p>纹样档案</p>
              <h2>
                {selected.id}
                <i
                  className={`badge ${
                    selected.status === "released"
                      ? "ok"
                      : selected.everReleased
                      ? "warn"
                      : ""
                  }`}
                >
                  {carpetStatusText(selected)}
                </i>
              </h2>
            </div>
            <div className="progress-box">
              <small>
                工序进度 {doneSteps}/{totalSteps} · {Math.round(progress * 100)}%
              </small>
              <span className="bar">
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
            </div>
          </div>

          <dl className="meta-grid">
            <div><dt>地毯产地</dt><dd>{selected.origin}</dd></div>
            <div><dt>年代</dt><dd>{selected.era}</dd></div>
            <div><dt>结密度</dt><dd>{selected.knot}</dd></div>
            <div><dt>材质</dt><dd>{selected.material}</dd></div>
            <div><dt>染色类型</dt><dd>{selected.dye}</dd></div>
            <div><dt>破损区域</dt><dd>{selected.damageNote}</dd></div>
          </dl>

          {noticeForSelected && (
            <div className={`notice ${noticeForSelected.kind}`}>
              {noticeForSelected.text}
            </div>
          )}

          {selected.status === "review" ? (
            <div className="review-panel">
              <h3>复核清单</h3>
              <ul className="checks">
                <li className={validation.pairs.length === 0 ? "pass" : "fail"}>
                  破损框相交：
                  {validation.pairs.length === 0
                    ? "无"
                    : validation.pairs.map((p) => p.join("×")).join("、")}
                </li>
                <li className={validation.badColors.length === 0 ? "pass" : "fail"}>
                  补线色号在材料色卡：
                  {validation.badColors.length === 0
                    ? "全部在册"
                    : `未登记 ${validation.badColors.join("、")}`}
                </li>
                <li className={validation.missingPhotos.length === 0 ? "pass" : "fail"}>
                  施工前照片：
                  {validation.missingPhotos.length === 0
                    ? "齐全"
                    : `缺失 ${validation.missingPhotos.join("、")}`}
                </li>
                <li className={validation.shortStock.length === 0 ? "pass" : "fail"}>
                  色卡余量：
                  {validation.shortStock.length === 0
                    ? "充足"
                    : `不足 ${validation.shortStock.join("、")}`}
                </li>
              </ul>
              <button type="button" className="primary release" onClick={onRelease}>
                放行档案
              </button>
            </div>
          ) : (
            <div className="notice released-info">
              已放行：可登记各框工序与施工后照片。移动任一破损框，该框及后续工序失效并退回复核。
            </div>
          )}

          <h3 className="section-title">纹样标记图</h3>
          <PatternCanvas
            carpet={selected}
            palette={state.palette}
            activeBoxId={activeBoxId}
            onSelectBox={(id) => {
              setActiveBoxId(id);
              document
                .getElementById(`box-${id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            onMoveBox={(boxId, x, y) => moveBox(boxId, x, y)}
          />
          <p className="legend">
            拖动可移动破损框 · 实线=色号在册 · 红框=相交或色号未登记 · 灰虚线=已失效待复核
          </p>

          <div className="heading boxes-heading">
            <div>
              <p>破损登记</p>
              <h3>破损框 {selected.boxes.length} 个</h3>
            </div>
            {!selected.everReleased && (
              <button type="button" onClick={addBox}>
                新增破损框
              </button>
            )}
          </div>

          <div className="boxes">
            {selected.boxes.length === 0 && (
              <p className="empty">尚未标出破损框，点击“新增破损框”开始登记。</p>
            )}
            {selected.boxes.map((box, i) => {
              const known = state.palette.some((p) => p.code === box.colorCode);
              const preLocked = selected.everReleased;
              const postEditable =
                selected.status === "released" && !box.postPhoto;
              return (
                <article
                  key={box.id}
                  id={`box-${box.id}`}
                  className={`box-card ${activeBoxId === box.id ? "active" : ""} ${
                    box.invalidated ? "invalid" : ""
                  }`}
                  onClick={() => setActiveBoxId(box.id)}
                >
                  <header>
                    <b>
                      {boxLabel(i)}
                      {box.invalidated && <i className="badge danger">已失效</i>}
                    </b>
                    {!selected.everReleased && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBox(box.id);
                        }}
                      >
                        删除
                      </button>
                    )}
                  </header>

                  <div className="coords">
                    {(
                      [
                        ["X", box.x, (v: number) => moveBox(box.id, v, box.y)],
                        ["Y", box.y, (v: number) => moveBox(box.id, box.x, v)],
                        ["宽", box.w, (v: number) => moveBox(box.id, box.x, box.y, v, box.h)],
                        ["高", box.h, (v: number) => moveBox(box.id, box.x, box.y, box.w, v)],
                      ] as const
                    ).map(([label, value, apply]) => (
                      <label key={label}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={label === "X" || label === "宽" ? CANVAS_W : CANVAS_H}
                          value={value}
                          onChange={(e) => apply(Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>

                  <label className="color-field">
                    <span>补线色号</span>
                    <select
                      value={box.colorCode}
                      disabled={selected.status === "released"}
                      className={known ? "" : "invalid"}
                      onChange={(e) =>
                        patchBox(box.id, (b) => ({ ...b, colorCode: e.target.value }))
                      }
                    >
                      {!known && (
                        <option value={box.colorCode}>
                          {box.colorCode}（未登记）
                        </option>
                      )}
                      {state.palette.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code} · {p.name}（余量 {p.stock}）
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="photos">
                    <figure>
                      {box.prePhoto ? (
                        <img src={box.prePhoto} alt={`${boxLabel(i)} 施工前照片`} />
                      ) : (
                        <div className="photo-missing">施工前照片缺失</div>
                      )}
                      <figcaption>
                        施工前
                        {!preLocked ? (
                          <button
                            type="button"
                            className="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              pickPhoto(box.id, "pre");
                            }}
                          >
                            {box.prePhoto ? "替换" : "上传"}
                          </button>
                        ) : (
                          <em>只读留档</em>
                        )}
                      </figcaption>
                    </figure>
                    <figure>
                      {box.postPhoto ? (
                        <img src={box.postPhoto} alt={`${boxLabel(i)} 施工后照片`} />
                      ) : (
                        <div className="photo-missing muted">施工后未留档</div>
                      )}
                      <figcaption>
                        施工后
                        {postEditable ? (
                          <button
                            type="button"
                            className="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              pickPhoto(box.id, "post");
                            }}
                          >
                            上传
                          </button>
                        ) : (
                          <em>只读留档</em>
                        )}
                      </figcaption>
                    </figure>
                  </div>

                  <div className="steps">
                    <span>工序</span>
                    {box.steps.map((step, si) => (
                      <button
                        key={step.name}
                        type="button"
                        className={`step ${step.done ? "done" : ""} ${
                          box.invalidated ? "void" : ""
                        }`}
                        disabled={selected.status !== "released" || box.invalidated}
                        title={
                          selected.status !== "released"
                            ? "放行后可登记工序"
                            : box.invalidated
                            ? "已失效，待重新放行"
                            : step.done
                            ? "点击取消完成"
                            : "点击标记完成"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStep(box.id, si);
                        }}
                      >
                        {step.done ? "✓ " : ""}
                        {step.name}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="panel side">
          <h2>材料色卡</h2>
          <div className="palette">
            {state.palette.map((p) => {
              const used = filtered.reduce(
                (n, c) =>
                  n + c.boxes.filter((b) => b.colorCode === p.code).length,
                0
              );
              return (
                <div key={p.code} className="swatch-row">
                  <i style={{ background: p.hex }} />
                  <div>
                    <b>
                      {p.name} <code>{p.code}</code>
                    </b>
                    <span className="bar slim">
                      <span
                        style={{
                          width: `${Math.min(100, p.stock * 12)}%`,
                          background: p.hex,
                        }}
                      />
                    </span>
                  </div>
                  <em className={p.stock === 0 ? "out" : ""}>余量 {p.stock}</em>
                  <small>在档使用 {used}</small>
                </div>
              );
            })}
          </div>
          <p className="legend">
            放行时按破损框扣减余量；失效退回时返还该框及后续框余量。统计随产地筛选同步。
          </p>
        </aside>
      </section>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onPhotoChosen(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </main>
  );
}

export default App;

import { useRef } from "react";
import type { Carpet, ColorCard, DamageBox } from "./types";
import { fileToDataUrl } from "./photo";

interface BoxPanelProps {
  carpet: Carpet;
  box: DamageBox;
  index: number;
  cards: ColorCard[];
  onPatch: (patch: Partial<DamageBox>) => void;
  onPatchGeometry: (patch: Partial<DamageBox>) => void;
  onDelete: () => void;
  onAdvanceStep: (stepIndex: number) => void;
  onPhoto: (kind: "prePhoto" | "postPhoto", dataUrl: string) => void;
}

export default function BoxPanel({
  carpet,
  box,
  index,
  cards,
  onPatch,
  onPatchGeometry,
  onDelete,
  onAdvanceStep,
  onPhoto,
}: BoxPanelProps) {
  const preInput = useRef<HTMLInputElement>(null);
  const postInput = useRef<HTMLInputElement>(null);
  const released = carpet.status === "released";
  const geometryLocked = released;
  const preLocked = carpet.everReleased;
  const metaLocked = released;
  const codeValid = cards.some((c) => c.code === box.colorCode);

  async function handleFile(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "prePhoto" | "postPhoto"
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      onPhoto(kind, url);
    } catch {
      // 压缩失败时忽略
    }
  }

  const coordFields: Array<["x" | "y" | "w" | "h", string]> = [
    ["x", "X%"],
    ["y", "Y%"],
    ["w", "宽%"],
    ["h", "高%"],
  ];

  return (
    <article className="box-panel">
      <header className="box-head">
        <h4>
          破损框 {index + 1}
          {box.steps.some((s) => s.status === "invalid") && (
            <span className="tag tag-invalid">工序失效·待复核</span>
          )}
        </h4>
        {!carpet.everReleased && (
          <button className="link-danger" onClick={onDelete}>
            删除框
          </button>
        )}
      </header>

      <div className="box-coords">
        <span className="row-label">框坐标（相对纹样图 %）</span>
        <div className="coord-grid">
          {coordFields.map(([key, label]) => (
            <label key={key} className="coord">
              <span>{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                disabled={geometryLocked}
                value={Math.round(box[key] * 10) / 10}
                onChange={(e) =>
                  onPatchGeometry({
                    [key]: Math.min(100, Math.max(0, Number(e.target.value))),
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <label className="color-line">
        <span>补线色号</span>
        <select
          value={codeValid ? box.colorCode : ""}
          disabled={metaLocked}
          onChange={(e) => onPatch({ colorCode: e.target.value })}
          className={codeValid ? "" : "bad-input"}
        >
          {!codeValid && <option value="">（色号 {box.colorCode} 不在色卡）</option>}
          {cards.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
        {codeValid && (
          <i
            className="swatch"
            style={{
              background: cards.find((c) => c.code === box.colorCode)?.hex,
            }}
          />
        )}
      </label>

      <div className="photo-row">
        <PhotoCell
          title="施工前照片"
          url={box.prePhoto}
          allowUpload={!preLocked}
          missing={!box.prePhoto}
          inputRef={preInput}
          onPick={() => preInput.current?.click()}
        />
        <PhotoCell
          title="施工后照片"
          url={box.postPhoto}
          allowUpload={released}
          uploadHint="放行后上传"
          missing={!box.postPhoto}
          inputRef={postInput}
          onPick={() => postInput.current?.click()}
        />
        <input
          ref={preInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e, "prePhoto")}
        />
        <input
          ref={postInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e, "postPhoto")}
        />
      </div>

      <div className="steps">
        <span className="row-label">修复工序</span>
        <ol>
          {box.steps.map((step, i) => (
            <li key={step.name}>
              <button
                className={`step step-${step.status}`}
                disabled={!released}
                title={
                  released
                    ? step.status === "done"
                      ? "点击撤销完成"
                      : "按顺序推进工序"
                    : "档案退回复核后工序锁定，重新放行后恢复"
                }
                onClick={() => onAdvanceStep(i)}
              >
                <i>{i + 1}</i>
                {step.name}
                <small>
                  {step.status === "done"
                    ? "已完成"
                    : step.status === "invalid"
                    ? "已失效"
                    : "待施工"}
                </small>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

interface PhotoCellProps {
  title: string;
  url: string | null;
  allowUpload: boolean;
  uploadHint?: string;
  missing?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
}

function PhotoCell({ title, url, allowUpload, uploadHint, missing, onPick }: PhotoCellProps) {
  return (
    <div className={`photo-cell${missing ? " is-missing" : ""}`}>
      <span className="photo-title">
        {title}
        {url && <em className="lock">只读留档</em>}
      </span>
      {url ? (
        <a className="photo-thumb" href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={title} />
        </a>
      ) : (
        <button
          type="button"
          className="photo-empty"
          disabled={!allowUpload}
          onClick={onPick}
        >
          {allowUpload ? "上传照片" : uploadHint ?? "照片缺失"}
        </button>
      )}
    </div>
  );
}

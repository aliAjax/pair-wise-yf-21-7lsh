import { useRef, useState } from "react";
import type { Carpet, Rect } from "./types";
import { motifDataUrl } from "./lib";

interface Gesture {
  mode: "draw" | "move" | "resize";
  boxId?: string;
  startClientX: number;
  startClientY: number;
  origin?: Rect;
  draft: Rect;
  changed: boolean;
}

interface PatternStageProps {
  carpet: Carpet;
  selectedBoxId: string | null;
  overlapIds: Set<string>;
  colorOf: (code: string) => string | undefined;
  onSelectBox: (id: string | null) => void;
  onDrawBox: (rect: Rect) => void;
  onCommitGeometry: (id: string, rect: Rect) => void;
}

const MIN_SIZE = 1.5;

export default function PatternStage({
  carpet,
  selectedBoxId,
  overlapIds,
  colorOf,
  onSelectBox,
  onDrawBox,
  onCommitGeometry,
}: PatternStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const released = carpet.status === "released";

  function toPct(clientX: number, clientY: number) {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * 100,
      y: ((clientY - r.top) / r.height) * 100,
    };
  }

  function beginDraw(e: React.PointerEvent) {
    if (released || gesture) return;
    if (e.button !== undefined && e.button !== 0) return;
    const p = toPct(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setGesture({
      mode: "draw",
      startClientX: e.clientX,
      startClientY: e.clientY,
      draft: { x: p.x, y: p.y, w: 0, h: 0 },
      changed: false,
    });
  }

  function beginMove(e: React.PointerEvent, boxId: string) {
    if (gesture) return;
    e.stopPropagation();
    const box = carpet.boxes.find((b) => b.id === boxId);
    if (!box) return;
    const p = toPct(e.clientX, e.clientY);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setGesture({
      mode: "move",
      boxId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: { x: box.x, y: box.y, w: box.w, h: box.h },
      draft: { x: box.x, y: box.y, w: box.w, h: box.h },
      changed: false,
    });
    onSelectBox(boxId);
  }

  function beginResize(e: React.PointerEvent, boxId: string) {
    if (gesture) return;
    e.stopPropagation();
    const box = carpet.boxes.find((b) => b.id === boxId);
    if (!box) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setGesture({
      mode: "resize",
      boxId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: { x: box.x, y: box.y, w: box.w, h: box.h },
      draft: { x: box.x, y: box.y, w: box.w, h: box.h },
      changed: false,
    });
    onSelectBox(boxId);
  }

  function move(e: React.PointerEvent) {
    if (!gesture) return;
    const start = toPct(gesture.startClientX, gesture.startClientY);
    const now = toPct(e.clientX, e.clientY);
    const dx = now.x - start.x;
    const dy = now.y - start.y;
    const changed = gesture.changed || Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6;
    if (gesture.mode === "draw") {
      const o = toPct(gesture.startClientX, gesture.startClientY);
      setGesture({
        ...gesture,
        changed,
        draft: { x: o.x, y: o.y, w: now.x - o.x, h: now.y - o.y },
      });
    } else if (gesture.origin) {
      if (gesture.mode === "move") {
        setGesture({
          ...gesture,
          changed,
          draft: {
            ...gesture.origin,
            x: gesture.origin.x + dx,
            y: gesture.origin.y + dy,
          },
        });
      } else {
        setGesture({
          ...gesture,
          changed,
          draft: {
            ...gesture.origin,
            w: Math.max(MIN_SIZE, gesture.origin.w + dx),
            h: Math.max(MIN_SIZE, gesture.origin.h + dy),
          },
        });
      }
    }
  }

  function endGesture(e: React.PointerEvent) {
    if (!gesture) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const g = gesture;
    setGesture(null);
    if (!g.changed) {
      if (g.mode === "draw") onSelectBox(null);
      return;
    }
    if (g.mode === "draw") {
      const r = normalize(g.draft);
      if (r.w >= MIN_SIZE && r.h >= MIN_SIZE && !released) onDrawBox(r);
    } else if (g.boxId) {
      onCommitGeometry(g.boxId, normalize(g.draft));
    }
  }

  function normalize(r: Rect): Rect {
    const x = Math.min(r.x, r.x + r.w);
    const y = Math.min(r.y, r.y + r.h);
    const w = Math.abs(r.w);
    const h = Math.abs(r.h);
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return {
      x: clamp(x),
      y: clamp(y),
      w: Math.min(w, 100 - Math.max(0, x)),
      h: Math.min(h, 100 - Math.max(0, y)),
    };
  }

  return (
    <div
      ref={stageRef}
      className={`stage${released ? " is-released" : ""}`}
      onPointerDown={beginDraw}
      onPointerMove={move}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <img
        className="stage-bg"
        src={motifDataUrl(carpet.seed, carpet.origin)}
        alt={`${carpet.id} 纹样图`}
        draggable={false}
      />

      {carpet.boxes.map((box, i) => {
        const rect =
          gesture?.boxId === box.id ? gesture.draft : box;
        const overlap = overlapIds.has(box.id);
        const selected = selectedBoxId === box.id;
        const color = colorOf(box.colorCode);
        const invalid = box.steps.some((s) => s.status === "invalid");
        return (
          <div
            key={box.id}
            className={`dmg-box${overlap ? " is-overlap" : ""}${
              selected ? " is-selected" : ""
            }${invalid ? " is-invalid" : ""}`}
            style={{
              left: `${rect.x}%`,
              top: `${rect.y}%`,
              width: `${rect.w}%`,
              height: `${rect.h}%`,
              borderColor: overlap ? undefined : color,
            }}
            onPointerDown={(e) => beginMove(e, box.id)}
          >
            <span className="dmg-label">
              <b>{i + 1}</b>
              {box.colorCode}
              {!box.prePhoto && <em className="warn">缺照片</em>}
            </span>
            {!released && (
              <span
                className="dmg-resize"
                onPointerDown={(e) => beginResize(e, box.id)}
              />
            )}
          </div>
        );
      })}

      {gesture?.mode === "draw" && (
        <div
          className="dmg-box is-draft"
          style={{
            left: `${Math.min(gesture.draft.x, gesture.draft.x + gesture.draft.w)}%`,
            top: `${Math.min(gesture.draft.y, gesture.draft.y + gesture.draft.h)}%`,
            width: `${Math.abs(gesture.draft.w)}%`,
            height: `${Math.abs(gesture.draft.h)}%`,
          }}
        />
      )}

      <div className="stage-hint">
        {released
          ? "已放行：拖动破损框会令该框及后续工序失效并退回复核"
          : "在空白处按下拖动画出新破损框；拖动框体移动，拖右下角缩放"}
      </div>
    </div>
  );
}

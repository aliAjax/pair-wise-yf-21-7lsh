import { useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  CANVAS_H,
  CANVAS_W,
  boxesIntersect,
  boxLabel,
  clamp,
  hashSeed,
} from "./model";
import type { Carpet, PaletteColor } from "./model";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按档案编号确定性生成地毯纹样底图 */
function RugPattern({ seed }: { seed: string }) {
  const elements = useMemo(() => {
    const rand = mulberry32(hashSeed(seed));
    const tones = ["#7c2d12", "#b45309", "#0f766e", "#1e3a8a", "#92400e"];
    const pick = () => tones[Math.floor(rand() * tones.length)];
    const els: ReactNode[] = [];

    // 边框带与毯面
    els.push(<rect key="o" x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#401c0d" />);
    els.push(<rect key="b1" x={8} y={8} width={CANVAS_W - 16} height={CANVAS_H - 16} rx={4} fill="#7c2d12" />);
    els.push(<rect key="b2" x={18} y={18} width={CANVAS_W - 36} height={CANVAS_H - 36} fill="#b45309" />);
    els.push(
      <rect key="b3" x={22} y={22} width={CANVAS_W - 44} height={CANVAS_H - 44} fill="none"
        stroke="#f3e7d3" strokeWidth={1.4} strokeDasharray="8 5" opacity={0.7} />
    );
    els.push(<rect key="field" x={30} y={30} width={CANVAS_W - 60} height={CANVAS_H - 60} fill="#f3e7d3" />);

    // 菱格织纹
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 6; gx++) {
        const cx = 68 + gx * 53;
        const cy = 62 + gy * 46;
        const key = `m${gx}-${gy}`;
        els.push(
          <path key={key} d={`M${cx} ${cy - 15} L${cx + 19} ${cy} L${cx} ${cy + 15} L${cx - 19} ${cy} Z`}
            fill={pick()} opacity={0.75} />
        );
        els.push(<circle key={`${key}c`} cx={cx} cy={cy} r={2.6} fill="#f3e7d3" />);
      }
    }

    // 中央 medallion
    const med = pick();
    els.push(<path key="med" d="M200 82 L274 150 L200 218 L126 150 Z" fill={med} opacity={0.92} />);
    els.push(<path key="med2" d="M200 106 L244 150 L200 194 L156 150 Z" fill="#f3e7d3" />);
    els.push(<path key="med3" d="M200 126 L224 150 L200 174 L176 150 Z" fill={med} />);

    return els;
  }, [seed]);

  return <>{elements}</>;
}

interface PatternCanvasProps {
  carpet: Carpet;
  palette: PaletteColor[];
  activeBoxId: string | null;
  onSelectBox: (boxId: string) => void;
  onMoveBox: (boxId: string, x: number, y: number) => void;
}

export default function PatternCanvas({
  carpet,
  palette,
  activeBoxId,
  onSelectBox,
  onMoveBox,
}: PatternCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    boxId: string;
    startX: number;
    startY: number;
    boxX: number;
    boxY: number;
  } | null>(null);

  const toSvg = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const intersectingIds = new Set<string>();
  carpet.boxes.forEach((a, i) => {
    carpet.boxes.forEach((b, j) => {
      if (i < j && boxesIntersect(a, b)) {
        intersectingIds.add(a.id);
        intersectingIds.add(b.id);
      }
    });
  });

  const colorOf = (code: string) => palette.find((p) => p.code === code);

  return (
    <svg
      ref={svgRef}
      className="pattern-canvas"
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      role="img"
      aria-label={`${carpet.id} 纹样标记图`}
    >
      <RugPattern seed={carpet.id} />

      {carpet.boxes.map((box, i) => {
        const known = colorOf(box.colorCode);
        const clashing = intersectingIds.has(box.id);
        let stroke = known ? known.hex : "#dc2626";
        let dash: string | undefined;
        if (box.invalidated) {
          stroke = "#94a3b8";
          dash = "6 4";
        } else if (!known) {
          stroke = "#dc2626";
          dash = "6 4";
        } else if (clashing) {
          stroke = "#dc2626";
        }
        const active = activeBoxId === box.id;

        return (
          <g
            key={box.id}
            style={{ cursor: "move", touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as Element).setPointerCapture?.(e.pointerId);
              const p = toSvg(e);
              dragRef.current = { boxId: box.id, startX: p.x, startY: p.y, boxX: box.x, boxY: box.y };
              onSelectBox(box.id);
            }}
            onPointerMove={(e) => {
              const drag = dragRef.current;
              if (!drag || drag.boxId !== box.id) return;
              const p = toSvg(e);
              const nx = clamp(Math.round(drag.boxX + p.x - drag.startX), 0, CANVAS_W - box.w);
              const ny = clamp(Math.round(drag.boxY + p.y - drag.startY), 0, CANVAS_H - box.h);
              onMoveBox(box.id, nx, ny);
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={3}
              fill={stroke}
              fillOpacity={active ? 0.3 : 0.16}
              stroke={stroke}
              strokeWidth={active ? 3 : 2}
              strokeDasharray={dash}
            />
            <text
              x={box.x + 5}
              y={box.y + 14}
              fontSize={11}
              fontWeight={700}
              fill="#172033"
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {boxLabel(i)} · {box.colorCode}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

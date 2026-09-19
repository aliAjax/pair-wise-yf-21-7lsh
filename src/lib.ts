import type {
  AppState,
  Carpet,
  ColorCard,
  DamageBox,
  ProcStep,
  Reason,
  Rect,
} from "./types";

export const STORAGE_KEY = "rug-release-console:v1";

export const ORIGINS = ["波斯", "安纳托利亚", "高加索", "藏毯"] as const;

export const STEP_LIBRARY = [
  "清创除尘",
  "配色试线",
  "补线织补",
  "平整收边",
] as const;

export function makeSteps(): ProcStep[] {
  return STEP_LIBRARY.map((name) => ({ name, status: "pending" as const }));
}

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/* ---------------- 几何 ---------------- */

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

export function normalizeRect(r: Rect): Rect {
  const x = Math.min(r.x, r.x + r.w);
  const y = Math.min(r.y, r.y + r.h);
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(Math.abs(r.w)),
    h: clamp01(Math.abs(r.h)),
  };
}

/** 同毯破损框相交（面积相交；仅边线相接不算） */
export function intersects(a: Rect, b: Rect): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const overlapW = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const overlapH = Math.min(ay2, by2) - Math.max(a.y, b.y);
  return overlapW > 0.05 && overlapH > 0.05;
}

export function findOverlaps(boxes: DamageBox[]): Set<string> {
  const bad = new Set<string>();
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (intersects(boxes[i], boxes[j])) {
        bad.add(boxes[i].id);
        bad.add(boxes[j].id);
      }
    }
  }
  return bad;
}

/** 每个破损框占用色卡 1 份 */
export function boxNeed(): number {
  return 1;
}

/* ---------------- 色卡统计 ---------------- */

/** 已放行档案对各色号的占用（carpetId 自身除外，用于放行前试算） */
export function releasedUsage(state: AppState, carpetId: string): Record<string, number> {
  const used: Record<string, number> = {};
  for (const c of state.carpets) {
    if (c.id === carpetId || c.status !== "released") continue;
    for (const b of c.boxes) {
      used[b.colorCode] = (used[b.colorCode] ?? 0) + boxNeed();
    }
  }
  return used;
}

export function remainingOf(card: ColorCard, reserved: number): number {
  return card.stock - reserved;
}

export function lowStockCards(state: AppState): ColorCard[] {
  const used = releasedUsage(state, "");
  return state.cards.filter((card) => remainingOf(card, used[card.code] ?? 0) <= 2);
}

/* ---------------- 放行校验 ---------------- */

export function validateRelease(state: AppState, carpet: Carpet): Reason[] {
  const reasons: Reason[] = [];
  const reserved = releasedUsage(state, carpet.id);

  if (carpet.boxes.length === 0) {
    reasons.push({ kind: "empty", text: "尚未标出任何破损框" });
  }

  const overlapIds = findOverlaps(carpet.boxes);
  if (overlapIds.size > 0) {
    reasons.push({
      kind: "overlap",
      text: `有 ${overlapIds.size} 个破损框相交，需重新标记`,
    });
  }

  const cardByCode = new Map(state.cards.map((c) => [c.code, c]));
  const need: Record<string, number> = {};
  for (const b of carpet.boxes) {
    if (!cardByCode.has(b.colorCode)) {
      reasons.push({
        kind: "color",
        text: `破损框“${b.id.slice(-4)}”色号 ${b.colorCode} 不在材料色卡中`,
      });
    } else {
      need[b.colorCode] = (need[b.colorCode] ?? 0) + boxNeed();
    }
    if (!b.prePhoto) {
      reasons.push({
        kind: "photo",
        text: `破损框“${b.id.slice(-4)}”缺少施工前照片`,
      });
    }
  }

  for (const [code, n] of Object.entries(need)) {
    const card = cardByCode.get(code);
    if (!card) continue;
    const remain = remainingOf(card, reserved[code] ?? 0);
    if (remain < n) {
      reasons.push({
        kind: "stock",
        text: `色号 ${code}（${card.name}）余量不足：剩 ${remain} 份，本次需 ${n} 份`,
      });
    }
  }

  return reasons;
}

/* ---------------- 放行 / 退回 / 工序 ---------------- */

export function releaseCarpet(carpet: Carpet): Carpet {
  return {
    ...carpet,
    status: "released",
    everReleased: true,
    releasedAt: Date.now(),
    boxes: carpet.boxes.map((b) => ({
      ...b,
      steps: b.steps.map((s) =>
        s.status === "invalid" ? { ...s, status: "pending" as const } : s
      ),
    })),
  };
}

/**
 * 已放行档案中某破损框几何被移动：
 * 该框所有工序失效，该框及之后的工序退回 pending，整张档案退回复核。
 */
export function recallByMove(carpet: Carpet, movedBoxId: string): Carpet {
  const movedIndex = carpet.boxes.findIndex((b) => b.id === movedBoxId);
  if (movedIndex === -1) return carpet;

  return {
    ...carpet,
    status: "review",
    boxes: carpet.boxes.map((b, i) => {
      if (i < movedIndex) return b;
      return {
        ...b,
        steps: b.steps.map((s) => ({
          ...s,
          // 被移动的框：全部失效；后续框：工序失效并退回复核
          status: "invalid" as const,
        })),
      };
    }),
  };
}

export function advanceStep(box: DamageBox, stepIndex: number): DamageBox {
  const steps = box.steps.map((s, i) => {
    if (i !== stepIndex) return s;
    if (s.status === "done") return { ...s, status: "pending" as const };
    // 前面有未完成或失效工序时不允许推进
    const blocked = box.steps
      .slice(0, i)
      .some((p) => p.status !== "done");
    if (blocked) return s;
    return { ...s, status: "done" as const };
  });
  return { ...box, steps };
}

/* ---------------- 初始示例数据 ---------------- */

function motif(seed: number, origin: string): string {
  return motifDataUrl(seed, origin);
}

const SEED_CARDS: ColorCard[] = [
  { code: "R-01", name: "铁锈红", hex: "#7c2d12", stock: 12 },
  { code: "A-04", name: "琥珀棕", hex: "#b45309", stock: 8 },
  { code: "T-07", name: "松石青", hex: "#0f766e", stock: 10 },
  { code: "I-12", name: "靛蓝", hex: "#1e3a8a", stock: 4 },
  { code: "C-03", name: "米白", hex: "#e7dcc3", stock: 20 },
];

function seedBox(
  x: number,
  y: number,
  w: number,
  h: number,
  colorCode: string,
  pre: boolean,
  seed: number,
  origin: string
): DamageBox {
  return {
    id: uid("box"),
    x,
    y,
    w,
    h,
    colorCode,
    prePhoto: pre ? motif(seed, origin) : null,
    postPhoto: null,
    steps: makeSteps(),
  };
}

export function motifDataUrl(seed: number, origin?: string): string {
  const svg = motifSvg(seed, origin ?? "波斯");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 生成纹样局部示意图（确定性伪随机，按产地着色） */
export function motifSvg(seed: number, origin = "波斯"): string {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const palette: Record<string, string[]> = {
    波斯: ["#7c2d12", "#b45309", "#0f766e", "#e7dcc3"],
    安纳托利亚: ["#9a3412", "#ca8a04", "#be123c", "#f5ead1"],
    高加索: ["#1e3a8a", "#b45309", "#7c2d12", "#e7dcc3"],
    藏毯: ["#1e3a8a", "#0f766e", "#7c2d12", "#d9c6a3"],
  };
  const colors = palette[origin] ?? palette.波斯;
  let shapes = "";
  for (let i = 0; i < 26; i += 1) {
    const cx = 8 + rnd() * 84;
    const cy = 8 + rnd() * 84;
    const r = 2.2 + rnd() * 6;
    const fill = colors[Math.floor(rnd() * colors.length)];
    if (i % 3 === 0) {
      shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="0.55"/>`;
    } else if (i % 3 === 1) {
      const pts = `${cx},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${cy} ${cx},${(cy + r).toFixed(1)} ${(cx - r).toFixed(1)},${cy}`;
      shapes += `<polygon points="${pts}" fill="${fill}" opacity="0.5"/>`;
    } else {
      shapes += `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r * 0.7).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 1.4).toFixed(1)}" rx="1" fill="${fill}" opacity="0.45"/>`;
    }
  }
  // 中心团花
  shapes += `<circle cx="50" cy="50" r="15" fill="none" stroke="${colors[0]}" stroke-width="1.6" opacity="0.8"/>`;
  shapes += `<circle cx="50" cy="50" r="8" fill="${colors[2]}" opacity="0.6"/>`;
  shapes += `<circle cx="50" cy="50" r="3.2" fill="${colors[1]}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="640" height="640">
<rect width="100" height="100" fill="#efe6d4"/>
<rect x="3" y="3" width="94" height="94" fill="none" stroke="${colors[0]}" stroke-width="1.4"/>
${shapes}
</svg>`;
}

const SEED_CARPETS: Carpet[] = [
  {
    id: "CAR-092",
    origin: "波斯",
    era: "约1960s",
    knot: "结密度 36 道/英寸",
    material: "羊毛",
    dye: "植物染",
    seed: 9207,
    status: "review",
    everReleased: false,
    releasedAt: null,
    boxes: [seedBox(12, 18, 24, 16, "R-01", true, 11, "波斯"), seedBox(58, 60, 20, 22, "A-04", true, 22, "波斯")],
  },
  {
    id: "CAR-117",
    origin: "安纳托利亚",
    era: "约1940s",
    knot: "结密度 42 道/英寸",
    material: "羊毛·棉经",
    dye: "植物染",
    seed: 1173,
    status: "review",
    everReleased: false,
    releasedAt: null,
    boxes: [
      seedBox(40, 36, 26, 22, "C-03", true, 33, "安纳托利亚"),
      seedBox(52, 46, 24, 20, "A-04", false, 44, "安纳托利亚"),
      seedBox(70, 12, 18, 14, "X-99", true, 55, "安纳托利亚"),
    ],
  },
  {
    id: "CAR-138",
    origin: "藏毯",
    era: "约1980s",
    knot: "结密度 30 道/英寸",
    material: "羊毛",
    dye: "矿物染",
    seed: 1388,
    status: "review",
    everReleased: false,
    releasedAt: null,
    boxes: [],
  },
  {
    id: "CAR-145",
    origin: "高加索",
    era: "约1970s",
    knot: "结密度 40 道/英寸",
    material: "羊毛",
    dye: "天然染",
    seed: 1455,
    status: "review",
    everReleased: false,
    releasedAt: null,
    boxes: [seedBox(20, 30, 22, 20, "T-07", true, 66, "高加索")],
  },
];

export function initialState(): AppState {
  return { cards: SEED_CARDS, carpets: SEED_CARPETS };
}

/* ---------------- 持久化 ---------------- */

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.cards || !parsed.carpets) return initialState();
    return parsed;
  } catch {
    return initialState();
  }
}

export function saveState(state: AppState): { ok: boolean } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/* ---------------- 汇总 ---------------- */

export function progressOf(carpet: Carpet): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const b of carpet.boxes) {
    for (const s of b.steps) {
      total += 1;
      if (s.status === "done") done += 1;
    }
  }
  return { done, total };
}

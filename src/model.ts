// 纹样标记放行台 —— 领域模型与纯逻辑
// 数据只存浏览器 localStorage，重开页面后恢复。

export const CANVAS_W = 400;
export const CANVAS_H = 300;
export const STORAGE_KEY = "carpet-release-station:v1";

export const STEP_NAMES = ["配线", "织补", "整形", "验收"] as const;
export const ORIGINS = ["波斯", "安纳托利亚", "高加索", "藏毯"] as const;

export interface ProcStep {
  name: string;
  done: boolean;
}

export interface DamageBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  colorCode: string; // 补线色号
  prePhoto: string | null; // 施工前照片 dataURL
  postPhoto: string | null; // 施工后照片 dataURL
  steps: ProcStep[];
  invalidated: boolean; // 已放行后被移动 → 该框工序失效
  stockDeducted: boolean; // 放行时已扣减色卡余量
}

export type CarpetStatus = "review" | "released";

export interface Carpet {
  id: string;
  origin: string;
  era: string;
  knot: string;
  material: string;
  dye: string;
  damageNote: string;
  status: CarpetStatus;
  everReleased: boolean; // 放行过后施工前后照片只读留档
  boxes: DamageBox[];
}

export interface PaletteColor {
  code: string;
  name: string;
  hex: string;
  stock: number; // 色卡余量
}

export interface AppState {
  carpets: Carpet[];
  palette: PaletteColor[];
  filter: string;
  selectedId: string;
}

export interface Validation {
  pairs: [string, string][]; // 相交框对
  badColors: string[]; // 色号不在材料色卡的框
  shortStock: string[]; // 色卡余量不足的框
  missingPhotos: string[]; // 缺施工前照片的框
  ok: boolean;
}

export const boxLabel = (index: number) => `框${index + 1}`;

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** 同毯破损框相交判定（贴边不算相交） */
export function boxesIntersect(
  a: Pick<DamageBox, "x" | "y" | "w" | "h">,
  b: Pick<DamageBox, "x" | "y" | "w" | "h">
): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** 复核校验：相交 / 色号不在色卡 / 余量不足 / 缺施工前照片 */
export function validateCarpet(carpet: Carpet, palette: PaletteColor[]): Validation {
  const pairs: [string, string][] = [];
  for (let i = 0; i < carpet.boxes.length; i++) {
    for (let j = i + 1; j < carpet.boxes.length; j++) {
      if (boxesIntersect(carpet.boxes[i], carpet.boxes[j])) {
        pairs.push([boxLabel(i), boxLabel(j)]);
      }
    }
  }

  const badColors: string[] = [];
  const missingPhotos: string[] = [];
  const need = new Map<string, number>();
  carpet.boxes.forEach((b, i) => {
    if (!palette.some((p) => p.code === b.colorCode)) {
      badColors.push(boxLabel(i));
    } else if (!b.stockDeducted) {
      need.set(b.colorCode, (need.get(b.colorCode) ?? 0) + 1);
    }
    if (!b.prePhoto) missingPhotos.push(boxLabel(i));
  });

  const short = new Set<string>();
  need.forEach((n, code) => {
    const stock = palette.find((p) => p.code === code)?.stock ?? 0;
    if (n > stock) short.add(code);
  });
  const shortStock: string[] = [];
  carpet.boxes.forEach((b, i) => {
    if (!b.stockDeducted && short.has(b.colorCode)) shortStock.push(boxLabel(i));
  });

  return {
    pairs,
    badColors,
    shortStock,
    missingPhotos,
    ok:
      pairs.length === 0 &&
      badColors.length === 0 &&
      shortStock.length === 0 &&
      missingPhotos.length === 0,
  };
}

/** 放行：扣减色卡余量，工序可登记；校验不过时不调用（调用方保证） */
export function releaseCarpet(
  carpet: Carpet,
  palette: PaletteColor[]
): { carpet: Carpet; palette: PaletteColor[] } {
  const pal = palette.map((p) => ({ ...p }));
  const boxes = carpet.boxes.map((b) => {
    if (b.stockDeducted) return { ...b, invalidated: false };
    const color = pal.find((p) => p.code === b.colorCode);
    if (color) color.stock -= 1;
    return { ...b, stockDeducted: true, invalidated: false };
  });
  return {
    carpet: { ...carpet, boxes, status: "released", everReleased: true },
    palette: pal,
  };
}

/** 已放行档案移动破损框：该框及后续框工序失效、退回余量，整档退回复核 */
export function invalidateFrom(
  carpet: Carpet,
  index: number,
  palette: PaletteColor[]
): { carpet: Carpet; palette: PaletteColor[] } {
  const pal = palette.map((p) => ({ ...p }));
  const boxes = carpet.boxes.map((b, i) => {
    if (i < index) return b;
    const next: DamageBox = {
      ...b,
      invalidated: true,
      steps: b.steps.map((s) => ({ ...s, done: false })),
    };
    if (next.stockDeducted) {
      const color = pal.find((p) => p.code === next.colorCode);
      if (color) color.stock += 1;
      next.stockDeducted = false;
    }
    return next;
  });
  return { carpet: { ...carpet, boxes, status: "review" }, palette: pal };
}

/** 工序进度 0~1 */
export function carpetProgress(c: Carpet): number {
  const total = c.boxes.length * STEP_NAMES.length;
  if (total === 0) return 0;
  const done = c.boxes.reduce(
    (n, b) => n + b.steps.filter((s) => s.done).length,
    0
  );
  return done / total;
}

export function carpetStatusText(c: Carpet): string {
  if (c.status === "released") return "已放行";
  return c.everReleased ? "退回复核" : "待复核";
}

// ---------- 种子数据 ----------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 生成一张施工前/后留档占位照片（SVG dataURL，随种子数据入 localStorage） */
export function seedPhoto(tag: string, base: string, accent: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200' viewBox='0 0 320 200'>` +
    `<rect width='320' height='200' fill='${base}'/>` +
    `<rect x='14' y='14' width='292' height='172' fill='none' stroke='${accent}' stroke-width='6'/>` +
    `<rect x='30' y='30' width='260' height='140' fill='none' stroke='#f3e7d3' stroke-width='2' stroke-dasharray='10 6'/>` +
    `<path d='M160 52 L208 100 L160 148 L112 100 Z' fill='${accent}' opacity='0.85'/>` +
    `<path d='M160 74 L186 100 L160 126 L134 100 Z' fill='#f3e7d3'/>` +
    `<rect width='320' height='34' y='166' fill='#1f2937' opacity='0.72'/>` +
    `<text x='16' y='188' font-family='monospace' font-size='14' fill='#f8fafc'>${tag}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const makeSteps = (doneCount = 0): ProcStep[] =>
  STEP_NAMES.map((name, i) => ({ name, done: i < doneCount }));

interface BoxSeed {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  pre?: boolean;
  post?: boolean;
  steps?: number;
  deducted?: boolean;
}

function makeBox(carpetId: string, idx: number, seed: BoxSeed): DamageBox {
  const tag = `${carpetId} · 框${idx + 1}`;
  return {
    id: `${carpetId}-b${idx + 1}`,
    x: seed.x,
    y: seed.y,
    w: seed.w,
    h: seed.h,
    colorCode: seed.color,
    prePhoto: seed.pre ? seedPhoto(`${tag} · 施工前`, "#7c2d12", "#b45309") : null,
    postPhoto: seed.post ? seedPhoto(`${tag} · 施工后`, "#0f766e", "#f3e7d3") : null,
    steps: makeSteps(seed.steps ?? 0),
    invalidated: false,
    stockDeducted: seed.deducted ?? false,
  };
}

export function seedState(): AppState {
  // 余量为“当前”库存：CAR-150 已放行，IND-416 / CHS-744 已各扣 1
  const palette: PaletteColor[] = [
    { code: "IND-416", name: "靛蓝", hex: "#1e3a8a", stock: 5 },
    { code: "MAD-233", name: "茜草红", hex: "#b91c1c", stock: 4 },
    { code: "SAF-107", name: "藏红", hex: "#c2410c", stock: 3 },
    { code: "WAL-552", name: "茶褐", hex: "#7c2d12", stock: 5 },
    { code: "UND-010", name: "本白", hex: "#e7e5df", stock: 8 },
    { code: "TUR-318", name: "松石绿", hex: "#0f766e", stock: 2 },
    { code: "CHS-744", name: "栗棕", hex: "#92400e", stock: 3 },
    { code: "APR-209", name: "金杏", hex: "#d97706", stock: 0 },
  ];

  const carpets: Carpet[] = [
    {
      id: "CAR-092",
      origin: "波斯",
      era: "约1960s",
      knot: "42 结/cm",
      material: "羊毛",
      dye: "植物染",
      damageNote: "边缘磨损待补线",
      status: "review",
      everReleased: false,
      boxes: [
        makeBox("CAR-092", 0, { x: 42, y: 48, w: 92, h: 70, color: "IND-416", pre: true }),
        makeBox("CAR-092", 1, { x: 236, y: 168, w: 100, h: 78, color: "WAL-552", pre: true }),
      ],
    },
    {
      id: "CAR-117",
      origin: "安纳托利亚",
      era: "约1930s",
      knot: "42 结/cm",
      material: "羊毛",
      dye: "植物染",
      damageNote: "中心纹样缺口",
      status: "review",
      everReleased: false,
      boxes: [
        makeBox("CAR-117", 0, { x: 62, y: 58, w: 124, h: 92, color: "MAD-233", pre: true }),
        makeBox("CAR-117", 1, { x: 148, y: 112, w: 120, h: 88, color: "SAF-107", pre: true }),
      ],
    },
    {
      id: "CAR-138",
      origin: "藏毯",
      era: "约1980s",
      knot: "36 结/cm",
      material: "牦牛毛",
      dye: "矿物染",
      damageNote: "局部褪色，需匹配靛蓝色卡",
      status: "review",
      everReleased: false,
      boxes: [
        makeBox("CAR-138", 0, { x: 52, y: 62, w: 104, h: 78, color: "UNK-999", pre: true }),
        makeBox("CAR-138", 1, { x: 224, y: 152, w: 108, h: 80, color: "TUR-318", pre: false }),
      ],
    },
    {
      id: "CAR-150",
      origin: "高加索",
      era: "约1950s",
      knot: "48 结/cm",
      material: "羊毛",
      dye: "植物染",
      damageNote: "边框虫蛀两处",
      status: "released",
      everReleased: true,
      boxes: [
        makeBox("CAR-150", 0, {
          x: 36, y: 44, w: 96, h: 72, color: "CHS-744",
          pre: true, post: true, steps: 3, deducted: true,
        }),
        makeBox("CAR-150", 1, {
          x: 232, y: 172, w: 108, h: 78, color: "IND-416",
          pre: true, steps: 1, deducted: true,
        }),
      ],
    },
    {
      id: "CAR-163",
      origin: "波斯",
      era: "约1970s",
      knot: "50 结/cm",
      material: "丝毛混纺",
      dye: "植物染",
      damageNote: " medallion 金杏色脱线",
      status: "review",
      everReleased: false,
      boxes: [
        makeBox("CAR-163", 0, { x: 128, y: 92, w: 132, h: 104, color: "APR-209", pre: true }),
      ],
    },
  ];

  return { carpets, palette, filter: "全部", selectedId: carpets[0].id };
}

// ---------- 持久化 ----------

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || !Array.isArray(parsed.carpets) || !Array.isArray(parsed.palette)) {
      return seedState();
    }
    const seed = seedState();
    return {
      carpets: parsed.carpets,
      palette: parsed.palette,
      filter: typeof parsed.filter === "string" ? parsed.filter : "全部",
      selectedId:
        parsed.carpets.find((c) => c.id === parsed.selectedId)?.id ??
        parsed.carpets[0]?.id ??
        seed.selectedId,
    };
  } catch {
    return seedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储超限等异常时静默失败，页面状态仍在内存中
  }
}

export { hashSeed };

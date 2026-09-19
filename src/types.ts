export type Origin = "波斯" | "安纳托利亚" | "高加索" | "藏毯";

export type CarpetStatus = "review" | "released";

export type StepStatus = "pending" | "done" | "invalid";

export interface ProcStep {
  name: string;
  status: StepStatus;
}

export interface DamageBox {
  id: string;
  /** 框坐标，均为相对纹样图的百分比（0-100） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 补线色号，必须出自材料色卡 */
  colorCode: string;
  /** 施工前照片（dataURL），放行后只读留档 */
  prePhoto: string | null;
  /** 施工后照片（dataURL），一旦上传即只读留档 */
  postPhoto: string | null;
  steps: ProcStep[];
}

export interface Carpet {
  id: string;
  origin: Origin;
  era: string;
  knot: string;
  material: string;
  dye: string;
  /** 纹样图伪随机种子 */
  seed: number;
  status: CarpetStatus;
  /** 是否曾经放行过（决定施工前照片是否锁为只读） */
  everReleased: boolean;
  releasedAt: number | null;
  boxes: DamageBox[];
}

export interface ColorCard {
  code: string;
  name: string;
  hex: string;
  /** 色卡余量（份） */
  stock: number;
}

export interface AppState {
  cards: ColorCard[];
  carpets: Carpet[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ReasonKind = "empty" | "overlap" | "color" | "photo" | "stock";

export interface Reason {
  kind: ReasonKind;
  text: string;
}

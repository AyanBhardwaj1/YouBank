/**
 * Studio: a live workbook and deck that a person and the agent edit together. These types are shared
 * by the browser, the server and the export code, and are stored as JSON in studio_docs.
 */

export type Scalar = number | string | boolean | null;

export type Border = "thin" | "medium" | "double";

/** Cell formatting, kept close to what Excel stores so it survives a round trip through .xlsx. */
export type CellStyle = {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** Font colour, #RRGGBB. Banker convention: blue inputs, black formulas, green links to other sheets. */
  color?: string;
  /** Fill colour, #RRGGBB. */
  fill?: string;
  /** Excel number format, e.g. `#,##0.0_);(#,##0.0)`, `0.0%`, `0.0"x"`. */
  nf?: string;
  al?: "left" | "center" | "right";
  indent?: number;
  bt?: Border;
  bb?: Border;
  size?: number;
  wrap?: boolean;
};

/**
 * One cell. `v` is a typed-in value, `f` a formula without the leading "=". `cv` is the value an
 * imported file had cached for a formula, shown when a function is not supported here.
 */
export type CellData = {
  v?: Scalar; f?: string; s?: CellStyle; cv?: Scalar;
  /** Where a typed-in figure came from (a filing, an upload), shown as a marker and exported as a note. */
  src?: string;
};

/** A two-way data table: the output recomputed for every pair of input values. */
export type Sensitivity = {
  id: string;
  /** Top-left cell of the table (the corner holds the output reference). */
  at: string;
  output: string;
  rowInput: string;
  colInput: string;
  rowValues: number[];
  colValues: number[];
  nf?: string;
  title?: string;
};

export type SheetData = {
  id: string;
  name: string;
  cells: Record<string, CellData>;
  /** Column widths in pixels, by column letter. */
  cols?: Record<string, number>;
  freeze?: { rows: number; cols: number };
  merges?: string[];
  sens?: Sensitivity[];
  tab?: string;
};

export type Workbook = {
  order: string[];
  sheets: Record<string, SheetData>;
  /** Defined names, e.g. { WACC: "DCF!$C$22" }. */
  names?: Record<string, string>;
  /** Iterative calculation for circular models (interest on average debt), as Excel offers. On by default. */
  calc?: { iterative?: boolean; maxIterations?: number; maxChange?: number };
};

/* ---------------- Deck ---------------- */

/** A link from a slide element to the model. Sheet is a sheet id, so renaming a sheet keeps links. */
export type RangeLink = { sheet: string; range: string };

export type ChartKind = "column" | "bar" | "line" | "stacked" | "waterfall" | "football" | "pie";
export type ChartData = { labels: string[]; series: { name: string; values: (number | null)[] }[] };

type Box = { id: string; x: number; y: number; w: number; h: number };

/** Positions and sizes are in inches on a 13.333 × 7.5 inch (16:9) slide, the unit PowerPoint uses. */
export type SlideEl =
  | (Box & { type: "text"; text: string; size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right"; bullets?: boolean })
  | (Box & { type: "table"; link?: RangeLink; rows?: string[][]; header?: boolean; size?: number })
  | (Box & {
      type: "chart"; kind: ChartKind;
      /** Table-shaped source: first row labels, then one series per row (first column is the name). Football: rows of label, low, high. Waterfall: rows of label, value. */
      link?: RangeLink;
      /** Or labels and series linked separately, for rows that are not next to each other. */
      labels?: RangeLink; series?: { name: string; link: RangeLink }[];
      data?: ChartData; title?: string; unit?: string; nf?: string; marker?: { label: string; link?: RangeLink; value?: number };
    })
  | (Box & { type: "metric"; label: string; link?: RangeLink; value?: string; nf?: string })
  | (Box & { type: "shape"; fill?: string; line?: string });

export type Slide = {
  id: string;
  layout: "title" | "content" | "section";
  title: string;
  subtitle?: string;
  elements: SlideEl[];
  /** Sources and footnotes, printed at the foot of the slide. */
  sources?: string;
  notes?: string;
};

export type DeckTheme = { primary: string; accent: string; font: string; footer?: string; confidential?: boolean };

export type Deck = { order: string[]; slides: Record<string, Slide>; theme: DeckTheme };

/* ---------------- Comments ---------------- */

export type CommentTarget = { kind: "cell"; sheet: string; cell: string } | { kind: "slide"; slide: string };
export type StudioComment = { id: string; target: CommentTarget; text: string; author: string; at: string; resolved?: boolean; resolution?: string };

export type StudioDocData = { title: string; workbook: Workbook; deck: Deck; comments: StudioComment[] };

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

export const DEFAULT_THEME: DeckTheme = { primary: "#0B2545", accent: "#C8963E", font: "Arial", confidential: true };

export function emptyDeck(): Deck {
  return { order: [], slides: {}, theme: { ...DEFAULT_THEME } };
}

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

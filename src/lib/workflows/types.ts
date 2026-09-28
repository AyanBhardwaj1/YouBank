/**
 * Workflow engine contract. A "tool" is either an AI workflow (the model does the work with data tools and
 * returns a structured WorkflowOutput) or a calculator (pure TypeScript compute over typed inputs, same output
 * shape). Both render through <OutputBlocks/>, run in the Tools gallery or inside a terminal panel, and save
 * to workflow_runs.
 */
import type { RoleId } from "@/lib/roles";
import type { CompanyData } from "@/lib/types";
import type { ToolCategory } from "./categories";
import type { NumFormat, OutputBlock, Tone, WorkflowOutput } from "./schema";

/* ---------------- Inputs ---------------- */

export type FieldType = "ticker" | "tickers" | "text" | "textarea" | "number" | "select" | "multiselect" | "csv" | "date" | "toggle";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** Short helper text under the control. */
  help?: string;
  options?: string[];
  default?: string | number | boolean | string[];
  /** Display unit for numbers: "$mm", "%", "x", "years", "shares mm". Percent inputs are entered as whole numbers (25 = 25%). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** For csv fields: the columns the tool expects, shown as a hint. */
  columns?: string;
};

export type Inputs = Record<string, unknown>;

/* ---------------- Outputs ---------------- */

// Output types are defined by the runtime schemas in schema.ts (only their types are imported here,
// which keeps zod out of every bundle that renders or lists tools).
export type { NumFormat, OutputBlock, Tone, WorkflowOutput };

/* ---------------- Tool definitions ---------------- */

export { CATEGORIES, type ToolCategory } from "./categories";

type ToolBase = {
  /** kebab-case, globally unique */
  id: string;
  title: string;
  /** One line, shown on cards. */
  tagline: string;
  /** Two or three sentences: what it produces and the method. */
  description: string;
  roles: RoleId[] | "all";
  /** Narrow to specialties within the roles (matches profile.specialty). Omit for all specialties. */
  specialties?: string[];
  category: ToolCategory;
  /** lucide-react icon name, e.g. "Calculator", "FileText", "Search", "TrendingUp". */
  icon: string;
  tags?: string[];
  fields: Field[];
  /** Sample inputs for "Try an example". */
  example?: Inputs;
  /** Typical minutes of analyst time this replaces (shown on the card). */
  savesMinutes?: number;
};

export type WorkflowDef = ToolBase & {
  kind: "ai";
  deliverable: "memo" | "table" | "model" | "deck" | "checklist" | "research" | "email" | "quiz" | "analysis";
  /** Methodology for the model: how to do the work, the standard it must meet, which tools to use, and the output blocks to produce. */
  instructions: string;
  /** Build the user message from validated inputs. */
  prompt: (inputs: Inputs) => string;
  /** Restrict data tools by name; default is every tool. */
  tools?: string[];
  /** Default reasoning effort for this workflow. */
  effort?: "low" | "medium" | "high";
};

export type CalculatorDef = ToolBase & {
  kind: "calc";
  /** Pure, synchronous compute over validated inputs. Throw an Error with a readable message for bad inputs. */
  compute: (inputs: Inputs) => WorkflowOutput;
  /** Optional prefill from a loaded company (LTM figures, balance sheet, price). */
  prefill?: (company: CompanyData) => Inputs;
};

export type ToolDef = WorkflowDef | CalculatorDef;

/* ---------------- Input helpers ---------------- */

export const num = (inputs: Inputs, key: string, fallback = 0): number => {
  const v = inputs[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.replace(/[,$%x\s]/g, "")); if (Number.isFinite(n)) return n; }
  return fallback;
};
export const str = (inputs: Inputs, key: string, fallback = ""): string => (typeof inputs[key] === "string" ? (inputs[key] as string) : inputs[key] == null ? fallback : String(inputs[key]));
export const list = (inputs: Inputs, key: string): string[] => {
  const v = inputs[key];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  return [];
};
export const bool = (inputs: Inputs, key: string, fallback = false): boolean => (typeof inputs[key] === "boolean" ? (inputs[key] as boolean) : fallback);

/** Parse CSV text into header + rows (handles quotes). */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const parse = (line: string) => { const out: string[] = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if ((c === "," || c === "\t") && !q) { out.push(cur.trim()); cur = ""; } else cur += c; } out.push(cur.trim()); return out; };
  if (lines.length === 0) return { header: [], rows: [] };
  return { header: parse(lines[0]), rows: lines.slice(1).map(parse) };
}

/* ---------------- Formatting helpers shared by calculators ---------------- */

export const fmt = {
  money: (v: number | null, digits = 1) => (v === null || !Number.isFinite(v) ? "n/a" : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(digits)}B` : `$${v.toFixed(digits)}M`),
  moneyRaw: (v: number | null, digits = 0) => (v === null || !Number.isFinite(v) ? "n/a" : `$${v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`),
  pct: (v: number | null, digits = 1) => (v === null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(digits)}%`),
  x: (v: number | null, digits = 1) => (v === null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(digits)}x`),
  num: (v: number | null, digits = 1) => (v === null || !Number.isFinite(v) ? "n/a" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })),
  int: (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : Math.round(v).toLocaleString("en-US")),
  bps: (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : `${Math.round(v * 10000)} bps`),
};

/** Roles a tool applies to, resolved against a profile. Works on a full definition or a catalog entry. */
export function toolApplies(t: { roles: RoleId[] | "all"; specialties?: string[] }, role: RoleId, specialty?: string): boolean {
  if (t.roles !== "all" && !t.roles.includes(role)) return false;
  if (t.specialties && specialty && !t.specialties.includes(specialty)) return false;
  return true;
}

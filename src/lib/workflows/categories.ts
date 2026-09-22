/**
 * Tool categories.
 *
 * Deliberately free of any zod import so marketing pages can list categories without pulling the
 * schema layer (and its ~390 KB of runtime) into the browser bundle.
 */
export type ToolCategory =
  | "Valuation" | "Modeling" | "Diligence" | "Deliverables" | "Research" | "Screening" | "Reporting" | "Credit & restructuring"
  | "Capital markets" | "Accounting & audit" | "Tax" | "Planning & forecasting" | "Sourcing & deals" | "Portfolio" | "Learning" | "Communication";

export const CATEGORIES: ToolCategory[] = ["Valuation", "Modeling", "Diligence", "Deliverables", "Research", "Screening", "Reporting", "Credit & restructuring", "Capital markets", "Accounting & audit", "Tax", "Planning & forecasting", "Sourcing & deals", "Portfolio", "Learning", "Communication"];

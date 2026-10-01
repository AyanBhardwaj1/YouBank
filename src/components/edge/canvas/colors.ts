/**
 * The canvas's colours by module and by kind of data. Plain constants with no imports that run, so the
 * canvas list (and anything else that only needs a colour) does not load the node editor.
 */
import type { Kind, Module } from "@/lib/edge/canvas/catalog";

export const MODULE_COLOR: Record<Module, string> = { source: "#94a3b8", earth: "#56B4E9", documents: "#E69F00", networks: "#CC79A7", scenarios: "#009E73", output: "#F0B429" };
export const KIND_COLOR: Record<Kind, string> = {
  companies: "#94a3b8", places: "#94a3b8", findings: "#56B4E9", proforma: "#56B4E9", docs: "#E69F00", answer: "#E69F00",
  ranking: "#CC79A7", graph: "#CC79A7", scenario: "#009E73", table: "#009E73", memo: "#F0B429", signal: "#F0B429", file: "#F0B429",
};

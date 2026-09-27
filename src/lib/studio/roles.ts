/**
 * Studio for each career: which templates come first and which one-click tasks the agent panel offers.
 * `{T}` is replaced with the document's ticker (or "the company").
 */
import type { RoleId } from "@/lib/roles";
import type { TemplateId } from "./templates";

type StudioRole = { lead: string; templates: TemplateId[]; tasks: string[] };

const COMMON = [
  "Audit this model and fix what you find",
  "Apply banker formatting to every sheet",
  "Turn all open comments and resolve them",
  "Tie out the deck to the model",
];

export const STUDIO_ROLES: Record<RoleId, StudioRole> = {
  banker: {
    lead: "Comps, DCF and a linked pitch book in minutes, with a football field that updates with the model.",
    templates: ["valuation", "comps", "dcf", "merger", "lbo", "blank"],
    tasks: ["Build a valuation pack with a linked deck for {T}", "Add a WACC × terminal growth sensitivity next to the DCF", "Make a football field slide from the summary sheet", "Add an accretion / dilution slide for the merger model", ...COMMON],
  },
  pe: {
    lead: "An LBO with a real debt schedule, circularity handled, returns sensitivities and an IC deck.",
    templates: ["lbo", "valuation", "dcf", "comps", "blank"],
    tasks: ["Build an LBO for {T} with an IC deck", "Add a returns attribution: EBITDA growth, multiple expansion and debt paydown", "Run IRR against exit year and exit multiple", "Add a downside case with 3% lower revenue growth", ...COMMON],
  },
  vc: {
    lead: "Round models, cap tables and portfolio decks, with dilution worked through for every holder.",
    templates: ["cap_table", "dcf", "comps", "blank"],
    tasks: ["Model a $12M Series A at $48M pre with a 12% post-money pool", "Add a Series B at 2x the Series A price and show dilution by holder", "Build a portfolio update slide from this cap table", "Add a liquidation preference waterfall at a $150M exit", ...COMMON],
  },
  markets: {
    lead: "Earnings models and valuation, built from filings, with every historical figure sourced.",
    templates: ["dcf", "comps", "valuation", "blank"],
    tasks: ["Build a DCF for {T} and show upside to the current price", "Add a bull, base and bear case switch to the DCF", "Spread comps for {T} and its peers", "Make a one-page investment summary slide", ...COMMON],
  },
  corpfin: {
    lead: "Budgets, forecasts and board decks, with variance analysis done for you.",
    templates: ["dcf", "valuation", "cap_table", "blank"],
    tasks: ["Build a 5-year operating plan for {T} with scenarios", "Add a budget vs actual variance table with commentary", "Make a board deck with the KPI summary and the forecast", "Build a debt capacity analysis at 3x and 4x EBITDA", ...COMMON],
  },
  consultant: {
    lead: "Market sizing, business cases and client-ready decks from the numbers behind them.",
    templates: ["blank", "dcf", "comps"],
    tasks: ["Build a top-down and bottom-up market sizing model", "Build a business case with NPV and payback for a $5M investment", "Turn the model into a 5-slide client deck", "Add a waterfall chart bridging this year's EBITDA to next year's", ...COMMON],
  },
  accountant: {
    lead: "Schedules, reconciliations and tie-outs, checked cell by cell.",
    templates: ["blank", "dcf"],
    tasks: ["Build a fixed asset roll-forward with straight-line depreciation", "Build a debt amortisation schedule with IPMT and PPMT", "Reconcile these two columns and flag differences over 1%", "Build a lease schedule (ASC 842) from these payments", ...COMMON],
  },
  student: {
    lead: "Practise on real filings: build a DCF or LBO, then have your work checked like an analyst's.",
    templates: ["dcf", "lbo", "comps", "valuation", "blank"],
    tasks: ["Build a DCF for {T} and explain each step in a notes column", "Plant three errors in this model for me to find (don't tell me where)", "Check my model like a VP would and list what to fix", "Walk me through the LBO: what drives the IRR?", ...COMMON],
  },
};

export const tasksFor = (role: RoleId, ticker: string) => STUDIO_ROLES[role].tasks.map((t) => t.replace(/\{T\}/g, ticker || "the company"));

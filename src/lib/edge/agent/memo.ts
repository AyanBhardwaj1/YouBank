/**
 * The Thesis Agent's (E7) living memo, rebuilt every tick from the state: the thesis and its overall
 * probability, what changed since a date, the claim tree with priors and their basis, the evidence log, the
 * red team's counter-case, the kill criteria and the method. Probabilities are labelled "agent estimate".
 * Written deterministically (no model), so every word traces to the state; the weekly synthesis (the small
 * model, or the deep pass on premium) is added beside it, never in place of it. Pure.
 */
import { LADDER_VERSION, overall } from "./update";
import type { AgentState, ClaimState } from "./types";

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`);

/** What changed since a time: claims that moved 5 points or more, kill criteria that fired, evidence kept. Pure. */
export function whatChanged(s: AgentState, since: string): string[] {
  const out: string[] = [];
  for (const c of s.claims) {
    const before = [...c.history].reverse().find((h) => h.at <= since)?.p ?? c.prior;
    if (Math.abs(c.p - before) >= 0.05) out.push(`Claim ${c.n} moved ${pct(before)} → ${pct(c.p)}: ${c.history.filter((h) => h.at > since).map((h) => h.why).filter(Boolean).slice(-2).join("; ") || "evidence"}.`);
    if (c.resolved && c.resolved.at > since) out.push(`Claim ${c.n} resolved ${c.resolved.outcome >= 0.5 ? "true" : "false"} (${c.resolved.source}).`);
  }
  for (const k of s.kills) if (k.status === "fired" && k.firedAt && k.firedAt > since) out.push(`Kill criterion ${k.n} fired: ${k.detail}.`);
  const kept = s.evidence.filter((e) => e.at > since && e.kept).length, dropped = s.evidence.filter((e) => e.at > since && !e.kept).length;
  if (kept || dropped) out.push(`${kept} evidence item${kept === 1 ? "" : "s"} kept, ${dropped} held back by the verifier.`);
  return out.length ? out : ["Nothing material changed."];
}

function tree(claims: ClaimState[], parent: number | null, depth: number): string[] {
  return claims.filter((c) => c.parent === parent).flatMap((c) => [
    `${"  ".repeat(depth)}- **${c.n}. ${c.text}** — agent estimate ${pct(c.p)} (prior ${pct(c.prior)}, ${c.priorBasis === "reference" ? c.priorNote : "subjective"})${c.override ? `; person override to ${pct(c.override.p)}: ${c.override.note}` : ""}${c.resolved ? `; resolved ${c.resolved.outcome >= 0.5 ? "true" : "false"}` : ""}; closes ${c.closes}`,
    ...tree(claims, c.n, depth + 1),
  ]);
}

/** The memo as markdown. Pure. */
export function buildMemo(s: AgentState, title: string, thesis: string, since: string, now: string): { markdown: string; whatChanged: string[] } {
  const changed = whatChanged(s, since);
  const kept = s.evidence.filter((e) => e.kept).slice(-10).reverse();
  const md = [
    `# ${title}`,
    `> ${thesis}`,
    `**Overall (agent estimate): ${pct(overall(s.claims))}** · ${s.ticks} tick${s.ticks === 1 ? "" : "s"} · updated ${now.slice(0, 16).replace("T", " ")} UTC`,
    `## What changed since ${since.slice(0, 10)}`, ...changed.map((c) => `- ${c}`),
    "## Claims", ...tree(s.claims, null, 0),
    "## Evidence (kept by the verifier)", ...(kept.length ? kept.map((e) => `- Claim ${e.claim}, ${e.direction === "for" ? "for" : "against"} (${e.strength}${e.by !== "agent" ? `, ${e.by === "redteam" ? "red team" : "added by a person"}` : ""}): ${e.statement} — "${e.quote}" (${e.source})`) : ["- None yet."]),
    ...(s.redteam ? ["## Red team", ...s.redteam.points.map((p) => `- Against claim ${p.claim}: ${p.text}${p.kept ? "" : " (not supported by the sources; not counted)"}`)] : []),
    ...(s.premortem ? ["## Pre-mortem", s.premortem.text] : []),
    "## Kill criteria", ...s.kills.map((k) => `- ${k.status === "fired" ? "**FIRED**" : k.status === "unavailable" ? "Not checkable yet" : "Watching"}: ${k.text} (${k.detail})`),
    ...(s.memo?.synthesis ? [`## ${s.memo.synthesis.deep ? "Deep synthesis" : "Weekly synthesis"} (${s.memo.synthesis.at.slice(0, 10)})`, s.memo.synthesis.text] : []),
    "## Method", `Probabilities are agent estimates: priors from reference classes where they exist, moved by verified evidence on a stated ${LADDER_VERSION}. Evidence counts only when Edge's claim verifier finds it supported by its quoted source. Every claim is logged in the forecast ledger and scored when it resolves.`,
  ].join("\n\n");
  return { markdown: md, whatChanged: changed };
}

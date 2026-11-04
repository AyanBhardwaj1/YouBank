"use client";

import type { FigureReport } from "@/lib/ai/figures";

/**
 * Which figures match a number in the source they cite. "Matches" is all it claims: a matched figure can
 * still be the wrong field to quote, so each one shows the field and period it matched.
 */
export function FigureCheck({ r }: { r: FigureReport }) {
  if (!r.figures.length) return null;
  const sumUp = [
    r.checkable ? `${r.matched + r.computed} of ${r.checkable} figures from data match the cited source` : "",
    r.noMatch ? `${r.noMatch} not found there` : "",
    r.textOnly ? `${r.textOnly} cited from text, not checked` : "",
    r.uncited ? `${r.uncited} without a citation` : "",
  ].filter(Boolean).join(" · ");
  const tone = r.noMatch || r.uncited ? "text-neg" : "text-muted";
  const what: Record<string, string> = { matched: "matches", computed: "computed with calc", no_match: "not found in the cited source", text_only: "cited from text, not checked", uncited: "no citation" };
  return (
    <details className="mt-2 border-t border-line pt-1.5 text-[10.5px]">
      <summary className={`cursor-pointer select-none ${tone}`}>{sumUp}</summary>
      <ul className="mt-1 space-y-0.5 text-muted">
        {r.figures.map((f, k) => (
          <li key={k} className="flex flex-wrap gap-x-1.5">
            <span className={`num ${f.status === "no_match" || f.status === "uncited" ? "text-neg" : "text-fg"}`}>{f.raw}</span>
            {f.cites.length > 0 && <span className="num text-accent">{f.cites.join(", ")}</span>}
            <span>{what[f.status]}{f.field ? `: ${f.field}${f.period ? `, to ${f.period}` : ""}` : ""}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

"use client";

import { useState } from "react";
import type { Command } from "@/lib/functions";
import type { CreditView, DebtView } from "@/lib/terminal/fundamentals";
import type { WaccView } from "@/lib/terminal/wacc";
import { AiRead, AskAi, BarList, DataTable, fm, fn, fp, Frame, fx, Hint, Histogram, Pill, SeriesChart, Section, Tile, Tiles, Tornado, useTerminal, Why } from "../kit";

type Props = { ticker: string; onRun?: (c: Command) => void };
const ZONE: Record<string, "pos" | "warn" | "neg"> = { safe: "pos", grey: "warn", distress: "neg" };

/** IRAT: an implied credit rating from three models that disagree in useful ways, with default odds. */
export function IratScreen({ ticker, onRun }: Props) {
  const q = useTerminal<CreditView>("credit", { ticker });
  return (
    <Frame q={q} what={`${ticker} credit models`}>
      {(d) => {
        const r = d.rating;
        const latest = d.panel[d.panel.length - 1];
        return (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-elevated/50 px-3 py-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted">Implied rating</div>
                <div className="num text-[26px] font-semibold leading-none text-fg">{r.rating}</div>
              </div>
              <Pill kind={r.grade === "investment" ? "pos" : "warn"}>{r.grade} grade</Pill>
              {r.mortality && <span className="text-[11px] text-muted">Bonds first rated {r.rating.replace(/[+-]$/, "")} have defaulted at <span className="num text-fg">{fp(r.mortality.year1, 2)}</span> in year one and <span className="num text-fg">{fp(r.mortality.year5, 1)}</span> within five (Altman, 1971-2016).</span>}
              <span className="ml-auto flex items-center gap-1.5"><AiRead fn="credit" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Why do the credit models rate ${ticker} ${r.rating}? Where do they disagree, and what would move the rating?`} /></span>
            </div>
            {d.caveat && <div className="rounded-md border border-chart-emphasis/40 bg-chart-emphasis/10 px-2.5 py-1.5 text-[11px] text-fg/90">{d.caveat}</div>}
            <Hint skill="IRAT">Three models, three angles. Altman&apos;s Z&apos;&apos; reads the balance sheet and profits; Ohlson&apos;s O-score adds size and the trend in earnings; Merton reads the stock market (how far the firm&apos;s value sits above its debt, in units of volatility). The rating is the middle of their views. When they disagree, the reason is usually the story.</Hint>
            <Section title="The models">
              <div className="grid gap-2 @2xl:grid-cols-3">
                {r.zpp && (
                  <div className="rounded-md border border-line p-2.5">
                    <div className="flex items-baseline justify-between"><span className="text-[11px] font-semibold">Altman Z&apos;&apos;</span><Pill kind={ZONE[r.zpp.zone]}>{r.zpp.zone}</Pill></div>
                    <div className="num mt-1 text-[20px] font-semibold">{fn(r.zpp.value)}</div>
                    <div className="text-[10.5px] text-muted">safe above 2.60, distress below 1.10</div>
                    <div className="num mt-1.5 grid grid-cols-2 gap-x-2 text-[10.5px] text-muted">{Object.entries(r.zpp.inputs).map(([k, v]) => <span key={k}>{k} {fn(v, 3)}</span>)}</div>
                  </div>
                )}
                {r.o && (
                  <div className="rounded-md border border-line p-2.5">
                    <div className="flex items-baseline justify-between"><span className="text-[11px] font-semibold">Ohlson O-score</span><Pill kind={ZONE[r.o.zone]}>{r.o.zone}</Pill></div>
                    <div className="num mt-1 text-[20px] font-semibold">{fp(r.o.pd, 2)}</div>
                    <div className="text-[10.5px] text-muted">probability of failure within a year (O = {fn(r.o.value)})</div>
                    <div className="num mt-1.5 grid grid-cols-3 gap-x-2 text-[10.5px] text-muted">{Object.entries(r.o.inputs).map(([k, v]) => <span key={k}>{k} {fn(v, 2)}</span>)}</div>
                  </div>
                )}
                {r.merton ? (
                  <div className="rounded-md border border-line p-2.5">
                    <div className="flex items-baseline justify-between"><span className="text-[11px] font-semibold">Merton distance to default</span><Pill kind={r.merton.dd > 3 ? "pos" : r.merton.dd > 1.5 ? "warn" : "neg"}>{fn(r.merton.dd, 1)} σ</Pill></div>
                    <div className="num mt-1 text-[20px] font-semibold">{fp(r.merton.pd, 3)}</div>
                    <div className="text-[10.5px] text-muted">one-year default probability, from the stock&apos;s volatility</div>
                    <div className="num mt-1.5 grid grid-cols-2 gap-x-2 text-[10.5px] text-muted"><span>asset vol {fp(r.merton.assetVol)}</span><span>equity vol {fp(r.merton.equityVol)}</span><span>debt face {fm(r.merton.debtFace / 1e6)}</span><span>drift {fp(r.merton.mu)}</span></div>
                  </div>
                ) : <div className="rounded-md border border-dashed border-line p-2.5 text-[11px] text-muted">Merton needs a year of prices and a market value; not available for this ticker on the current data plan.</div>}
              </div>
            </Section>
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Section title="Each view as a rating">
                <DataTable rows={r.views} rowKey={(v) => v.method} columns={[
                  { key: "m", label: "Model", align: "left", value: (v) => v.method, render: (v) => <span title={v.excluded}>{v.method}{v.excluded && <span className="ml-1 text-[10px] text-chart-emphasis">left out</span>}</span> },
                  { key: "r", label: "Rating", value: (v) => v.rating, render: (v) => <span className={`font-semibold ${v.excluded ? "text-faint line-through" : ""}`}>{v.rating}</span> },
                  { key: "d", label: "Reading", value: (v) => v.detail },
                ]} />
                {r.views.filter((v) => v.excluded).map((v) => <div key={v.method} className="mt-1 text-[10.5px] text-chart-emphasis">{v.method} left out: {v.excluded}</div>)}
                {d.market.volSource === "range" && <div className="mt-1 text-[10.5px] text-muted">Merton uses volatility estimated from the 52-week high and low (Parkinson), because daily prices are not on the current data plan: a rough input.</div>}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Tile label="EBIT / interest" value={fx(d.coverage.ebitToInterest, 1)} />
                  <Tile label="Debt / EBITDA" value={fx(d.coverage.debtToEbitda, 1)} />
                </div>
              </Section>
              <Section title="Z'' and O-score over time">
                <SeriesChart x={d.history.map((h) => `FY${h.fy}`)} format={(v) => v.toFixed(1)} height={170}
                  lines={[{ name: "Altman Z''", values: d.history.map((h) => h.zpp) }, { name: "O-score", values: d.history.map((h) => h.o), color: "var(--chart-emphasis)" }]}
                  refs={[{ value: 2.6, label: "Z'' safe" }, { value: 1.1, label: "Z'' distress" }]} />
              </Section>
            </div>
            {latest && <div className="text-[10.5px] text-faint">Latest fiscal year FY{latest.fy} (ended {latest.end}) · total assets {fm((latest.totalAssets ?? 0) / 1e6)} · liabilities {fm((latest.totalLiabilities ?? 0) / 1e6)}</div>}
            <Why items={[
              ["Altman Z'' (1995)", "6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4: working capital, retained earnings and EBIT over assets, book equity over liabilities. Mapped to a rating through Altman's median scores by S&P rating (1996), taking the nearest median."],
              ["Ohlson O-score (1980)", "A logit on nine accounting ratios; size uses assets in 1968 dollars. Ohlson's own cut-off for a likely failure is a probability of 3.8%."],
              ["Merton, naive (Bharath and Shumway 2008)", "Debt at face (short-term plus half of long-term), debt volatility 5% + 25% of equity volatility, drift equal to last year's return, one-year horizon."],
              ["Rating bands", "Model probabilities of default map to ratings at the geometric means of S&P's long-run one-year default rates, with market-implied probabilities floored at one basis point. The implied rating is the median of the views that apply (the midpoint of two, rounded to the more cautious notch); the mortality line uses Altman's rated-bond table."],
              ["Limits", "All three models were fitted on industrial companies decades ago. Z'' misreads negative retained earnings from buybacks as losses (such views are left out); accounting models are harsh on loss-making growth companies; naive Merton is generous to leveraged but stable companies."],
            ]} sources={["SEC XBRL company facts", "Prices: Financial Modeling Prep", "Altman (2018), fifty-year Z-score retrospective"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** DDIS: when the debt comes due, against the cash to meet it. */
export function DdisScreen({ ticker, onRun }: Props) {
  const q = useTerminal<DebtView>("debt", { ticker });
  return (
    <Frame q={q} what={`${ticker} debt maturities`}>
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <Tiles>
            <Tile label="Scheduled maturities" value={fm(d.total)} sub={d.asOf ? `as of ${d.asOf}` : undefined} />
            <Tile label="Due in 12 months" value={fm(d.ladder.find((l) => l.bucket === "Next 12 months")?.amount ?? 0)} sub={d.nearTermShare !== null ? `${fp(d.nearTermShare, 0)} of the total` : undefined} />
            <Tile label="Cash" value={fm(d.cash)} />
            <Tile label="Operating cash flow" value={fm(d.cfo)} sub="last fiscal year" />
            <Tile label="Interest" value={fm(d.interest)} />
            <Tile label="EBIT / interest" value={fx(d.coverage, 1)} />
          </Tiles>
          <div className={`rounded-md border px-2.5 py-1.5 text-[11.5px] ${/refinancing risk/.test(d.runway) ? "border-neg/40 bg-neg/10" : /year two/.test(d.runway) ? "border-chart-emphasis/40 bg-chart-emphasis/10" : "border-pos/30 bg-pos/10"}`}>{d.runway}</div>
          <Hint skill="DDIS">The ladder is principal due each year from the latest annual report. Set it against cash on hand plus a year of operating cash flow: what those cannot cover must be refinanced, at today&apos;s rates.</Hint>
          <Section title="Maturity ladder, USD millions" right={<AskAi onRun={onRun} ticker={ticker} question={`Assess ${ticker}'s refinancing risk: the maturity wall, liquidity, and what refinancing at today's rates would do to interest cost.`} />}>
            <BarList format={(v) => fm(v)} rows={d.ladder.map((l) => ({ label: l.bucket, value: l.amount }))} />
            {!d.ladder.length && <div className="text-[11px] text-muted">No maturity schedule in XBRL. Look in the debt footnote: <button type="button" className="text-accent hover:underline" onClick={() => onRun?.({ ticker, fn: "CAP", via: "click" })}>CAP</button> or <button type="button" className="text-accent hover:underline" onClick={() => onRun?.({ ticker, fn: "FIL", via: "click" })}>FIL</button>.</div>}
          </Section>
          <Why items={[["Source", "The five-year principal repayment schedule companies tag in their 10-K (LongTermDebtMaturitiesRepaymentsOfPrincipal...). Revolver draws and commercial paper may sit outside it."]]} sources={["SEC XBRL company facts"]} />
        </div>
      )}
    </Frame>
  );
}

/** WACC: the cost of capital from its parts, with a Monte Carlo range and what drives it. */
export function WaccScreen({ ticker, onRun }: Props) {
  const [erp, setErp] = useState(5);
  const [method, setMethod] = useState<"blume" | "welch">("blume");
  const q = useTerminal<WaccView>("wacc", { ticker, erp: erp / 100, beta: method });
  return (
    <Frame q={q} what={`${ticker} cost of capital`}>
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-elevated/50 px-3 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">WACC</div>
              <div className="num text-[26px] font-semibold leading-none">{fp(d.wacc, 2)}</div>
            </div>
            <div className="text-[11px] text-muted">80% range <span className="num text-fg">{fp(d.range.p10, 1)} to {fp(d.range.p90, 1)}</span> across the uncertain inputs</div>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted">Equity risk premium
              <input type="number" step={0.25} min={2} max={10} value={erp} onChange={(e) => setErp(Number(e.target.value) || 5)} className="num w-16 ctl border border-line bg-bg px-1.5 py-0.5 text-right text-fg" />%
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted">Beta
              <select value={method} onChange={(e) => setMethod(e.target.value as "blume" | "welch")} className="ctl border border-line bg-bg px-1 py-0.5 text-fg">
                <option value="blume">2y weekly, Blume</option><option value="welch">1y daily, Welch</option>
              </select>
            </label>
          </div>
          <Tiles>
            <Tile label="Cost of equity" value={fp(d.costOfEquity, 2)} sub={`${fp(d.riskFree.value, 2)} + ${fn(d.beta.adjusted)} × ${fp(d.erp, 2)}`} />
            <Tile label="Risk-free (10y)" value={fp(d.riskFree.value, 2)} sub={d.riskFree.date ?? "assumed"} />
            <Tile label="Beta" value={fn(d.beta.adjusted)} sub={d.beta.fallback ? "assumed (no prices)" : `${d.beta.window} · ±${fn(d.beta.se)}`} />
            <Tile label="Cost of debt" value={fp(d.debt.cost, 2)} sub={d.debt.method === "rating" ? `${d.debt.rating} implied: Tsy + ${(d.debt.spread * 1e4).toFixed(0)} bp` : d.debt.method === "effective" ? "interest / average debt" : "Tsy + 200 bp assumed"} />
            <Tile label="After tax" value={fp(d.afterTaxDebt, 2)} sub={`tax shield ${fp(d.tax.shield, 0)}${d.tax.effective !== null ? ` · effective ${fp(d.tax.effective, 0)}` : ""}`} />
            <Tile label="Debt / capital" value={fp(d.weights.debt, 1)} sub={`${fm(d.weights.debtAmount)} debt · ${fm(d.weights.marketCap)} equity`} />
          </Tiles>
          {d.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <Hint skill="WACC">WACC blends what shareholders and lenders expect, weighted by how much of each the company uses. The range comes from drawing the inputs nobody knows exactly (beta, the risk premium, the credit spread, the leverage) thousands of times. Use the range in a DCF, not just the point.</Hint>
          <div className="grid gap-4 @3xl:grid-cols-2">
            <Section title="Distribution of WACC (4,000 draws)">
              <Histogram bins={d.range.histogram} format={(v) => fp(v, 1)} markers={[{ value: d.wacc, label: "base" }]} />
            </Section>
            <Section title="What moves it (10th to 90th percentile of each input)" right={<span className="flex gap-1.5"><AiRead fn="wacc" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Pressure-test ${ticker}'s WACC of ${(d.wacc * 100).toFixed(1)}%: is the beta, risk premium and cost of debt reasonable for this business?`} /></span>}>
              <Tornado rows={d.drivers} base={d.wacc} format={(v) => fp(v, 2)} />
            </Section>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <button type="button" onClick={() => onRun?.({ ticker, fn: "BETA", via: "click" })} className="ctl border border-line px-2 py-0.5 text-muted hover:border-accent/50 hover:text-fg">Beta detail (BETA)</button>
            <button type="button" onClick={() => onRun?.({ ticker, fn: "IRAT", via: "click" })} className="ctl border border-line px-2 py-0.5 text-muted hover:border-accent/50 hover:text-fg">Implied rating (IRAT)</button>
            <button type="button" onClick={() => onRun?.({ ticker, fn: "TOOL", arg: "dcf", via: "click" })} className="ctl border border-line px-2 py-0.5 text-muted hover:border-accent/50 hover:text-fg">Run a DCF</button>
          </div>
          <Why items={[
            ["Cost of equity", "CAPM: risk-free rate plus beta times the equity risk premium. Unlevered beta at this leverage: " + fn(d.unleveredBeta) + " (Hamada)."],
            ["Cost of debt", "The Treasury rate plus an approximate long-run spread for the rating the credit models imply; the effective rate on existing debt is compared in the notes. Spreads are defaults, not a live feed."],
            ["Monte Carlo", "Beta ~ normal with its standard error; premium ~ triangular ±1 point; spread ~ triangular 0.7x to 1.6x; debt weight ~ triangular ±30%. The tornado moves one input at a time to its 10th and 90th percentile."],
          ]} sources={["U.S. Treasury par yield curve", "SEC XBRL company facts", "Prices: Financial Modeling Prep"]} />
        </div>
      )}
    </Frame>
  );
}


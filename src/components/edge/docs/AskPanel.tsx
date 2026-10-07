"use client";

/**
 * Ask: a question over a chosen scope (companies' filings, the person's uploads and recordings, their
 * workspace, the Newsroom archive, the live web), strict or balanced, in the answer shape that fits.
 * Progress streams while sources are read and passages found; earlier questions stay one click away.
 * Premium options (a stronger model, exact-span citations, one question across several companies) show
 * with their plan badge for everyone; the server decides, and a plan without them gets its message in
 * line with a link to the plans.
 */
import { Check, CircleStop, History, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Select } from "@/components/ui/Select";
import { ago, api, useApi, useNow } from "@/components/news/client";
import { AnswerView } from "./AnswerView";
import { askBatchStream, askStream, directOf, FORM_OPTIONS, SOURCE_OPTIONS, warmReranker, type DocAnswer, type ViewTarget } from "./client";

/** One company's answer in a comparison across companies. */
type BatchRow = { ticker: string; state: "waiting" | "reading" | "done" | "failed" | "skipped"; message?: string; answer?: DocAnswer; error?: string };

type Recent = { answers: { id: number; question: string; mode: string; createdAt: string; notFound: boolean }[] };
export type AskScope = { docIds: number[]; label: string } | null;

const EXAMPLES = [
  "What did management say about volumes and guidance in the latest quarter?",
  "List every risk in my uploaded data room with where it is stated",
  "How has the dividend policy been described over the last year?",
];

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-2 py-0.5 text-[11.5px] transition ${on ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{children}</button>;
}

export function AskPanel({ onCite, scope, clearScope, suggestTickers, openAnswer, preset }: {
  onCite: (t: ViewTarget) => void; scope: AskScope; clearScope: () => void; suggestTickers: string[];
  openAnswer?: number | null; preset?: { question: string; key: number; tickers?: string[]; sources?: string[] } | null;
}) {
  const now = useNow();
  const [question, setQuestion] = useState(preset?.question ?? "");
  const [tickers, setTickers] = useState<string[]>(preset?.tickers ?? []);
  const [tickerText, setTickerText] = useState("");
  const [sources, setSources] = useState<string[]>(preset?.sources ?? ["sec", "uploads", "audio"]);
  const [forms, setForms] = useState<string[]>(["10-K", "10-Q", "8-K"]);
  const [months, setMonths] = useState("12");
  const [mode, setMode] = useState<"balanced" | "strict">("balanced");
  const [form, setForm] = useState("auto");
  const [run, setRun] = useState<{ steps: string[]; started: number } | null>(null);
  const [answer, setAnswer] = useState<DocAnswer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [premium, setPremium] = useState({ model: false, citations: false });
  const [each, setEach] = useState(false);
  const [batch, setBatch] = useState<BatchRow[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recent = useApi<Recent>("/api/edge/answers");
  const reloadRecent = recent.reload;

  // The free reranker sleeps when idle; waking it now means the first question usually finds it ready.
  useEffect(() => { warmReranker(); }, []);

  // An answer asked for by link (?answer=ID), e.g. from a canvas's answer block.
  useEffect(() => {
    if (!openAnswer) return;
    let live = true;
    api<DocAnswer>(`/api/edge/answers/${openAnswer}`).then((a) => { if (live) setAnswer(a); }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [openAnswer]);

  const addTickers = (text: string) => {
    const add = text.toUpperCase().split(/[\s,;]+/).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t));
    if (add.length) setTickers((cur) => [...new Set([...cur, ...add])].slice(0, 6));
    setTickerText("");
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || run) return;
    const pending = tickerText.trim() ? [...new Set([...tickers, ...tickerText.toUpperCase().split(/[\s,;]+/).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t))])].slice(0, 6) : tickers;
    if (tickerText.trim()) { setTickers(pending); setTickerText(""); }
    setError(null); setAnswer(null); setBatch(null);
    abort.current = new AbortController();
    if (each && !scope && pending.length >= 2) {
      // Each company separately (premium): rows fill in as their answers arrive.
      const rows = new Map<string, BatchRow>(pending.map((t) => [t, { ticker: t, state: "waiting" }]));
      const show = () => setBatch([...rows.values()]);
      const patch = (t: string, p: Partial<BatchRow>) => { const r = rows.get(t); if (r) { rows.set(t, { ...r, ...p }); show(); } };
      show();
      setRun({ steps: [`Asking ${pending.length} companies, two at a time`], started: Date.now() });
      try {
        await askBatchStream({ question: q, tickers: pending, mode, forms, months: Number(months), premium }, (e) => {
          if ("progress" in e) patch(e.progress.ticker, { state: "reading", message: e.progress.message });
          else if ("result" in e) patch(e.result.ticker, { state: "done", answer: e.result.answer });
          else if ("failed" in e) patch(e.failed.ticker, { state: "failed", error: e.failed.error });
          else if ("skipped" in e) patch(e.skipped.ticker, { state: "skipped" });
        }, abort.current.signal);
        reloadRecent();
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") { setError(e); setBatch(null); }
      } finally {
        setRun(null);
        abort.current = null;
      }
      return;
    }
    setRun({ steps: ["Gathering the documents in scope"], started: Date.now() });
    try {
      const a = await askStream({
        question: q, mode, form: form as "auto", premium,
        scope: scope ? { docIds: scope.docIds, sources: ["uploads"] } : { tickers: pending, sources, forms, months: Number(months) },
      }, (m) => setRun((r) => (r && r.steps[r.steps.length - 1] !== m ? { ...r, steps: [...r.steps, m] } : r)), abort.current.signal);
      setAnswer(a);
      reloadRecent();
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setError(e);
    } finally {
      setRun(null);
      abort.current = null;
    }
  };

  const secOn = sources.includes("sec") && !scope;
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const suggestions = suggestTickers.filter((t) => !tickers.includes(t)).slice(0, 6);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="panel space-y-3 p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={2000} placeholder={EXAMPLES[0]}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void ask(); } }}
              className="ctl min-h-[52px] flex-1 resize-y border border-line bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent/60" aria-label="Question" />
            {run
              ? <button type="button" onClick={() => abort.current?.abort()} className="ctl flex items-center justify-center gap-1.5 border border-line px-3 py-2 text-[12.5px] sm:self-start"><CircleStop className="h-3.5 w-3.5" />Stop</button>
              : <button type="submit" disabled={!question.trim()} className="ctl flex items-center justify-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50 sm:self-start"><Search className="h-3.5 w-3.5" />Ask</button>}
          </div>

          {scope ? (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-muted">Only in</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent-soft px-2 py-0.5 text-accent">{scope.label}<button type="button" onClick={clearScope} aria-label="Search everything instead"><X className="h-3 w-3" /></button></span>
            </div>
          ) : (
            <div className="space-y-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-[76px] shrink-0 text-muted">Companies</span>
                {tickers.map((t) => <span key={t} className="num inline-flex items-center gap-1 rounded-full border border-line bg-elevated/60 px-2 py-0.5 text-[11.5px]">{t}<button type="button" onClick={() => setTickers((c) => c.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button></span>)}
                <input value={tickerText} onChange={(e) => setTickerText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addTickers(tickerText); } }} onBlur={() => tickerText && addTickers(tickerText)}
                  placeholder={tickers.length ? "Add" : "Tickers, e.g. ET TRGP"} className="ctl w-[140px] border border-line bg-bg px-2 py-0.5 text-[12px] uppercase outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/60" aria-label="Add tickers" />
                {suggestions.map((t) => <button key={t} type="button" onClick={() => setTickers((c) => [...c, t].slice(0, 6))} className="num rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">+ {t}</button>)}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-[76px] shrink-0 text-muted">Sources</span>
                {SOURCE_OPTIONS.map((s) => <Toggle key={s.value} on={sources.includes(s.value)} onClick={() => setSources((c) => flip(c, s.value))}>{s.label}</Toggle>)}
              </div>
              {secOn && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[76px] shrink-0 text-muted">Filings</span>
                  {FORM_OPTIONS.map((f) => <Toggle key={f} on={forms.includes(f)} onClick={() => setForms((c) => flip(c, f))}>{f === "DEF 14A" ? "Proxy" : f}</Toggle>)}
                  <Select value={months} onChange={setMonths} aria-label="Look back" className="ctl border border-line bg-bg px-2 py-0.5 text-left text-[11.5px]">
                    <option value="3">last 3 months</option><option value="6">last 6 months</option><option value="12">last 12 months</option><option value="24">last 2 years</option><option value="36">last 3 years</option>
                  </Select>
                </div>
              )}
              {secOn && !tickers.length && !tickerText.trim() && <p className="text-[11px] text-faint">Add a company to search its filings; Edge reads them the first time they are asked about.</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2 text-[12px]">
            <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Strictness">
              {(["balanced", "strict"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-0.5 text-[11.5px] ${mode === m ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{m === "balanced" ? "Balanced" : "Strict"}</button>
              ))}
            </div>
            <span className="text-[11px] text-muted">{mode === "strict" ? "Every claim quotes a passage; anything unsupported is removed, and a missing answer says “not found”." : "Quoted claims first; inference is allowed and marked as analysis."}</span>
            <span className="ml-auto flex items-center gap-1.5 text-muted">Answer as
              <Select value={form} onChange={setForm} aria-label="Answer as" className="ctl border border-line bg-bg px-2 py-0.5 text-left text-[11.5px] text-fg">
                <option value="auto">whatever fits</option><option value="direct">a direct answer</option><option value="table">a table</option><option value="timeline">a timeline</option><option value="memo">a memo</option>
              </Select>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="w-[76px] shrink-0 text-muted">Premium</span>
            <Toggle on={premium.model} onClick={() => setPremium((p) => ({ ...p, model: !p.model }))}>Stronger model</Toggle>
            <PremiumBadge feature="edge.answer-model" />
            <Toggle on={premium.citations} onClick={() => setPremium((p) => ({ ...p, citations: !p.citations }))}>Exact-span citations</Toggle>
            <PremiumBadge feature="edge.citations" />
            {!scope && tickers.length >= 2 && <><Toggle on={each} onClick={() => setEach((v) => !v)}>Each company separately</Toggle><PremiumBadge feature="edge.batch-ask" /></>}
            {premium.citations && <span className="text-[11px] text-faint">Answers come as a direct answer and cited points.</span>}
            {each && !scope && tickers.length >= 2 && <span className="text-[11px] text-faint">Each company is answered from its own filings, two at a time.</span>}
          </div>
          {!question && !answer && !run && <div className="flex flex-wrap gap-1.5">{EXAMPLES.slice(1).map((x) => <button key={x} type="button" onClick={() => setQuestion(x)} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">{x}</button>)}</div>}
        </form>

        {run && (
          <div className="panel p-3" aria-live="polite">
            <ol className="space-y-1.5 text-[12.5px]">
              {run.steps.map((s, i) => (
                <li key={`${i}-${s}`} className="rise flex items-center gap-2">
                  {i < run.steps.length - 1 ? <Check className="h-3.5 w-3.5 text-pos" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                  <span className={i < run.steps.length - 1 ? "text-muted" : ""}>{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-faint">Reading a company&apos;s filings for the first time takes a minute or two; later questions are quicker.</p>
          </div>
        )}
        {!!error && <PlanNotice error={error} />}
        {batch && (
          <div className="panel divide-y divide-line" aria-live="polite">
            {batch.map((b) => (
              <div key={b.ticker} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
                <span className="num w-[64px] shrink-0 font-semibold">{b.ticker}</span>
                <div className="min-w-0 flex-1">
                  {b.state === "done" && b.answer ? (
                    <>
                      <p className="leading-snug">{b.answer.notFound ? <span className="text-muted">Not found in its filings.</span> : directOf(b.answer)}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{b.answer.claims.length} cited claim{b.answer.claims.length === 1 ? "" : "s"} from {new Set(b.answer.citations.map((c) => c.docId)).size} document{new Set(b.answer.citations.map((c) => c.docId)).size === 1 ? "" : "s"}</p>
                    </>
                  ) : b.state === "failed" ? <p className="text-neg">{b.error}</p>
                    : b.state === "skipped" ? <p className="text-muted">Not reached in this run; ask again for this company.</p>
                      : <p className="flex items-center gap-1.5 text-muted"><Loader2 className="h-3 w-3 animate-spin" />{b.message ?? "Waiting its turn"}</p>}
                </div>
                {b.answer && <button type="button" onClick={() => setAnswer(b.answer!)} className="text-[11.5px] text-accent hover:underline">Open</button>}
              </div>
            ))}
          </div>
        )}
        {answer && <AnswerView a={answer} onCite={onCite} />}
      </div>

      <aside className="space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold"><History className="h-3.5 w-3.5 text-muted" />Earlier questions</div>
        {!recent.data ? (recent.error ? <p className="text-[11.5px] text-neg">{recent.error} <button type="button" onClick={reloadRecent} className="text-accent hover:underline">Try again</button></p> : <div className="h-24 animate-pulse rounded-md bg-elevated/40" />) : !recent.data.answers.length ? <p className="text-[11.5px] text-muted">Your questions and their cited answers are kept here.</p> : (
          <ul className="space-y-1">
            {recent.data.answers.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setError(null); api<DocAnswer>(`/api/edge/answers/${r.id}`).then(setAnswer).catch((e) => setError(e)); }} className={`w-full rounded-md border px-2 py-1.5 text-left transition hover:border-accent/50 ${answer?.answerId === r.id ? "border-accent/50 bg-accent-soft/30" : "border-line"}`}>
                  <div className="line-clamp-2 text-[12px]">{r.question}</div>
                  <div className="mt-0.5 text-[10.5px] text-muted">{r.mode === "strict" ? "Strict" : "Balanced"}{r.notFound ? " · not found" : ""}{now ? ` · ${ago(r.createdAt, now)}` : ""}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

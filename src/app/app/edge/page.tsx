import { after } from "next/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { edgeProfile } from "@/lib/edge/access";
import { EdgeWorkspace, type EdgeView } from "@/components/edge/EdgeWorkspace";
import { whatIfFrom } from "@/lib/edge/links";
import { edgeFeed } from "@/lib/edge/feed";
import { onboardEdge } from "@/lib/edge/onboard";
import { edgeState } from "@/lib/edge/state";
import type { EdgeState, FeedData } from "@/components/edge/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edge" };
// The first visit's canvas and watch checks run after the response, inside this budget.
export const maxDuration = 60;

const VIEWS = new Set<EdgeView>(["feed", "canvases", "documents", "networks", "scenarios", "map", "whatif", "deals", "pulse", "radar", "calls", "theses", "track"]);

/**
 * Edge: ?view=feed|canvases|documents|networks|scenarios|map|whatif|deals|pulse|radar|calls|theses|track; Pulse, Deal
 * Radar and Call Desk open a company with &ticker=; Scenarios opens the LBO Stress Lab with &tab=lbo(&ticker=);
 * Theses opens one with &thesis=ID. Documents also opens a saved answer
 * (&answer=ID) or a company's change radar (&radar=TICKER&form=10-K|10-Q); Networks opens a company
 * (&company=TICKER); the what-if starts drawn for a deal (&parties=ET,TRGP&place=permian). The first
 * visit pins the tab and seeds starter watches; the first canvas and checks run after the response.
 */
export default async function EdgePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const p = await edgeProfile(user.id);
  if (!p) redirect("/onboarding");
  const rest = await onboardEdge(user).catch(() => null);
  if (rest) after(rest);
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const view = one(q.view);
  const answer = Number(one(q.answer)) || null;
  const radar = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(one(q.radar)) ? { ticker: one(q.radar).toUpperCase(), form: one(q.form) === "10-Q" ? "10-Q" : "10-K", section: one(q.section) || "risk" } : null;
  const docs = answer || radar ? { tab: radar ? ("radar" as const) : ("ask" as const), answer, radar, key: 1 } : null;
  const company = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(one(q.company)) ? one(q.company).toUpperCase() : null;
  const deal = whatIfFrom(one(q.parties), one(q.place));
  const ticker = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(one(q.ticker)) ? one(q.ticker).toUpperCase() : null;
  const tab = one(q.tab) === "lbo" ? "lbo" : null;
  const thesis = Number(one(q.thesis)) || null;
  const initialView = docs ? "documents" : company ? "networks" : deal ? "whatif" : VIEWS.has(view as EdgeView) ? (view as EdgeView) : "feed";
  // The person's Edge (and, opening on the feed, its first page) go out with the page, shaped exactly as
  // the API sends them (dates as strings), so the first paint needs no further request.
  const plain = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;
  const state = await edgeState(user.id, p.prefs.beta, p.prefs.since, p.prefs.blend).then((s) => plain(s) as EdgeState).catch(() => undefined);
  const feed = state && initialView === "feed" ? await edgeFeed(user.id, state.watches, p.prefs.blend, { scope: "all", limit: 20 }).then((f) => plain({ ...f, generatedAt: new Date().toISOString() }) as FeedData).catch(() => undefined) : undefined;
  return <EdgeWorkspace initialView={initialView} initialDocs={docs} initialCompany={company} initialDeal={deal} initialTicker={ticker} initialTab={tab} initialThesis={thesis} initialState={state} initialFeed={feed} seededAt={new Date().toISOString()} />;
}

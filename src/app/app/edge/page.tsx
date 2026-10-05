import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { edgeProfile } from "@/lib/edge/access";
import { EdgeIntro } from "@/components/edge/BetaToggle";
import { EdgeWorkspace, type EdgeView } from "@/components/edge/EdgeWorkspace";
import { whatIfFrom } from "@/lib/edge/links";
import { edgeFeed } from "@/lib/edge/feed";
import { edgeState } from "@/lib/edge/state";
import type { EdgeState, FeedData } from "@/components/edge/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edge" };

const VIEWS = new Set<EdgeView>(["feed", "canvases", "documents", "networks", "scenarios", "map", "whatif", "track"]);

/**
 * Edge: ?view=feed|canvases|documents|networks|scenarios|map|whatif|track. Documents also opens a saved answer
 * (&answer=ID) or a company's change radar (&radar=TICKER&form=10-K|10-Q); Networks opens a company
 * (&company=TICKER); the what-if starts drawn for a deal (&parties=ET,TRGP&place=permian). Before the
 * beta is on, the page explains Edge and offers the switch.
 */
export default async function EdgePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const p = await edgeProfile(user.id);
  if (!p?.prefs.beta) return <EdgeIntro />;
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const view = one(q.view);
  const answer = Number(one(q.answer)) || null;
  const radar = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(one(q.radar)) ? { ticker: one(q.radar).toUpperCase(), form: one(q.form) === "10-Q" ? "10-Q" : "10-K", section: one(q.section) || "risk" } : null;
  const docs = answer || radar ? { tab: radar ? ("radar" as const) : ("ask" as const), answer, radar, key: 1 } : null;
  const company = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(one(q.company)) ? one(q.company).toUpperCase() : null;
  const deal = whatIfFrom(one(q.parties), one(q.place));
  const initialView = docs ? "documents" : company ? "networks" : deal ? "whatif" : VIEWS.has(view as EdgeView) ? (view as EdgeView) : "feed";
  // The person's Edge (and, opening on the feed, its first page) go out with the page, shaped exactly as
  // the API sends them (dates as strings), so the first paint needs no further request.
  const plain = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;
  const state = await edgeState(user.id, p.prefs.beta, p.prefs.since, p.prefs.blend).then((s) => plain(s) as EdgeState).catch(() => undefined);
  const feed = state && initialView === "feed" ? await edgeFeed(user.id, state.watches, p.prefs.blend, { scope: "all", limit: 20 }).then((f) => plain({ ...f, generatedAt: new Date().toISOString() }) as FeedData).catch(() => undefined) : undefined;
  return <EdgeWorkspace initialView={initialView} initialDocs={docs} initialCompany={company} initialDeal={deal} initialState={state} initialFeed={feed} seededAt={new Date().toISOString()} />;
}

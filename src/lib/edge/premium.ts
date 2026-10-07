/**
 * Edge's upgrades beyond the free tiers, in one list: what each improves, what it costs, and the
 * settings that make it possible. Two things decide whether one runs:
 * - the environment: nothing here can cost anything until its key or switch is set; until then Edge
 *   uses its free method for everyone;
 * - the plan: an upgrade that names a premium `feature` (lib/billing/features/premium.ts) runs only for
 *   people whose plan includes it (and administrators), and only inside work they asked for, through
 *   the premium scope (lib/billing/use.ts). Crons, monitors and prefetches never open that scope, so
 *   scheduled work stays on the free methods even with every key set.
 * Upgrades without a feature are platform settings (a free key, a budget, a site licence) that apply
 * to everyone. All are built; docs/edge-roadmap.md has the background. Prices are list prices checked
 * on 30 September 2026.
 */

import { featureById } from "@/lib/billing/features";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { premiumOn } from "@/lib/billing/use";

export type UpgradeModule = "earth" | "documents" | "networks" | "scenarios" | "platform";

export type Upgrade = {
  id: string;
  module: UpgradeModule;
  name: string;
  /** What gets better, in a sentence. */
  improves: string;
  /** What it costs, and any free allowance. */
  cost: string;
  /** Environment settings that must all be set (names only; values never leave the server). */
  needs: string[];
  /** An optional switch that turns it on, for upgrades that reuse a key Edge already has: this value, or any value when null. */
  flag?: { name: string; value: string | null };
  /** Whether the code is in place, so setting `needs` (and `flag`) is all it takes. */
  built: boolean;
  /** The premium feature that decides who may use it; absent for platform settings that apply to everyone. */
  feature?: string;
  /** What to do, in order. */
  steps: string[];
};

export const UPGRADES: Upgrade[] = [
  // Documents
  {
    id: "rerank-voyage", module: "documents", name: "Voyage rerank-3", built: true, feature: "edge.rerank",
    improves: "Reranks the passages behind every answer with a cross-encoder before the model reads them, so the quotes come from the right paragraphs (the largest single gain in published finance retrieval tests).",
    cost: "$0.05 per million tokens (rerank-3-lite $0.02); the first 200 million tokens are free. A card on file lifts the 3 requests a minute limit and opts out of training.",
    needs: ["VOYAGE_API_KEY"], steps: ["Create an account at voyageai.com and add a card (no charge inside the free 200M tokens).", "Create an API key and set VOYAGE_API_KEY in Vercel (Production).", "Redeploy. Answers then say 'reranked by Voyage' in their method."],
  },
  {
    id: "rerank-cohere", module: "documents", name: "Cohere Rerank 4", built: true, feature: "edge.rerank",
    improves: "The same reranking step with Cohere's model, if Voyage is not wanted. Used only when Voyage is not set.",
    cost: "$2.00 to $2.50 per 1,000 searches. Trial keys may not be used in production.",
    needs: ["COHERE_API_KEY"], steps: ["Create a production key at dashboard.cohere.com.", "Set COHERE_API_KEY in Vercel (Production) and redeploy."],
  },
  {
    id: "answer-model", module: "documents", name: "A larger model for document answers", built: true, feature: "edge.answer-model",
    improves: "Answers across long filings with a stronger model (for example gpt-5.6-sol) in place of the default, for harder multi-period questions.",
    cost: "Uses the OpenAI key Edge already has: gpt-5.6-sol is $4 in / $20 out per million tokens, roughly 10 to 20 times the default per answer.",
    needs: ["OPENAI_API_KEY"], flag: { name: "EDGE_ANSWER_MODEL", value: null },
    steps: ["Set EDGE_ANSWER_MODEL=gpt-5.6-sol in Vercel (any model id the account can use).", "Redeploy. People whose plan includes it see 'Stronger model' under Ask; it is used only for the questions they tick it on. The daily AI spend limits still apply."],
  },
  {
    id: "transcribe-openai", module: "documents", name: "Speaker-labelled transcripts (OpenAI)", built: true, feature: "edge.transcribe-diarize",
    improves: "Earnings calls and meetings transcribed by gpt-4o-transcribe-diarize with who said what, so tone and quotes can be read by speaker (the free path: Parakeet or Whisper on the ML service, with speakers guessed from the words).",
    cost: "$0.006 a minute of audio (an hour-long call is about $0.36), on the OpenAI key Edge already has.",
    needs: ["OPENAI_API_KEY"], flag: { name: "EDGE_TRANSCRIBE", value: "openai" },
    steps: ["Set EDGE_TRANSCRIBE=openai in Vercel (it uses the OpenAI key Edge already has) and redeploy.", "People whose plan includes it see 'Transcribe with speaker labels' when importing a recording and on each recording in the library; nothing is sent to OpenAI unless they choose it.", "MP3 and WAV recordings of any length go in 12 MB pieces; other formats up to 24 MB (longer ones stay on the free path)."],
  },
  {
    id: "parse-llamaparse", module: "documents", name: "LlamaParse for hard PDFs", built: true, feature: "edge.parse-llamaparse",
    improves: "Scanned and table-heavy PDFs (data rooms, CIMs) read by LlamaParse's agentic tier with layout and tables intact (the free path: the ML service's parser with OCR).",
    cost: "10,000 credits a month free, then $1.25 per 1,000 credits; the agentic tier is 10 credits a page (LLAMAPARSE_TIER changes it: fast 1, cost_effective 3, agentic_plus 45).",
    needs: ["LLAMA_CLOUD_API_KEY"], steps: ["Create a key at cloud.llamaindex.ai and set LLAMA_CLOUD_API_KEY in Vercel, then redeploy.", "People whose plan includes it see 'Read with LlamaParse' when uploading and on each PDF in the library (useful when the free reading missed tables or a scan); nothing is sent to LlamaParse unless they choose it.", "Files up to 50 MB go to LlamaParse; larger ones stay on the free path."],
  },
  {
    id: "citations-anthropic", module: "documents", name: "Anthropic Citations", built: true, feature: "edge.citations",
    improves: "Answers whose quotes are returned by the model as exact spans of the source passages (no quote can drift from the text), through the Messages API with citations on.",
    cost: "Claude Sonnet 5.5 (the default) $2 in / $10 out per million tokens; Haiku 4.5 $1 / $5 with EDGE_CITATIONS_MODEL=claude-haiku-4-5. Quoted text is not billed as output.",
    needs: ["ANTHROPIC_API_KEY"], flag: { name: "EDGE_CITATIONS", value: "anthropic" },
    steps: ["Set ANTHROPIC_API_KEY and EDGE_CITATIONS=anthropic in Vercel and redeploy (optionally EDGE_CITATIONS_MODEL).", "People whose plan includes it see 'Exact-span citations' under Ask. Those answers come as a direct answer and cited points (citations cannot be combined with the table and timeline shapes)."],
  },
  // Earth
  {
    id: "planet", module: "earth", name: "Planet imagery (3 m daily, 50 cm on request)", built: true, feature: "edge.planet",
    improves: "Lists the sharper PlanetScope (3 m) and SkySat (50 cm) scenes of a plant from the last 60 days with under 20% cloud, with thumbnails, beside Sentinel-2's 10 m, so a change can be checked at a finer scale. Thumbnails come through YouBank, so the key stays on the server.",
    cost: "Searching and thumbnails come with any Planet account. Full scenes are bought by area: PlanetScope about $2.25/km² (250 km² minimum), SkySat archive $6/km² (25 km² minimum).",
    needs: ["PLANET_API_KEY"], steps: ["Get a Planet account (a trial or Education and Research account works for search).", "Set PLANET_API_KEY in Vercel and redeploy. A plant's panel on the map then lists its Planet scenes under 'Sharper imagery (Planet)'."],
  },
  {
    id: "firms-archive", module: "earth", name: "FIRMS archive (flaring history)", built: true,
    improves: "Fills each plant's flaring record back twelve weeks at once, so the first flaring cards already say whether a flare is new or chronic.",
    cost: "Free: a NASA FIRMS MAP_KEY (5,000 requests per 10 minutes).",
    needs: ["FIRMS_MAP_KEY"], steps: ["Request a MAP_KEY at firms.modaps.eosdis.nasa.gov/api/map_key (free, email only).", "Set FIRMS_MAP_KEY in Vercel. The next daily pass backfills the record once."],
  },
  {
    id: "methane-carbonmapper", module: "earth", name: "Carbon Mapper methane plumes", built: true,
    improves: "Methane plumes from the Tanager and EMIT satellites (and Carbon Mapper's aircraft) within 2 km of watched plants in the last 90 days, each overpass a card with the emission rate in kg/h, its uncertainty and the plume picture (about 1,100 Permian plumes since 2025). Nothing is fetched until the switch is set.",
    cost: "The data is free to read but licensed for non-commercial use; YouBank needs a commercial agreement with Carbon Mapper (price on request).",
    needs: ["CARBON_MAPPER_LICENSED"], steps: ["Agree commercial terms with Carbon Mapper (a site licence: the methane cards are shared findings everyone with Edge sees, and reading them costs nothing per call, so the daily pass reads them for the watched plants).", "Set CARBON_MAPPER_LICENSED=1 (and CARBON_MAPPER_TOKEN if they issue one) in Vercel and redeploy. The next daily pass reads the last 90 days, and methane cards join the feed under 'Methane'."],
  },
  {
    id: "nightfire", module: "earth", name: "EOG Nightfire flare volumes", built: true, feature: "edge.nightfire",
    improves: "A plant's flares in the Colorado School of Mines' VIIRS Nightfire files over the last nights, with radiant heat and an estimated flared volume (EOG's calibration, 0.0274 billion m\u00b3 a year per MW), in place of radiant heat alone.",
    cost: "A signed data use licence; commercial users pay a negotiated yearly fee. Reading the nightly files costs nothing more.",
    needs: ["NIGHTFIRE_USER", "NIGHTFIRE_PASSWORD"], steps: ["Sign the Earth Observation Group's commercial licence and register an account at eogdata.mines.edu.", "Set NIGHTFIRE_USER and NIGHTFIRE_PASSWORD in Vercel (NIGHTFIRE_CLIENT_SECRET only if EOG issues a different download client) and redeploy.", "People whose plan includes it see 'Flare volumes (Nightfire)' on a plant's panel; files are read only when they press it, and each night's file is kept a week."],
  },
  // Networks
  {
    id: "graph-gpu", module: "networks", name: "GPU training for the deal model", built: true, feature: "edge.graph-gpu",
    improves: "Retrains the deal model on a GPU with a wider network and more passes, on request (the weekly and event retraining stay on CPU inside the free Modal credits).",
    cost: "Modal T4 $0.59/h, L4 $0.80/h, A100-40GB $2.10/h beyond the $30 monthly credit; a run is about 15 minutes.",
    needs: ["EDGE_ML_GPU"], steps: ["Redeploy the ML service (modal deploy ml/edge_ml.py) so its graph.train.gpu task exists.", "Set EDGE_ML_GPU=1 in Vercel, raise EDGE_MODAL_MONTHLY_USD if needed, and redeploy.", "People whose plan includes it see 'Retrain on a GPU' on the deal model's scorecard; nothing runs on a GPU unless they press it."],
  },
  // Scenarios
  {
    id: "timesfm-bigquery", module: "scenarios", name: "TimesFM forecasts", built: true, feature: "edge.timesfm",
    improves: "Forecasts of the scenario drivers (oil, gas, rates, the market) from Google's TimesFM foundation model through BigQuery's AI.FORECAST, with 10-90% bands (the free path: a drift and volatility forecast from the same history). The open weights are non-commercial; BigQuery is the licensed route.",
    cost: "BigQuery ML prediction rates: $6.25 per TiB with a 10 MB minimum, about $0.0001 a forecast.",
    needs: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS_JSON"], steps: ["In Google Cloud, enable the BigQuery API on a project with billing and create a service account with the BigQuery Job User role.", "Set GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS_JSON (the key file's JSON) in Vercel; optionally TIMESFM_MODEL (default 'TimesFM 2.5') and BIGQUERY_LOCATION (default US). Redeploy.", "People whose plan includes it see 'Forecast with TimesFM' under Scenarios' drivers; nothing is sent to BigQuery unless they press it."],
  },
  // Platform
  {
    id: "modal-budget", module: "platform", name: "A larger ML budget", built: true,
    improves: "More satellite checks, document parsing and training per month before Edge falls back to its built-in methods.",
    cost: "Modal bills compute beyond the $30 monthly credit: CPU $0.047 per core-hour.",
    needs: ["EDGE_MODAL_MONTHLY_USD"], steps: ["Set EDGE_MODAL_MONTHLY_USD (default 25) to the monthly ceiling you accept, and add a card in Modal."],
  },
  {
    id: "docs-storage", module: "platform", name: "More document storage", built: true,
    improves: "Room for many more uploaded documents and passages (Neon's free plan stops at 512 MB per branch).",
    cost: "Neon's paid plans bill storage and compute by use (neon.com/pricing).",
    needs: ["EDGE_DOCS_DB_MB"], steps: ["Move the Neon project to a paid plan.", "Set EDGE_DOCS_DB_MB (default 180) to the room you want Edge's documents to use."],
  },
];

const isSet = (name: string) => !!process.env[name]?.trim();

/**
 * Whether an upgrade is set up: built, its settings set, and its switch (if any) on. This says only
 * that it can run; whether it runs for a person is `paidOn`.
 */
export function upgradeOn(id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || !u.built) return false;
  if (!u.needs.every(isSet)) return false;
  if (!u.flag) return true;
  const v = process.env[u.flag.name]?.trim();
  return u.flag.value === null ? !!v : v === u.flag.value;
}

/**
 * Whether an upgrade runs now: set up (`upgradeOn`) and, when it names a premium feature, inside a
 * premium scope that holds it (a person whose plan includes it asked for this work). Background work
 * has no scope, so it gets the free method.
 */
export function paidOn(id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || !upgradeOn(id)) return false;
  return !u.feature || premiumOn(u.feature);
}

/** The upgrade behind a premium feature, for routes that start it (one feature may have several, e.g. two rerankers). */
export const upgradesFor = (featureId: string) => UPGRADES.filter((u) => u.feature === featureId);

/** Whether any upgrade behind a feature is set up, so asking for it can work. */
export const featureReady = (featureId: string) => upgradesFor(featureId).some((u) => upgradeOn(u.id));

/**
 * Throw a plain 409 when a person asks for an upgrade YouBank has not set up yet (its key is missing),
 * so they hear that instead of silently getting the free method. Call after the plan check.
 */
export function requireReady(featureId: string): void {
  if (featureReady(featureId)) return;
  const f = featureById(featureId);
  throw Object.assign(new Error(`${f?.name ?? "This upgrade"} is not switched on yet. An administrator needs to set it up first.`), { status: 409 });
}

export type UpgradeStatus = Omit<Upgrade, "needs" | "flag"> & { on: boolean; needs: { name: string; set: boolean }[]; flag: { name: string; value: string | null; set: boolean } | null };

/** Every upgrade with whether it is on and which settings are present (names only). For administrators. */
export function upgradesReport(): UpgradeStatus[] {
  return UPGRADES.map((u) => ({
    ...u, on: upgradeOn(u.id), needs: u.needs.map((name) => ({ name, set: isSet(name) })),
    flag: u.flag ? { ...u.flag, set: isSet(u.flag.name) } : null,
  }));
}

/**
 * An upgrade as a person sees it: what it improves and costs, whether YouBank has it set up, and
 * whether their plan includes it. Administrators also get the settings and steps (names only, never
 * values); everyone else never sees them.
 */
export type UpgradeView = Pick<Upgrade, "id" | "module" | "name" | "improves" | "cost" | "built" | "feature"> & {
  ready: boolean;
  plan: { feature: string; name: string; minPlan: PlanId; planName: string; unlocked: boolean } | null;
  setup?: Pick<UpgradeStatus, "needs" | "flag" | "steps" | "on">;
};

export function upgradesView(e: { features: string[]; admin: boolean }): UpgradeView[] {
  const has = new Set(e.features);
  return UPGRADES.map((u) => {
    const f = u.feature ? featureById(u.feature) : undefined;
    const view: UpgradeView = {
      id: u.id, module: u.module, name: u.name, improves: u.improves, cost: u.cost, built: u.built, ...(u.feature ? { feature: u.feature } : {}), ready: upgradeOn(u.id),
      plan: f ? { feature: f.id, name: f.name, minPlan: f.minPlan, planName: PLANS[f.minPlan].name, unlocked: has.has(f.id) } : null,
    };
    if (e.admin) view.setup = { on: upgradeOn(u.id), needs: u.needs.map((name) => ({ name, set: isSet(name) })), flag: u.flag ? { ...u.flag, set: isSet(u.flag.name) } : null, steps: u.steps };
    return view;
  });
}

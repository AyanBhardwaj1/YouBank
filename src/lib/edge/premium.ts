/**
 * Edge's upgrades beyond the free tiers, in one list: what each improves, what it costs, and the
 * settings that turn it on. Nothing here costs anything until its key or switch is set in the
 * environment; until then Edge uses its free method. Upgrades marked `built` have their code in place
 * (setting the key is the whole job); the rest are planned (docs/edge-roadmap.md has the steps).
 * Prices are list prices checked on 30 September 2026.
 */

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
  /** What to do, in order. */
  steps: string[];
};

export const UPGRADES: Upgrade[] = [
  // Documents
  {
    id: "rerank-voyage", module: "documents", name: "Voyage rerank-3", built: true,
    improves: "Reranks the passages behind every answer with a cross-encoder before the model reads them, so the quotes come from the right paragraphs (the largest single gain in published finance retrieval tests).",
    cost: "$0.05 per million tokens (rerank-3-lite $0.02); the first 200 million tokens are free. A card on file lifts the 3 requests a minute limit and opts out of training.",
    needs: ["VOYAGE_API_KEY"], steps: ["Create an account at voyageai.com and add a card (no charge inside the free 200M tokens).", "Create an API key and set VOYAGE_API_KEY in Vercel (Production).", "Redeploy. Answers then say 'reranked by Voyage' in their method."],
  },
  {
    id: "rerank-cohere", module: "documents", name: "Cohere Rerank 4", built: true,
    improves: "The same reranking step with Cohere's model, if Voyage is not wanted. Used only when Voyage is not set.",
    cost: "$2.00 to $2.50 per 1,000 searches. Trial keys may not be used in production.",
    needs: ["COHERE_API_KEY"], steps: ["Create a production key at dashboard.cohere.com.", "Set COHERE_API_KEY in Vercel (Production) and redeploy."],
  },
  {
    id: "answer-model", module: "documents", name: "A larger model for document answers", built: true,
    improves: "Answers across long filings with a stronger model (for example gpt-5.6-sol) in place of the default, for harder multi-period questions.",
    cost: "Uses the OpenAI key Edge already has: gpt-5.6-sol is $4 in / $20 out per million tokens, roughly 10 to 20 times the default per answer.",
    needs: ["OPENAI_API_KEY"], flag: { name: "EDGE_ANSWER_MODEL", value: null },
    steps: ["Set EDGE_ANSWER_MODEL=gpt-5.6-sol in Vercel (any model id the account can use).", "Redeploy. The daily AI spend limits still apply."],
  },
  {
    id: "transcribe-openai", module: "documents", name: "Speaker-labelled transcripts (OpenAI)", built: false,
    improves: "Earnings calls and meetings transcribed with who said what, so tone and quotes can be read by speaker (today: Whisper small on the ML service, no speaker labels).",
    cost: "$0.006 a minute of audio (an hour-long call is about $0.36), on the OpenAI key Edge already has.",
    needs: ["OPENAI_API_KEY"], flag: { name: "EDGE_TRANSCRIBE", value: "openai" },
    steps: ["Planned: route audio uploads to gpt-4o-transcribe-diarize in 25 MB pieces.", "Then set EDGE_TRANSCRIBE=openai."],
  },
  {
    id: "parse-llamaparse", module: "documents", name: "LlamaParse for hard PDFs", built: false,
    improves: "Scanned and table-heavy PDFs (data rooms, CIMs) read with layout and tables intact.",
    cost: "10,000 credits a month free, then $1.25 per 1,000 credits.",
    needs: ["LLAMA_CLOUD_API_KEY"], steps: ["Planned: send PDFs the built-in parser flags as hard to LlamaParse, keep the rest on the ML service.", "Then create a key at cloud.llamaindex.ai and set LLAMA_CLOUD_API_KEY."],
  },
  {
    id: "citations-anthropic", module: "documents", name: "Anthropic Citations", built: false,
    improves: "Answers whose quotes are returned by the model as exact spans of the source (no quote can drift from the text).",
    cost: "Claude Haiku 4.5 $1 in / $5 out per million tokens; Sonnet 5.5 $2 / $10. Quoted text is not billed as output.",
    needs: ["ANTHROPIC_API_KEY"], flag: { name: "EDGE_CITATIONS", value: "anthropic" },
    steps: ["Planned: an answer path through the Messages API with citations on (it cannot be combined with structured output).", "Then set ANTHROPIC_API_KEY and EDGE_CITATIONS=anthropic."],
  },
  // Earth
  {
    id: "planet", module: "earth", name: "Planet imagery (3 m daily, 50 cm on request)", built: true,
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
    needs: ["CARBON_MAPPER_LICENSED"], steps: ["Agree commercial terms with Carbon Mapper.", "Set CARBON_MAPPER_LICENSED=1 (and CARBON_MAPPER_TOKEN if they issue one) in Vercel and redeploy. The next daily pass reads the last 90 days, and methane cards join the feed under 'Methane'."],
  },
  {
    id: "nightfire", module: "earth", name: "EOG Nightfire flare volumes", built: false,
    improves: "Flared gas volumes per flare from the Colorado School of Mines' Nightfire product, in place of radiant heat alone.",
    cost: "A signed data use licence; commercial users pay a negotiated yearly fee.",
    needs: ["NIGHTFIRE_USER", "NIGHTFIRE_PASSWORD"], steps: ["Sign the Earth Observation Group's commercial licence.", "Planned: read the nightly flare files and attach volumes to flaring cards."],
  },
  // Networks
  {
    id: "graph-gpu", module: "networks", name: "GPU training for the deal model", built: false,
    improves: "Room for larger graph models and nightly retraining on the full graph (today: CPU training inside the free Modal credits).",
    cost: "Modal T4 $0.59/h, L4 $0.80/h, A100-40GB $2.10/h beyond the $30 monthly credit.",
    needs: ["EDGE_ML_GPU"], steps: ["Planned: a GPU variant of graph.train on the ML service.", "Then set EDGE_ML_GPU=1 and raise EDGE_MODAL_MONTHLY_USD."],
  },
  // Scenarios
  {
    id: "timesfm-bigquery", module: "scenarios", name: "TimesFM 3.0 forecasts", built: false,
    improves: "Forecasts of the scenario drivers (oil, gas, rates) from the top-ranked time-series model, whose open weights are non-commercial.",
    cost: "Only through BigQuery (AI.FORECAST), billed at BigQuery rates.",
    needs: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS_JSON"], steps: ["Planned: a BigQuery forecast adapter beside the free Chronos-2 path."],
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

/** Whether an upgrade is on: built, its settings set, and its switch (if any) on. */
export function upgradeOn(id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || !u.built) return false;
  if (!u.needs.every(isSet)) return false;
  if (!u.flag) return true;
  const v = process.env[u.flag.name]?.trim();
  return u.flag.value === null ? !!v : v === u.flag.value;
}

export type UpgradeStatus = Omit<Upgrade, "needs" | "flag"> & { on: boolean; needs: { name: string; set: boolean }[]; flag: { name: string; value: string | null; set: boolean } | null };

/** Every upgrade with whether it is on and which settings are present (names only). */
export function upgradesReport(): UpgradeStatus[] {
  return UPGRADES.map((u) => ({
    ...u, on: upgradeOn(u.id), needs: u.needs.map((name) => ({ name, set: isSet(name) })),
    flag: u.flag ? { ...u.flag, set: isSet(u.flag.name) } : null,
  }));
}

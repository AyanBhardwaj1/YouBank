/**
 * The models Edge's own steps use, in one place. The small model reads, sorts and summarises (plans,
 * descriptions, briefs, topic names); EDGE_SMALL_MODEL overrides it. gpt-6-luna does that work at half
 * the price of gpt-5.6-luna (list prices checked 30 September 2026).
 */
export const EDGE_SMALL_MODEL = () => process.env.EDGE_SMALL_MODEL?.trim() || "gpt-6-luna";

/** The small model at low effort, as `structured()` takes it. */
export const small = (effort: "low" | "medium" = "low") => ({ model: EDGE_SMALL_MODEL(), effort });

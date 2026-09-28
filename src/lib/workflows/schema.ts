/**
 * Runtime schemas for tool output: what the model must return, and what a saved run is checked
 * against. Kept apart from types.ts so pages that only list or render tools never load zod.
 */
import { z } from "zod";

export const Tone = z.enum(["pos", "neg", "neutral", "warn", "info"]);
export type Tone = z.infer<typeof Tone>;
export const NumFormat = z.enum(["money", "x", "pct", "num", "int", "bps"]);
export type NumFormat = z.infer<typeof NumFormat>;

const cell = z.union([z.string(), z.number(), z.null()]);

export const OutputBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("kpis"), title: z.string().optional(), items: z.array(z.object({ label: z.string(), value: z.string(), delta: z.string().optional(), tone: Tone.optional(), hint: z.string().optional() })) }),
  z.object({ type: z.literal("table"), title: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(cell)), note: z.string().optional(), emphasisRow: z.number().int().optional(), totals: z.array(cell).optional() }),
  z.object({ type: z.literal("markdown"), title: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("bullets"), title: z.string().optional(), items: z.array(z.string()), ordered: z.boolean().optional() }),
  z.object({ type: z.literal("bar"), title: z.string().optional(), data: z.array(z.object({ label: z.string(), value: z.number().nullable(), emphasis: z.boolean().optional(), note: z.string().optional() })), format: NumFormat.optional(), reference: z.object({ value: z.number(), label: z.string() }).optional() }),
  z.object({ type: z.literal("columns"), title: z.string().optional(), data: z.array(z.object({ label: z.string(), value: z.number() })), format: NumFormat.optional() }),
  z.object({ type: z.literal("line"), title: z.string().optional(), series: z.array(z.object({ name: z.string(), points: z.array(z.object({ x: z.string(), y: z.number().nullable() })) })), format: NumFormat.optional() }),
  z.object({ type: z.literal("waterfall"), title: z.string().optional(), steps: z.array(z.object({ label: z.string(), value: z.number(), total: z.boolean().optional() })), format: NumFormat.optional() }),
  z.object({ type: z.literal("scatter"), title: z.string().optional(), points: z.array(z.object({ label: z.string(), x: z.number().nullable(), y: z.number().nullable(), emphasis: z.boolean().optional() })), xLabel: z.string(), yLabel: z.string(), xFormat: NumFormat.optional(), yFormat: NumFormat.optional() }),
  z.object({ type: z.literal("timeline"), title: z.string().optional(), items: z.array(z.object({ date: z.string(), label: z.string(), detail: z.string().optional(), tone: Tone.optional() })) }),
  z.object({ type: z.literal("checklist"), title: z.string().optional(), items: z.array(z.object({ text: z.string(), done: z.boolean().optional(), owner: z.string().optional(), due: z.string().optional() })) }),
  z.object({ type: z.literal("risks"), title: z.string().optional(), items: z.array(z.object({ risk: z.string(), severity: z.enum(["high", "medium", "low"]), mitigation: z.string().optional() })) }),
  z.object({ type: z.literal("callout"), tone: Tone, title: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("sensitivity"), title: z.string().optional(), rowLabel: z.string(), colLabel: z.string(), rows: z.array(z.string()), cols: z.array(z.string()), values: z.array(z.array(z.number().nullable())), format: NumFormat.optional(), baseRow: z.number().int().optional(), baseCol: z.number().int().optional() }),
  z.object({ type: z.literal("steps"), title: z.string().optional(), items: z.array(z.object({ title: z.string(), detail: z.string().optional() })) }),
  z.object({ type: z.literal("qa"), title: z.string().optional(), items: z.array(z.object({ q: z.string(), a: z.string() })) }),
  z.object({ type: z.literal("email"), subject: z.string(), body: z.string(), to: z.string().optional() }),
  z.object({ type: z.literal("score"), title: z.string().optional(), items: z.array(z.object({ label: z.string(), score: z.number(), max: z.number().optional(), note: z.string().optional() })) }),
]);
export type OutputBlock = z.infer<typeof OutputBlock>;

export const WorkflowOutput = z.object({
  title: z.string(),
  summary: z.string().describe("Two to four sentences: the conclusion first."),
  blocks: z.array(OutputBlock),
  nextSteps: z.array(z.string()).optional(),
  caveats: z.array(z.string()).optional(),
});
export type WorkflowOutput = z.infer<typeof WorkflowOutput>;

/** JSON schema handed to the model as the response format. */
export const WORKFLOW_OUTPUT_JSON_SCHEMA = z.toJSONSchema(WorkflowOutput) as Record<string, unknown>;

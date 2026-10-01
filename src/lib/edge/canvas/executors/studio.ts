/**
 * Push to Studio: everything wired in goes to a Studio model (a new one when none is named) as sheets
 * and slides that wait for review there. Nothing lands until someone with edit rights accepts it, and an
 * accepted push is undone like any agent run.
 */
import { createPush, type PushItem } from "../../push";
import { register } from "../engine";
import { kindOfValue, type Answer, type Memo, type Ranking, type Scenario, type Signal, type Table } from "../values";

const LABEL: Record<string, (v: unknown) => string> = {
  findings: () => "Ground changes", proforma: () => "Pro-forma", graph: () => "Network", answer: (v) => (v as Answer).question.slice(0, 40),
  ranking: (v) => (v as Ranking).finding, scenario: (v) => (v as Scenario).title, table: (v) => (v as Table).title || "Table",
  memo: (v) => (v as Memo).title, signal: (v) => (v as Signal).metric,
};

/** The model a block's target field names: an id, or a Studio link with one. Pure. */
export function studioTarget(text: unknown): number | null {
  const m = String(text ?? "").match(/(?:studio\/)?(\d{1,9})\s*$/);
  return m ? Number(m[1]) : null;
}

register("out.studio", {
  async start(ctx) {
    const items: PushItem[] = (ctx.inputs.in ?? []).flatMap((v) => {
      const kind = kindOfValue(v) ?? "";
      return LABEL[kind] ? [{ kind, label: LABEL[kind](v).slice(0, 60), value: v }] : [];
    });
    if (!items.length) throw Object.assign(new Error("Wire in findings, a deal, a network, a ranking, a scenario, a table, an answer or a memo to push to Studio."), { status: 400 });
    const memo = items.find((i) => i.kind === "memo")?.value as Memo | undefined;
    const title = memo?.title || `Edge: ${items.map((i) => i.label).join(", ")}`.slice(0, 120);
    const push = await createPush({ id: ctx.userId, email: "", name: "" }, { docId: studioTarget(ctx.config.target), title, source: `run:${ctx.runId}:${ctx.nodeId}`, items });
    const url = `/app/studio/${push.docId}`;
    return {
      outputs: { file: { name: title, key: "", bytes: 0, url } },
      summary: `Waiting for review in Studio (${items.length} item${items.length === 1 ? "" : "s"}): accept it there to add the sheets and slides`,
      preview: { kind: "list", items: items.map((i) => ({ label: i.label, detail: i.kind })) },
    };
  },
});

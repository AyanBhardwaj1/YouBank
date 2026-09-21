import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const models = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4-mini"];
const tools: OpenAI.Chat.ChatCompletionTool[] = [{ type: "function", function: { name: "get_company_financials", description: "Fundamentals", parameters: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] } } }];
async function main() {
for (const model of models) {
  const t0 = Date.now();
  try {
    const stream = await client.chat.completions.create({ model, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Get SNOW financials via the tool, then reply 'ok'." }], tools, stream: true });
    let text = ""; const calls: string[] = []; let first = 0;
    for await (const chunk of stream) { if (!first) first = Date.now() - t0; const d = chunk.choices[0]?.delta; if (d?.content) text += d.content; for (const tc of d?.tool_calls ?? []) if (tc.function?.name) calls.push(tc.function.name); }
    console.log(`${model}: OK tools=${calls.join(",")||"none"} text=${JSON.stringify(text.slice(0,40))} first=${first}ms total=${Date.now()-t0}ms`);
  } catch (e) { console.log(`${model}: ERR ${(e as Error).message.slice(0, 160)}`); }
  // reasoning_effort + json schema without tools
  try {
    const r = await client.chat.completions.create({ model, messages: [{ role: "user", content: "Return {\"x\":1}" }], response_format: { type: "json_schema", json_schema: { name: "t", schema: { type: "object", properties: { x: { type: "number" } }, required: ["x"], additionalProperties: false } } }, reasoning_effort: "low" });
    console.log(`  ${model} json+effort: OK ${r.choices[0]?.message?.content}`);
  } catch (e) { console.log(`  ${model} json+effort: ERR ${(e as Error).message.slice(0, 160)}`); }
}
// Responses API web_search on astra
for (const model of ["gpt-6-astra", "gpt-5.6-sol"]) {
  const t0 = Date.now();
  try {
    const res = await client.responses.create({ model, tools: [{ type: "web_search" }], input: "What was the last funding round of Anysphere (Cursor)? One line.", instructions: "Brief." });
    console.log(`${model} responses+web_search: OK ${res.output_text.slice(0, 120)} ${Date.now()-t0}ms`);
  } catch (e) { console.log(`${model} responses+web_search: ERR ${(e as Error).message.slice(0, 160)}`); }
}
}
main().catch((e) => { console.error(e); process.exit(1); });

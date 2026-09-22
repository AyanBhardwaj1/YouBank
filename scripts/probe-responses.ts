import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function main() {
  // Full error text for chat completions
  try { await client.chat.completions.create({ model: "gpt-6-astra", messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }] }); }
  catch (e) { console.log("CHAT ERR:", (e as Error).message); }
  try { const r = await client.chat.completions.create({ model: "gpt-6-astra", messages: [{ role: "user", content: "Call f then say ok" }], tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }], reasoning_effort: "none" as never }); console.log("CHAT effort=none OK:", JSON.stringify(r.choices[0].message).slice(0, 200)); }
  catch (e) { console.log("CHAT effort=none ERR:", (e as Error).message.slice(0, 200)); }

  for (const model of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    const t0 = Date.now();
    const tools: OpenAI.Responses.Tool[] = [
      { type: "function", name: "get_company_financials", description: "Fundamentals for a ticker", parameters: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"], additionalProperties: false }, strict: false },
      { type: "web_search" },
    ];
    try {
      const stream = await client.responses.create({ model, instructions: "Be brief. Use the tool for financials.", input: "Get SNOW financials via the tool, then reply with one sentence.", tools, stream: true, reasoning: { effort: "low" } });
      const types = new Map<string, number>(); let responseId = ""; const calls: { call_id: string; name: string; args: string }[] = []; let text = ""; let first = 0;
      for await (const ev of stream) {
        if (!first) first = Date.now() - t0;
        types.set(ev.type, (types.get(ev.type) ?? 0) + 1);
        if (ev.type === "response.output_text.delta") text += ev.delta;
        if (ev.type === "response.completed") { responseId = ev.response.id; for (const it of ev.response.output) if (it.type === "function_call") calls.push({ call_id: it.call_id, name: it.name, args: it.arguments }); }
      }
      console.log(`${model}: first=${first}ms total=${Date.now() - t0}ms events=${JSON.stringify([...types.entries()])} calls=${JSON.stringify(calls)} text=${JSON.stringify(text.slice(0, 80))}`);
      if (calls.length) {
        const t1 = Date.now();
        const r2 = await client.responses.create({ model, previous_response_id: responseId, input: calls.map((c) => ({ type: "function_call_output" as const, call_id: c.call_id, output: JSON.stringify({ ticker: "SNOW", ltm_revenue_usd_mm: 5435, growth: 0.27 }) })), tools, stream: false, reasoning: { effort: "low" } });
        console.log(`  follow-up: ${Date.now() - t1}ms text=${JSON.stringify(r2.output_text.slice(0, 160))} usage=${JSON.stringify(r2.usage)}`);
      }
    } catch (e) { console.log(`${model}: ERR ${(e as Error).message.slice(0, 300)}`); }
  }
  // Structured output via responses text.format
  try {
    const r = await client.responses.create({ model: "gpt-6-astra", input: "Give x=1 and a list of two tickers", text: { format: { type: "json_schema", name: "t", schema: { type: "object", properties: { x: { type: "number" }, tickers: { type: "array", items: { type: "string" } } }, required: ["x", "tickers"], additionalProperties: false }, strict: true } }, reasoning: { effort: "low" } });
    console.log("structured:", r.output_text);
  } catch (e) { console.log("structured ERR:", (e as Error).message.slice(0, 200)); }
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Models are shown a structured answer's JSON schema but do not always keep to its list limits (ask for
 * at most eight lines and nine may come back). Rather than fail the whole answer, lists are trimmed to
 * the schema's maxItems before validation; everything else is still checked strictly. Pure.
 */
type Json = Record<string, unknown>;

function resolve(s: Json, root: Json): Json {
  const ref = typeof s.$ref === "string" ? s.$ref : "";
  if (!ref.startsWith("#/")) return s;
  let at: unknown = root;
  for (const part of ref.slice(2).split("/")) at = (at as Json | undefined)?.[part];
  return (at as Json | undefined) ?? s;
}

/** A copy of `value` with every array cut to its schema's maxItems, at any depth. */
export function fitToSchema(value: unknown, schema: Json | undefined, root: Json | undefined = schema): unknown {
  if (!schema || !root || value === null || typeof value !== "object") return value;
  const s = resolve(schema, root);
  for (const key of ["anyOf", "oneOf"] as const) {
    const alts = s[key] as Json[] | undefined;
    if (!alts) continue;
    const alt = alts.map((a) => resolve(a, root)).find((a) => (Array.isArray(value) ? a.type === "array" : a.type === "object" || !!a.properties));
    return alt ? fitToSchema(value, alt, root) : value;
  }
  if (Array.isArray(value)) {
    const max = typeof s.maxItems === "number" ? s.maxItems : Infinity;
    return value.slice(0, max).map((v) => fitToSchema(v, s.items as Json | undefined, root));
  }
  const props = s.properties as Record<string, Json> | undefined;
  if (!props) return value;
  const out: Json = { ...(value as Json) };
  for (const [k, sub] of Object.entries(props)) if (k in out) out[k] = fitToSchema(out[k], sub, root);
  return out;
}

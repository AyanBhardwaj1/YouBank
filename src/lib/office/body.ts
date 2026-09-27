import { gunzipSync } from "node:zlib";

/**
 * A JSON body, which the add-in gzips when it sends a large workbook (the host caps request bodies
 * at about 4.5 MB; a snapshot compresses about tenfold). Unpacked bodies are capped at 60 MB.
 */
export async function jsonBody<T = unknown>(req: Request): Promise<T | null> {
  try {
    if (req.headers.get("x-youbank-encoding") === "gzip") {
      return JSON.parse(gunzipSync(Buffer.from(await req.arrayBuffer()), { maxOutputLength: 60_000_000 }).toString("utf8")) as T;
    }
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

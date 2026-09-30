/**
 * Cloudflare R2, Edge's file store (S3 API through aws4fetch, which is small enough for serverless).
 * The bucket is private. Uploads arrive through YouBank's API in 4 MB parts (the bucket token cannot
 * set CORS, so browsers never write to it directly); reads go through signed links that stay identical
 * for an hour so browsers and CDNs can cache them. Every operation is metered against the free tier.
 */
import { AwsClient } from "aws4fetch";
import { addUsage } from "./usage";

const env = () => ({
  account: process.env.R2_ACCOUNT_ID?.trim() ?? "", key: process.env.R2_ACCESS_KEY_ID?.trim() ?? "",
  secret: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "", bucket: process.env.R2_BUCKET?.trim() ?? "",
});

export const r2Ready = () => { const e = env(); return !!(e.account && e.key && e.secret && e.bucket); };

/** Parts of an upload are at most this big, under Vercel's request body limit. */
export const PART_BYTES = 4 * 1024 * 1024;

let client: AwsClient | null = null;
function aws(): AwsClient {
  if (!r2Ready()) throw Object.assign(new Error("File storage is not set up yet."), { status: 503 });
  if (!client) { const e = env(); client = new AwsClient({ accessKeyId: e.key, secretAccessKey: e.secret, service: "s3", region: "auto" }); }
  return client;
}

const base = () => { const e = env(); return `https://${e.account}.r2.cloudflarestorage.com/${e.bucket}`; };
const objectUrl = (key: string) => `${base()}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function call(url: string, init: RequestInit & { timeoutMs?: number }, op: "a" | "b" | "free"): Promise<Response> {
  const res = await aws().fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
  if (op !== "free") addUsage("r2", op === "a" ? "class_a" : "class_b", 1);
  return res;
}

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
  throw new Error(`R2 ${what} answered ${res.status}${body ? `: ${body}` : ""}`);
}

export async function putObject(key: string, body: Uint8Array | ArrayBuffer | string, contentType = "application/octet-stream", cacheControl?: string): Promise<void> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (cacheControl) headers["cache-control"] = cacheControl;
  const res = await call(objectUrl(key), { method: "PUT", body: body as BodyInit, headers, timeoutMs: 60_000 }, "a");
  if (!res.ok) await fail(res, `put ${key}`);
}

export const putJson = (key: string, value: unknown) => putObject(key, JSON.stringify(value), "application/json");

/** The object, or null when it does not exist. */
export async function getObject(key: string, range?: string): Promise<Response | null> {
  const res = await call(objectUrl(key), { method: "GET", headers: range ? { range } : undefined, timeoutMs: 60_000 }, "b");
  if (res.status === 404) return null;
  if (!res.ok && res.status !== 206) await fail(res, `get ${key}`);
  return res;
}

export async function getBytes(key: string): Promise<Uint8Array | null> {
  const res = await getObject(key);
  return res ? new Uint8Array(await res.arrayBuffer()) : null;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const res = await getObject(key);
  return res ? ((await res.json()) as T) : null;
}

export async function headObject(key: string): Promise<{ bytes: number; type: string } | null> {
  const res = await call(objectUrl(key), { method: "HEAD" }, "b");
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, `head ${key}`);
  return { bytes: Number(res.headers.get("content-length") ?? 0), type: res.headers.get("content-type") ?? "" };
}

export async function deleteObject(key: string): Promise<void> {
  const res = await call(objectUrl(key), { method: "DELETE" }, "free");
  if (!res.ok && res.status !== 404) await fail(res, `delete ${key}`);
}

/** Keys under a prefix (up to `max`). */
export async function listKeys(prefix: string, max = 1000): Promise<string[]> {
  const keys: string[] = [];
  let token = "";
  while (keys.length < max) {
    const qs = new URLSearchParams({ "list-type": "2", prefix, "max-keys": String(Math.min(1000, max - keys.length)) });
    if (token) qs.set("continuation-token", token);
    const res = await call(`${base()}?${qs}`, { method: "GET" }, "a");
    if (!res.ok) await fail(res, `list ${prefix}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? "") : "";
    if (!token) break;
  }
  return keys;
}

export async function deletePrefix(prefix: string): Promise<number> {
  const keys = await listKeys(prefix, 10_000);
  for (const k of keys) await deleteObject(k);
  return keys.length;
}

const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The signing time for a link: the start of the current window, so the link is the same all window long. Pure. */
export function signingTime(now: number, windowSec: number): string {
  const t = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  return t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A signed GET link valid for at least `validSec` seconds. Links are signed at the start of the hour,
 * so the same object gets the same link for an hour and caches well.
 */
export async function signedUrl(key: string, validSec = 3600, opts: { filename?: string; contentType?: string } = {}): Promise<string> {
  const windowSec = 3600;
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(validSec + windowSec));
  if (opts.filename) url.searchParams.set("response-content-disposition", `inline; filename="${opts.filename.replace(/["\\]/g, "")}"`);
  if (opts.contentType) url.searchParams.set("response-content-type", opts.contentType);
  const signed = await aws().sign(url.toString(), { method: "GET", aws: { signQuery: true, datetime: signingTime(Date.now(), windowSec) } });
  return signed.url;
}

/* ---------------- Uploads in parts ---------------- */

export const partKey = (fileKey: string, n: number) => `${fileKey}/p/${String(n).padStart(5, "0")}`;

/** A whole uploaded file, its parts joined in order (for small files; big ones are streamed). */
export async function readParts(fileKey: string, parts: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let n = 0; n < parts; n++) {
    const b = await getBytes(partKey(fileKey, n));
    if (!b) throw new Error(`Part ${n} of ${fileKey} is missing`);
    chunks.push(b); total += b.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/**
 * The byte range [start, end] of a file stored in parts of PART_BYTES (all but the last are full), as
 * the parts to read and the slice of each. Pure, for tests and for streaming audio with seeking.
 */
export function partsForRange(size: number, start: number, end: number): { n: number; from: number; to: number }[] {
  const last = Math.min(end, size - 1);
  const out: { n: number; from: number; to: number }[] = [];
  for (let n = Math.floor(start / PART_BYTES); n * PART_BYTES <= last; n++) {
    const partStart = n * PART_BYTES;
    out.push({ n, from: Math.max(0, start - partStart), to: Math.min(PART_BYTES - 1, last - partStart) });
  }
  return out;
}

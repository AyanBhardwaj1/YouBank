/**
 * Fetching from servers people type in (a CalDAV host, an ICS link) without letting them point
 * YouBank at its own network. Server only.
 *
 * Without this, "subscribe to http://169.254.169.254/latest/meta-data" would have the server read
 * cloud metadata and store it as calendar events. Every request, and every redirect hop (followed by
 * hand so each hop is checked), must be http(s) to a name that resolves only to public addresses.
 *
 * Checking a name and then letting fetch resolve it again would leave a gap (DNS rebinding: the
 * first answer is public, the second is 127.0.0.1). So the real requests go through node:http with a
 * lookup that refuses private answers at connect time: the address that was checked is the address
 * that is connected to. IP literals never reach a lookup; assertPublicUrl refuses those first.
 */
import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Fetch } from "./provider";

/** IPv6 text to its eight 16-bit groups, or null. Handles "::" and a dotted IPv4 tail. */
function ipv6Groups(ip: string): number[] | null {
  let x = ip.toLowerCase().split("%")[0];
  const v4 = x.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    x = `${x.slice(0, -v4[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = x.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * Whether an IP literal is private, loopback, link-local, carrier-grade NAT, reserved, or otherwise
 * not a public address. IPv6 forms that carry an IPv4 address (mapped ::ffff:7f00:1, compatible
 * ::7f00:1, NAT64 64:ff9b::, 6to4 2002::) are judged by that address.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (v === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    // ::/96 (unspecified, loopback, IPv4-compatible), ::ffff:0:0/96 (mapped), ::ffff:0:0:0/96 (translated).
    if (g.slice(0, 4).every((x) => x === 0) && ((g[4] === 0 && (g[5] === 0 || g[5] === 0xffff)) || (g[4] === 0xffff && g[5] === 0))) return isPrivateAddress(v4From(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || isPrivateAddress(v4From(g[6], g[7])); // NAT64, and its local-use /48
    if (g[0] === 0x2002) return isPrivateAddress(v4From(g[1], g[2])); // 6to4
    if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
    if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only
    if (g.slice(0, 4).every((x) => x === 0)) return true; // anything else in ::/64 is not a public host
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
  }
  return true;
}

/**
 * The public address to connect to for a server name people typed (a hostname or an IP literal).
 * Throws a plain error when the name is a private one, does not resolve, or any of its answers is
 * private. Connecting to the returned address (not the name again) closes the DNS-rebinding gap.
 */
export async function resolvePublicHost(name: string): Promise<string> {
  const host = name.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw Object.assign(new Error("That address points at a private network."), { status: 400 });
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error(`Could not find the server ${host}.`);
  if (addrs.some(isPrivateAddress)) throw Object.assign(new Error("That address points at a private network."), { status: 400 });
  // IPv4 first when the name has both: serverless hosts often have no IPv6 route out.
  return addrs.find((a) => isIP(a) === 4) ?? addrs[0];
}

/** Throws a plain error unless `raw` is an http(s) URL to a public host. Returns the parsed URL. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw Object.assign(new Error("That is not a web address."), { status: 400 }); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw Object.assign(new Error("Only http and https addresses can be used."), { status: 400 });
  await resolvePublicHost(u.hostname);
  return u;
}

const privateNetwork = () => Object.assign(new Error("That address points at a private network."), { code: "EPRIVATE" });

/** dns.lookup for node:http that refuses a name when any of its answers is private. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookupCb(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length) return callback(Object.assign(new Error(`Could not find the server ${hostname}.`), { code: "ENOTFOUND" }), "", 0);
    if (addresses.some((a) => isPrivateAddress(a.address))) return callback(privateNetwork(), "", 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/** Responses larger than this are cut off with an error (an ICS feed has its own, smaller limit). */
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

/**
 * A minimal fetch over node:http(s) whose connections go only to the addresses guardedLookup
 * approved. Never follows redirects (publicFetch does, checking each hop) and caps the body size.
 * String bodies only, which is all CalDAV and ICS need.
 */
export const pinnedFetch: Fetch = (input, init) => requestVia(guardedLookup, MAX_RESPONSE_BYTES, input, init);

/** pinnedFetch's machinery, with the lookup and size limit as parameters so tests can reach a local server. */
export const requestVia = (lookupFn: LookupFunction, maxBytes: number, input: string, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
  let u: URL;
  try { u = new URL(input); } catch { return reject(new Error("That is not a web address.")); }
  if (init.body != null && typeof init.body !== "string") return reject(new Error("pinnedFetch sends text bodies only."));
  const headers: Record<string, string> = { "user-agent": "YouBank-Calendar/1.0" };
  new Headers(init.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
  const method = (init.method ?? "GET").toUpperCase();
  const req = (u.protocol === "https:" ? https : http).request(u, { method, headers, lookup: lookupFn, signal: init.signal ?? undefined }, (res) => {
    const status = res.statusCode ?? 0;
    const h = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
      else if (v !== undefined) h.set(k, String(v));
    }
    if (method === "HEAD" || [204, 205, 304].includes(status)) {
      res.resume();
      try { resolve(new Response(null, { status, headers: h })); } catch (e) { reject(e); }
      return;
    }
    let size = 0, done = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const fail = (e: unknown) => { if (!done) { done = true; controller.error(e); } };
        res.on("data", (chunk: Buffer) => {
          if (done) return;
          size += chunk.length;
          if (size > maxBytes) { fail(new Error(`The server sent more than ${Math.round(maxBytes / 1048576)} MB.`)); res.destroy(); return; }
          controller.enqueue(new Uint8Array(chunk));
        });
        res.on("end", () => { if (!done) { done = true; controller.close(); } });
        res.on("error", fail);
        res.on("close", () => fail(new Error("The server closed the connection early.")));
      },
      cancel() { done = true; res.destroy(); },
    });
    try { resolve(new Response(body, { status, headers: h })); } catch (e) { res.destroy(); reject(e); }
  });
  req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EPRIVATE" ? privateNetwork() : e));
  if (typeof init.body === "string") req.write(init.body);
  req.end();
});

/**
 * `fetch` with every hop checked by assertPublicUrl, at most five redirects. Without `base` the
 * requests go through pinnedFetch, so a name cannot change its answer between the check and the
 * connection; tests pass a recorded `base`.
 */
export function publicFetch(base: Fetch = pinnedFetch): Fetch {
  return async (input, init = {}) => {
    let url = input;
    for (let hop = 0; hop < 6; hop++) {
      await assertPublicUrl(url);
      const res = await base(url, { ...init, redirect: "manual" });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) return res;
      await res.body?.cancel().catch(() => undefined);
      url = new URL(loc, url).toString();
      // A 303, or a redirected POST, becomes a GET without a body, as browsers do.
      if (res.status === 303) init = { ...init, method: "GET", body: undefined };
    }
    throw new Error("The server redirected too many times.");
  };
}

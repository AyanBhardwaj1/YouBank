/**
 * Fetching from servers people type in (a CalDAV host, an ICS link) without letting them point
 * YouBank at its own network. Server only.
 *
 * Without this, "subscribe to http://169.254.169.254/latest/meta-data" would have the server read
 * cloud metadata and store it as calendar events. Every request, and every redirect hop (followed by
 * hand so each hop is checked), must be http(s) to a name that resolves only to public addresses.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Fetch } from "./provider";

/** Whether an IP literal is private, loopback, link-local, carrier-grade NAT or otherwise not public. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

/** Throws a plain error unless `raw` is an http(s) URL to a public host. Returns the parsed URL. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That is not a web address."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https addresses can be used.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That address points at a private network.");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error(`Could not find the server ${host}.`);
  if (addrs.some(isPrivateAddress)) throw new Error("That address points at a private network.");
  return u;
}

/** `fetch` with every hop checked by assertPublicUrl, at most five redirects. */
export function publicFetch(base: Fetch = fetch): Fetch {
  return async (input, init = {}) => {
    let url = input;
    for (let hop = 0; hop < 6; hop++) {
      await assertPublicUrl(url);
      const res = await base(url, { ...init, redirect: "manual" });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) return res;
      url = new URL(loc, url).toString();
      // A 303, or a redirected POST, becomes a GET without a body, as browsers do.
      if (res.status === 303) init = { ...init, method: "GET", body: undefined };
    }
    throw new Error("The server redirected too many times.");
  };
}

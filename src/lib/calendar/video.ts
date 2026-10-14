/**
 * Finding the video link in a meeting. Pure.
 *
 * Providers put it in different places: Google in conferenceData, Microsoft in onlineMeeting, and
 * everyone else (Zoom invites, Calendly, a pasted link) in the location or the description. The
 * meeting copilot needs one answer, so this looks everywhere in a fixed order and returns the first
 * link that is a real meeting room rather than a dial-in page or a help article.
 */

const ROOMS: { name: string; re: RegExp }[] = [
  { name: "Zoom", re: /https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my|w|s)\/[^\s<>"'),]+/i },
  { name: "Google Meet", re: /https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3}(?:\?[^\s<>"']*)?/i },
  { name: "Microsoft Teams", re: /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s<>"']+/i },
  { name: "Webex", re: /https:\/\/[\w-]+\.webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s<>"']*/i },
  { name: "Whereby", re: /https:\/\/(?:[\w-]+\.)?whereby\.com\/[^\s<>"']+/i },
  { name: "Jitsi", re: /https:\/\/meet\.jit\.si\/[^\s<>"']+/i },
  { name: "Amazon Chime", re: /https:\/\/(?:app\.)?chime\.aws\/\d+/i },
  { name: "GoTo Meeting", re: /https:\/\/(?:global\.|www\.)?gotomeet(?:ing)?\.(?:com|me)\/(?:join\/)?[^\s<>"']+/i },
  { name: "Around", re: /https:\/\/(?:app\.)?around\.co\/r\/[^\s<>"']+/i },
];

/** Trailing punctuation a sentence leaves on a pasted link. */
const tidy = (url: string) => url.replace(/[.,;:!?)\]>]+$/, "").replace(/&amp;/g, "&");

/** The first meeting-room link in these texts, in the order given. Empty when there is none. */
export function findVideoLink(...texts: (string | null | undefined)[]): string {
  for (const t of texts) {
    if (!t) continue;
    for (const room of ROOMS) {
      const m = t.match(room.re);
      if (m) return tidy(m[0]);
    }
  }
  return "";
}

/** "Zoom", "Google Meet"... for a link; "Video call" for one this list does not know. */
export function videoProvider(url: string): string {
  if (!url) return "";
  return ROOMS.find((r) => r.re.test(url))?.name ?? "Video call";
}

/** Whether a pasted link is safe to write into an invitation: https only, no spaces. */
export function isUsableLink(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && !/\s/.test(url.trim());
  } catch {
    return false;
  }
}

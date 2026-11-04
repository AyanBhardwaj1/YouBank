/**
 * A contacts search asked for from the command palette while Relationships is already open: the URL's
 * ?q= is read only when the page first renders, so the palette hands the text over here. The contacts list
 * takes it when it mounts (it may load after the tab switch) or through the event when already showing.
 */
let pending: string | null = null;
export const CRM_SEARCH_EVENT = "yb:crm-search";

export function requestCrmSearch(q: string): void {
  pending = q;
  window.dispatchEvent(new CustomEvent(CRM_SEARCH_EVENT, { detail: q }));
}

/** The pending search, once. */
export function takeCrmSearch(): string | null {
  const q = pending;
  pending = null;
  return q;
}

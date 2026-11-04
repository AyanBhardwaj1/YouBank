/**
 * "Arrange Home" asked for from elsewhere (What's new): a flag Home picks up when it mounts, however long
 * its data takes, plus an event for when Home is already showing.
 */
let pending = false;
export function requestArrange(): void {
  pending = true;
  window.dispatchEvent(new Event("yb:arrange"));
}
/** True once after requestArrange, for the Home that takes it. */
export function takeArrange(): boolean {
  const p = pending;
  pending = false;
  return p;
}

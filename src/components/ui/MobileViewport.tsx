"use client";

import { useEffect } from "react";

/**
 * Tells the CSS where the on-screen keyboard is. Mounted once in the root layout.
 *
 * Phones disagree about the keyboard: Android Chrome (with `interactive-widget=resizes-content` in the
 * viewport tag) shrinks the page, so anything pinned to the bottom rises with it for free; iOS Safari
 * leaves the page full height and slides the keyboard over it, so a bar pinned to the bottom ends up
 * underneath. The visual viewport is the one thing both report truthfully, so the covered height is
 * worked out from it and published as `--kb` on <html> (0px when closed), with `data-kb="open"` while
 * the keyboard is up. Bottom bars use `bottom: var(--kb)`; the tab bar hides itself (`.hide-on-kb`).
 */
export function MobileViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    // Only a touch device has an on-screen keyboard; a short desktop window with a focused field does not.
    const touch = window.matchMedia("(pointer: coarse)");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A pinch-zoom also shrinks the visual viewport; only an unzoomed one can mean a keyboard.
        const covered = vv.scale > 1.05 ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        // Under ~120px is browser chrome sliding in and out, not a keyboard.
        const open = covered > 120 || (touch.matches && isTextField(document.activeElement) && window.innerHeight < screenHeight() * 0.72);
        root.style.setProperty("--kb", `${covered > 120 ? covered : 0}px`);
        if (open) root.setAttribute("data-kb", "open"); else root.removeAttribute("data-kb");
        // The signed-in frame shrinks to the space above the keyboard; iOS has meanwhile panned the page
        // up to show the field, which would now leave a gap and push the top bar off screen. Pan it back.
        if (covered > 120 && vv.offsetTop > 0 && document.querySelector(".app-frame")) window.scrollTo(0, 0);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      root.style.removeProperty("--kb");
      root.removeAttribute("data-kb");
    };
  }, []);
  return null;
}

/** On Android the page itself shrinks for the keyboard, so compare against the screen, not the window. */
const screenHeight = () => (window.screen?.height ? Math.min(window.screen.height, window.outerHeight || window.screen.height) : window.innerHeight);

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "range", "button", "submit", "reset", "file", "color"].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

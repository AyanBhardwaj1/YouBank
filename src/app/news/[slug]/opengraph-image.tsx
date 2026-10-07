import { ImageResponse } from "next/og";
import { publicStory, type PublicStory } from "@/lib/news/public";
import { idFromSlug } from "@/lib/news/slug";
import { figureBars } from "@/lib/news/storyviz";

/**
 * The link preview for a public story (Next's opengraph-image convention, drawn with ImageResponse):
 * the headline beside a chart from the story's own data (its price line, its deal size, its key
 * figures, or how many outlets covered it). Public data only. Rebuilt at most every ten minutes.
 */
export const alt = "A YouBank Newsroom story: the headline and a chart from its data";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 600;

const C = { bg: "#0b1020", panel: "#111833", line: "#2a3766", fg: "#e9eefb", muted: "#8b97bf", accent: "#4f8cff", accent2: "#8b7cf6", pos: "#34d399", neg: "#fb7185" };
const SECTOR: Record<string, string> = { tech: "#6d6af7", healthcare: "#14b8a6", energy: "#f59e0b", financials: "#0ea5e9", consumer: "#f43f5e", industrials: "#94a3b8", media: "#a855f7", realestate: "#10b981" };

const usd = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** The right-hand chart, 440 by 330, from the story's data. */
function Chart({ s, hue }: { s: PublicStory; hue: string }) {
  const W = 440, H = 300;
  if (s.spark && s.spark.closes.length > 1) {
    const c = s.spark.closes, min = Math.min(...c), max = Math.max(...c), r = max - min || 1;
    const pts = c.map((v, i) => [(i / (c.length - 1)) * W, 20 + (1 - (v - min) / r) * (H - 60)]);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const up = c[c.length - 1] >= c[0];
    const col = up ? C.pos : C.neg;
    return (
      <div style={{ display: "flex", flexDirection: "column", width: W }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: C.fg }}>
          <span style={{ fontWeight: 700 }}>{s.spark.ticker}</span>
          <span style={{ color: col }}>{pct(c[c.length - 1] / c[0] - 1)} 30d</span>
        </div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 12 }}>
          <path d={`${d} L${W} ${H} L0 ${H} Z`} fill={col} fillOpacity={0.16} />
          <path d={d} fill="none" stroke={col} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  if (s.deal?.valueUsd) {
    const share = Math.max(0.05, Math.min(1, (Math.log10(s.deal.valueUsd) - 7) / 4));
    return (
      <div style={{ display: "flex", flexDirection: "column", width: W }}>
        <span style={{ fontSize: 24, color: C.muted, textTransform: "capitalize" }}>{s.deal.kind.replace("_", " ")}</span>
        <span style={{ fontSize: 92, fontWeight: 800, color: C.fg, letterSpacing: -3, marginTop: 6 }}>{usd(s.deal.valueUsd)}</span>
        <div style={{ display: "flex", width: W, height: 22, borderRadius: 11, background: C.line, marginTop: 18 }}><div style={{ display: "flex", width: W * share, height: 22, borderRadius: 11, background: `linear-gradient(90deg, ${C.accent}, ${C.accent2})` }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: C.muted, marginTop: 8 }}><span>$10M</span><span>$1B</span><span>$100B</span></div>
        {s.deal.premium !== null && <span style={{ fontSize: 30, color: C.pos, marginTop: 22 }}>{pct(s.deal.premium)} premium</span>}
      </div>
    );
  }
  const bars = s.summary ? figureBars(s.summary.numbers).slice(0, 4) : [];
  if (bars.length >= 2) {
    return (
      <div style={{ display: "flex", flexDirection: "column", width: W }}>
        {bars.map((b) => (
          <div key={b.label} style={{ display: "flex", flexDirection: "column", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: C.muted }}><span>{b.label.slice(0, 26)}</span><span style={{ color: C.fg, fontWeight: 700 }}>{b.value.slice(0, 14)}</span></div>
            <div style={{ display: "flex", width: W, height: 16, borderRadius: 8, background: C.line, marginTop: 8 }}><div style={{ display: "flex", width: Math.max(10, (b.n / bars[0].n) * W), height: 16, borderRadius: 8, background: hue }} /></div>
          </div>
        ))}
      </div>
    );
  }
  const n = Math.max(1, Math.min(12, s.sourceCount));
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W }}>
      <div style={{ display: "flex", alignItems: "flex-end", height: 240 }}>
        {Array.from({ length: n }, (_, i) => <div key={i} style={{ display: "flex", width: 26, marginRight: 10, height: 60 + (i + 1) * (170 / n), borderRadius: 8, background: hue, opacity: 0.35 + 0.65 * ((i + 1) / n) }} />)}
      </div>
      <span style={{ fontSize: 28, color: C.fg, marginTop: 18 }}>{n === 1 ? "One source so far" : `Covered by ${s.sourceCount} outlets`}</span>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const id = idFromSlug((await params).slug);
  const s = id ? await publicStory(id) : null;
  const hue = SECTOR[s?.tags.find((t) => t in SECTOR) ?? ""] ?? C.accent;
  const headline = s?.headline ?? "The YouBank Newsroom";
  const fontSize = headline.length > 110 ? 44 : headline.length > 70 ? 52 : 62;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: C.bg, color: C.fg, padding: 56, fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", position: "absolute", top: -200, right: -160, width: 760, height: 760, borderRadius: 380, background: `radial-gradient(circle, ${hue}55, ${C.bg}00 70%)` }} />
        <div style={{ display: "flex", flexDirection: "column", width: 620, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 22, letterSpacing: 4, fontWeight: 700, color: C.accent }}>
              <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`, marginRight: 12 }} />YOUBANK NEWSROOM
            </div>
            <span style={{ fontSize: 22, color: hue, marginTop: 34, letterSpacing: 2, fontWeight: 700, textTransform: "uppercase" }}>{s ? s.filing?.form || s.categoryLabel : "Markets and deals"}</span>
            <span style={{ fontSize, lineHeight: 1.08, fontWeight: 700, marginTop: 12, letterSpacing: -1 }}>{headline.length > 150 ? `${headline.slice(0, 147)}…` : headline}</span>
          </div>
          <span style={{ fontSize: 22, color: C.muted }}>{s ? `${s.sourceCount} source${s.sourceCount === 1 ? "" : "s"} · ${new Date(s.firstSeenAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}` : "What moved markets and deals today"}</span>
        </div>
        <div style={{ display: "flex", marginLeft: "auto", alignItems: "center", padding: 32, borderRadius: 28, background: C.panel, border: `2px solid ${C.line}` }}>
          {s ? <Chart s={s} hue={hue} /> : <span style={{ fontSize: 30, color: C.muted, width: 380 }}>Stories with their numbers, charts and every source.</span>}
        </div>
      </div>
    ),
    { ...size },
  );
}

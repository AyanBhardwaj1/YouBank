"use client";

/**
 * YouBank brand marks, traced from the source artwork so they stay crisp at any size.
 * Colors come from theme tokens, so the logo re-tints with the active interface style:
 * the gradient runs from --accent into a blend of --accent and --info.
 */

const MARK_Y = "M202 0L214 0L219 2L223 6L224 39L220 54L211 65L121 125L115 132L112 140L112 148L114 151L114 155L112 157L112 214L114 215L114 219L112 223L112 230L110 232L106 232L67 205L61 198L59 192L59 107L62 98L8 60L1 46L0 8L5 3L4 1L26 1L27 2L23 2L23 4L32 5L38 8L40 7L39 8L41 10L45 10L44 11L47 14L51 14L50 15L53 18L68 28L72 28L72 30L78 35L109 56L113 57L191 4Z";
const MARK_BARS = ["M144 147L149 147L152 150L152 215L148 220L132 227L129 227L126 224L126 161L134 153L134 151L138 151Z", "M183 117L187 117L190 120L190 200L185 205L168 211L165 209L164 206L164 133L169 125Z", "M222 86L227 87L229 91L229 182L224 189L210 195L205 195L203 193L202 188L200 187L200 185L203 182L203 100L206 96Z"];
const VIEWBOX = "0 0 231 233";

type MarkProps = { size?: number; className?: string; id?: string; tone?: "theme" | "brand" | "mono" };

/** The Y-and-bars mark on its own. Used for the rail, the nav and the favicon. */
export function LogoMark({ size = 24, className = "", id = "yb", tone = "theme" }: MarkProps) {
  const gid = `${id}-grad`;
  const from = tone === "brand" ? "#1b63e6" : tone === "mono" ? "currentColor" : "var(--accent)";
  const to = tone === "brand" ? "#705cfc" : tone === "mono" ? "currentColor" : "color-mix(in srgb, var(--accent) 35%, var(--info))";
  return (
    <svg width={size} height={size} viewBox={VIEWBOX} role="img" aria-label="YouBank" className={className}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <path d={MARK_Y} fill={`url(#${gid})`} />
      {MARK_BARS.map((d, i) => (
        <path key={i} d={d} fill={`url(#${gid})`} opacity={0.92 - i * 0.04} />
      ))}
    </svg>
  );
}

/** Mark plus wordmark, and optionally the tagline. Scales from the nav to the hero. */
export function Logo({ size = 28, className = "", tagline = false, id = "yb-lock", tone = "theme" }: MarkProps & { tagline?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} id={id} tone={tone} />
      <span className="flex flex-col leading-none">
        <span className="font-semibold tracking-tight" style={{ fontSize: size * 0.72 }}>
          <span className="text-fg">You</span>
          <span className="text-accent">Bank</span>
        </span>
        {tagline && (
          <span className="mt-1 text-muted" style={{ fontSize: Math.max(9, size * 0.3) }}>
            The AI data platform for finance.
          </span>
        )}
      </span>
    </span>
  );
}

/** Animated entrance for the hero: the mark draws itself, then the wordmark fades up. */
export function LogoAnimated({ size = 96, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-4 ${className}`}>
      <span className="float-y"><LogoMark size={size} id="yb-hero" /></span>
      <span className="flex flex-col leading-none">
        <span className="font-semibold tracking-tight" style={{ fontSize: size * 0.62 }}>
          <span className="text-fg">You</span><span className="gradient-text">Bank</span>
        </span>
        <span className="mt-1.5 text-muted" style={{ fontSize: Math.max(11, size * 0.17) }}>The AI data platform for finance.</span>
      </span>
    </span>
  );
}

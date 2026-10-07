"use client";

/**
 * The audio briefing player: a chapter per story, play and pause, previous and next, speed, and the
 * story behind each chapter one tap away. Two voices:
 * - free: the browser's own speech (the Web Speech API) reads the chapters built from the stories'
 *   summaries; nothing is sent anywhere and nothing is spent;
 * - premium (news.audio): on a click, the server writes a spoken script with AI and a neural voice
 *   reads it; the chapters then play as audio. The plan is checked on the server; here the button
 *   shows the plan it needs when locked.
 * The daily switch (news.audio-daily, premium) makes it each morning at the brief time. Lock-screen
 * controls work through the Media Session API where the browser has it.
 */
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BriefingChapter } from "@/db/schema";
import { featureById } from "@/lib/billing/features";
import { PLANS } from "@/lib/billing/plans";
import { useFeature } from "@/lib/client/plan";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { post, useApi, useMotionLevel } from "./client";

type Chapter = BriefingChapter & { audioUrl?: string };
type Stored = { id: number | null; kind: string; slot: string; createdAt: string; model: string; voice: string; chapters: Chapter[]; note?: string };
type BriefingData = { chapters: BriefingChapter[]; stored: Stored | null; deskLabel: string; settings: { daily: boolean; voice: string; speed: number; voices: Record<string, string> }; neural: { ready: boolean; stored: boolean } };

const SPEEDS = [0.85, 1, 1.25, 1.5];
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The best English voice the browser offers: natural or neural ones first. */
function pickVoice(): SpeechSynthesisVoice | null {
  const all = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
  const en = all.filter((v) => /^en(-|_)/i.test(v.lang));
  return en.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ?? en.find((v) => /google us english|samantha|aria|jenny|guy/i.test(v.name)) ?? en.find((v) => /en-US/i.test(v.lang)) ?? en[0] ?? null;
}

export function BriefingPlayer({ onClose, onOpenCluster }: { onClose: () => void; onOpenCluster: (id: number) => void }) {
  const level = useMotionLevel();
  const { data, error, reload } = useApi<BriefingData>("/api/news/briefing");
  const aiUnlocked = useFeature("news.audio");
  const dailyUnlocked = useFeature("news.audio-daily");
  const [made, setMade] = useState<Stored | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [daily, setDaily] = useState<boolean | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [state, setState] = useState<{ ch: number; playing: boolean; progress: number }>({ ch: 0, playing: false, progress: 0 });
  const audio = useRef<HTMLAudioElement | null>(null);
  const spoken = useRef<{ ch: number; char: number }>({ ch: 0, char: 0 });
  const stopped = useRef(false);
  const playRef = useRef<(ch: number, fromChar?: number) => void>(() => undefined);

  const stored = made ?? data?.stored ?? null;
  const neural = !!stored?.chapters.some((c) => c.audioUrl);
  const chapters: Chapter[] = useMemo(() => stored?.chapters ?? data?.chapters ?? [], [stored, data]);
  const rate = speed ?? data?.settings.speed ?? 1;
  const total = chapters.reduce((n, c) => n + c.seconds, 0);
  const elapsed = chapters.slice(0, state.ch).reduce((n, c) => n + c.seconds, 0) + (chapters[state.ch]?.seconds ?? 0) * state.progress;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const stopAll = useCallback(() => {
    stopped.current = true;
    if (canSpeak) window.speechSynthesis.cancel();
    audio.current?.pause();
  }, [canSpeak]);
  useEffect(() => () => stopAll(), [stopAll]);

  const play = useCallback((ch: number, fromChar = 0) => {
    const c = chapters[ch];
    if (!c) { setState((s) => ({ ...s, playing: false })); return; }
    stopAll();
    stopped.current = false;
    setState({ ch, playing: true, progress: fromChar && c.text.length ? fromChar / c.text.length : 0 });
    const next = () => { if (!stopped.current) playRef.current(ch + 1); };
    const a = audio.current;
    if (neural && c.audioUrl && a) {
      a.src = c.audioUrl;
      a.playbackRate = rate;
      a.ontimeupdate = () => setState((s) => (s.ch === ch ? { ...s, progress: a.duration ? a.currentTime / a.duration : 0 } : s));
      a.onended = next;
      void a.play().catch(() => setState((s) => ({ ...s, playing: false })));
      return;
    }
    if (!canSpeak) { setNote("This browser cannot read aloud. The script is below."); setState((s) => ({ ...s, playing: false })); return; }
    const u = new SpeechSynthesisUtterance(c.text.slice(fromChar));
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = rate;
    spoken.current = { ch, char: fromChar };
    u.onboundary = (e) => { spoken.current = { ch, char: fromChar + e.charIndex }; setState((s) => (s.ch === ch ? { ...s, progress: (fromChar + e.charIndex) / Math.max(1, c.text.length) } : s)); };
    u.onend = next;
    window.speechSynthesis.speak(u);
  }, [chapters, neural, rate, canSpeak, stopAll]);

  useEffect(() => { playRef.current = play; }, [play]);

  const pause = useCallback(() => {
    stopAll();
    setState((s) => ({ ...s, playing: false }));
  }, [stopAll]);
  const resume = useCallback(() => {
    if (neural && audio.current && audio.current.src) { stopped.current = false; void audio.current.play(); setState((s) => ({ ...s, playing: true })); return; }
    // Speech resumes from the last word spoken, at the start of its sentence.
    const { ch, char } = spoken.current;
    const text = chapters[ch]?.text ?? "";
    const back = Math.max(0, text.lastIndexOf(". ", Math.max(0, char - 1)) + 2);
    play(ch, ch === state.ch && char > 0 ? (back > 2 ? back : 0) : 0);
  }, [neural, chapters, play, state.ch]);

  // Lock-screen and headset controls.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !chapters[state.ch]) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: chapters[state.ch].title, artist: "YouBank Newsroom", album: `${data?.deskLabel ?? "Your"} briefing` });
    navigator.mediaSession.setActionHandler("play", () => resume());
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => play(state.ch + 1));
    navigator.mediaSession.setActionHandler("previoustrack", () => play(Math.max(0, state.ch - 1)));
  }, [chapters, state.ch, data?.deskLabel, play, pause, resume]);

  const makeAi = async (remake = false) => {
    stopAll();
    setBusy(remake ? "Rewriting…" : "Writing your script and recording it…");
    setNote(null);
    try {
      const r = await post<Stored>("/api/news/briefing", { remake });
      setMade(r);
      setState({ ch: 0, playing: false, progress: 0 });
      if (r.note) setNote(r.note);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not make the briefing right now.");
    } finally { setBusy(null); }
  };
  const setDailyOn = async (on: boolean) => {
    setDaily(on);
    try { await post("/api/news/prefs", { prefs: { audio: { ...(data?.settings ?? {}), voices: undefined, daily: on, speed: rate } } }); reload(); }
    catch (e) { setDaily(!on); setNote(e instanceof Error ? e.message : "Could not change that setting."); }
  };
  const setRate = (r: number) => {
    setSpeed(r);
    if (audio.current) audio.current.playbackRate = r;
    void post("/api/news/prefs", { prefs: { audio: { daily: daily ?? data?.settings.daily ?? false, voice: data?.settings.voice ?? "marin", speed: r } } }).catch(() => undefined);
  };

  const ai = featureById("news.audio");
  const dailyOn = daily ?? data?.settings.daily ?? false;
  return (
    <motion.aside role="dialog" aria-label="Audio briefing" initial={level === "off" ? false : { y: "100%", opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }} transition={level === "off" ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 34 }}
      className="fixed inset-x-0 bottom-0 z-[55] flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[18px] border border-line-strong bg-panel shadow-float sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[440px] sm:rounded-[18px]">
      <div className="relative overflow-hidden border-b border-line p-4">
        <div className="absolute inset-0 opacity-70" style={{ background: "radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%)" }} aria-hidden />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="nr-kicker flex items-center gap-1.5"><Icon name="Headphones" className="h-3.5 w-3.5" />Your briefing</div>
            <h2 className="mt-1 truncate text-[17px] font-semibold text-fg">{data ? `${data.deskLabel}, ${fmtTime(total)}` : "Loading…"}</h2>
            <p className="mt-0.5 text-[11px] text-muted">{neural ? `Neural voice${stored?.voice ? ` (${data?.settings.voices[stored.voice]?.split(" ")[0] ?? stored.voice})` : ""}, script by AI` : stored?.model ? "AI script, read by your browser's voice" : "Read by your browser's voice, from the stories' summaries"}</p>
          </div>
          <button type="button" onClick={() => { stopAll(); onClose(); }} className="rounded-full p-1.5 text-muted hover:bg-elevated hover:text-fg" aria-label="Close the player"><Icon name="X" className="h-4 w-4" /></button>
        </div>
        <div className="relative mt-4 flex items-center gap-3">
          <button type="button" onClick={() => play(Math.max(0, state.ch - 1))} className="rounded-full p-2 text-fg hover:bg-elevated" aria-label="Previous chapter"><Icon name="SkipBack" className="h-4 w-4" /></button>
          <button type="button" onClick={() => (state.playing ? pause() : state.progress > 0 ? resume() : play(state.ch))} disabled={!chapters.length}
            className="grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-fg shadow-float transition hover:scale-105 disabled:opacity-50" aria-label={state.playing ? "Pause" : "Play"}>
            <Icon name={state.playing ? "Pause" : "Play"} className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => play(state.ch + 1)} className="rounded-full p-2 text-fg hover:bg-elevated" aria-label="Next chapter"><Icon name="SkipForward" className="h-4 w-4" /></button>
          <div className="nr-level flex h-6 items-end gap-[3px]" data-paused={!state.playing} aria-hidden>
            {[0.6, 1, 0.75, 0.9, 0.5].map((h, i) => <span key={i} className="w-[3px] rounded-full bg-accent" style={{ height: `${h * 100}%`, animationDelay: `${i * 0.13}s`, opacity: state.playing ? 1 : 0.4 }} />)}
          </div>
          <div className="ml-auto flex rounded-full border border-line p-0.5" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((r) => <button key={r} type="button" role="radio" aria-checked={rate === r} onClick={() => setRate(r)} className={`num rounded-full px-1.5 py-0.5 text-[10.5px] ${rate === r ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{r}×</button>)}
          </div>
        </div>
        <div className="relative mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${total ? (elapsed / total) * 100 : 0}%` }} /></div>
          <div className="num mt-1 flex justify-between text-[10px] text-faint"><span>{fmtTime(elapsed)}</span><span>{fmtTime(total)}</span></div>
        </div>
      </div>
      <audio ref={audio} preload="none" className="hidden" />
      <ol className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && !data && <li className="p-3 text-[12px] text-neg">{error}</li>}
        {!data && !error && [0, 1, 2, 3].map((i) => <li key={i} className="shimmer m-1 h-10 rounded-md" />)}
        {chapters.map((c, i) => (
          <li key={c.id}>
            <div className={`group flex items-start gap-2.5 rounded-lg px-2 py-2 ${i === state.ch ? "bg-accent-soft" : "hover:bg-elevated"}`}>
              <button type="button" onClick={() => play(i)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left" aria-current={i === state.ch}>
                <span className={`num mt-0.5 w-5 shrink-0 text-[11px] ${i === state.ch ? "text-accent" : "text-faint"}`}>{i === state.ch && state.playing ? <Icon name="AudioLines" className="h-3.5 w-3.5" /> : i + 1}</span>
                <span className="min-w-0">
                  <span className={`block text-[12.5px] leading-snug ${i === state.ch ? "text-fg" : "text-fg/85"}`}>{c.title}</span>
                  {i === state.ch && <span className="mt-1 line-clamp-3 block text-[11px] leading-relaxed text-muted">{c.text}</span>}
                </span>
              </button>
              <span className="num shrink-0 text-[10.5px] text-faint">{fmtTime(c.seconds)}</span>
              {c.clusterId && <button type="button" onClick={() => onOpenCluster(c.clusterId!)} className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-accent group-hover:opacity-100 focus:opacity-100" aria-label="Open this story"><Icon name="ArrowUpRight" className="h-3.5 w-3.5" /></button>}
            </div>
          </li>
        ))}
      </ol>
      <div className="space-y-2 border-t border-line p-3 text-[11.5px]">
        {note && <p className="text-muted">{note}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {aiUnlocked === false
            ? <span className="flex items-center gap-2 text-muted"><Icon name="Sparkles" className="h-3.5 w-3.5" />{ai?.name}: an AI script read by a neural voice <PremiumBadge feature="news.audio" /></span>
            : (
              <button type="button" onClick={() => makeAi(!!stored)} disabled={!!busy || aiUnlocked === null} className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 px-3 py-1.5 text-accent hover:bg-accent-soft disabled:opacity-60">
                <Icon name={busy ? "LoaderCircle" : "Sparkles"} className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ?? (stored ? "Remake with AI" : data?.neural.ready ? "Make it with the AI voice" : "Write it with AI")}
              </button>
            )}
          <label className="ml-auto flex items-center gap-2 text-fg" title={featureById("news.audio-daily")?.description}>
            <button type="button" role="switch" aria-checked={dailyOn} onClick={() => (dailyUnlocked === false && !dailyOn ? setNote(`The daily audio briefing is part of the ${PLANS[featureById("news.audio-daily")?.minPlan ?? "pro"].name} plan. Upgrade in Settings, under Plan.`) : void setDailyOn(!dailyOn))}
              className={`relative h-4 w-7 rounded-full transition ${dailyOn ? "bg-accent" : "bg-line-strong"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${dailyOn ? "left-3.5" : "left-0.5"}`} /></button>
            Every morning {dailyUnlocked === false && <PremiumBadge feature="news.audio-daily" />}
          </label>
        </div>
      </div>
    </motion.aside>
  );
}

"use client";

/**
 * The Voice Analyst (E13). A floating button: hold to talk (or press Alt+Shift+V), and Edge answers out loud
 * with its citations on screen. Speech is recognised by the browser itself and read back with its own voice,
 * so the free path costs nothing and no audio leaves the device; only the recognised words reach the server.
 * Where the browser cannot recognise speech (or the microphone is refused), a text box does the same job.
 * "Commute brief" reads the feed, the person's theses and their watched companies in turn, with lock-screen
 * controls. "Live conversation" (premium edge.voice-realtime) opens a WebRTC session with a realtime model
 * whose one tool is the same answer route; it is started only by pressing it and ends after ten minutes.
 */
import { AudioLines, Car, Loader2, Mic, Radio, Send, Square, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Sheet } from "@/components/ui/Sheet";
import { errorMessage } from "@/lib/client/errors";
import { useFeature } from "@/lib/client/plan";
import { post } from "../client";

type Citation = { label: string; url?: string };
type Answer = { intent: string; reason: string; ticker: string | null; company: string | null; script: string; citations: Citation[]; answerId: number | null; heard: string };
type Turn = { heard: string; answer: Answer | null; error?: string; at: number };

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const recognitionCtor = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

function speak(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}
const hush = () => { try { window.speechSynthesis?.cancel(); } catch { /* nothing to stop */ } };

export function VoiceButton({ tickers = [] }: { tickers?: string[] }) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [canHear, setCanHear] = useState<boolean | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const interimRef = useRef("");
  const commute = useRef<{ queue: string[]; on: boolean }>({ queue: [], on: false });

  useEffect(() => { setCanHear(!!recognitionCtor()); }, []);

  const ask = useCallback(async (text: string, opts: { quiet?: boolean; then?: () => void } = {}) => {
    const heard = text.trim();
    if (!heard) { opts.then?.(); return; }
    setBusy(true); setNote(null);
    const at = Date.now();
    setTurns((t) => [{ heard, answer: null, at }, ...t].slice(0, 12));
    try {
      const a = await post<Answer>("/api/edge/voice/ask", { text: heard });
      setTurns((t) => t.map((x) => (x.at === at ? { ...x, answer: a } : x)));
      if (!opts.quiet) { setSpeaking(true); speak(a.script, () => { setSpeaking(false); opts.then?.(); }); }
    } catch (e) {
      setTurns((t) => t.map((x) => (x.at === at ? { ...x, error: errorMessage(e) } : x)));
      opts.then?.();
    } finally { setBusy(false); }
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    setOpen(true);
    if (!Ctor) { setCanHear(false); return; }
    hush(); setSpeaking(false); commute.current.on = false;
    try {
      const r = new Ctor();
      r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = true;
      finalText.current = ""; interimRef.current = ""; setInterim("");
      r.onresult = (e) => {
        let fin = "", mid = "";
        for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else mid += res[0].transcript; }
        finalText.current = fin; interimRef.current = `${fin}${mid}`; setInterim(`${fin}${mid}`);
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { setCanHear(false); setNote("The microphone is blocked for this site. Allow it in the browser, or type the question."); }
        else if (e.error !== "aborted" && e.error !== "no-speech") setNote("I could not hear that. Try again, or type the question.");
      };
      r.onend = () => { setListening(false); rec.current = null; };
      rec.current = r; r.start(); setListening(true);
    } catch { setNote("Speech recognition did not start. Type the question instead."); setCanHear(false); }
  }, []);

  const stop = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.stop();
    // Some browsers deliver the last words just after stop; wait a beat before asking.
    window.setTimeout(() => { const t = (finalText.current || interimRef.current).trim(); setInterim(""); if (t) void ask(t); }, 350);
  }, [ask]);
  // Alt+Shift+V: start listening; again to stop. Escape stops speech.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === "V" || e.key === "v" || e.code === "KeyV")) { e.preventDefault(); if (rec.current) stop(); else start(); }
      else if (e.key === "Escape") { hush(); setSpeaking(false); commute.current.on = false; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, stop]);

  useEffect(() => () => { rec.current?.abort(); hush(); }, []);

  // The commute brief: feed, theses, then each watched company, one after another, with lock-screen controls.
  const nextCommute = useCallback(() => {
    const c = commute.current;
    const q = c.queue.shift();
    if (!c.on || !q) { c.on = false; setSpeaking(false); return; }
    void ask(q, { then: () => nextCommute() });
  }, [ask]);
  const startCommute = () => {
    hush();
    commute.current = { on: true, queue: ["Catch me up on my feed", "How are my theses", ...tickers.slice(0, 4).map((t) => `What's happening at ${t}`)] };
    setOpen(true);
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "Commute brief", artist: "YouBank Edge", album: "Voice Analyst" });
        navigator.mediaSession.setActionHandler("pause", () => { hush(); commute.current.on = false; setSpeaking(false); });
        navigator.mediaSession.setActionHandler("stop", () => { hush(); commute.current.on = false; setSpeaking(false); });
        navigator.mediaSession.setActionHandler("nexttrack", () => { hush(); nextCommute(); });
      } catch { /* controls are optional */ }
    }
    nextCommute();
  };

  const latest = turns[0];
  const caption = listening ? interim || "Listening…" : busy ? "Looking it up…" : latest?.answer?.script ?? latest?.error ?? null;

  return (
    <>
      <div className="fixed right-4 z-40 flex flex-col items-end gap-2 bottom-[calc(56px+16px+var(--safe-b))] md:bottom-5 md:right-5">
        {!open && caption && <div className="max-w-[260px] rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-muted shadow-float">{caption}</div>}
        <button
          type="button"
          aria-label={listening ? "Release to ask" : "Hold to talk to Edge (Alt+Shift+V)"}
          title="Hold to talk (Alt+Shift+V). Tap to open."
          onPointerDown={(e) => { if (e.button !== 0) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); start(); }}
          onPointerUp={() => stop()}
          onPointerCancel={() => stop()}
          onContextMenu={(e) => e.preventDefault()}
          className={`flex h-12 w-12 touch-none select-none items-center justify-center rounded-full border shadow-float transition ${listening ? "scale-110 border-accent bg-accent text-white" : "border-line-strong bg-panel text-accent hover:bg-elevated"}`}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : listening ? <AudioLines className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
      </div>

      <Sheet open={open} onClose={() => { setOpen(false); rec.current?.abort(); hush(); setSpeaking(false); commute.current.on = false; }} title="Voice Analyst" size="half" expandable
        actions={speaking ? <button type="button" onClick={() => { hush(); setSpeaking(false); commute.current.on = false; }} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px]"><Square className="h-3 w-3" /> Stop</button> : null}
        footer={
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(""); void ask(t); }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={canHear === false ? "Type a question (speech is not available here)" : "Or type: odds Targa is sold, hiring at NVDA…"} className="min-h-10 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-[13px]" aria-label="Question" />
            <button type="submit" disabled={busy || !typed.trim()} className="flex min-h-10 items-center gap-1 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Ask</button>
          </form>
        }
      >
        <div className="space-y-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            {canHear !== false && (
              <button type="button" onClick={() => (listening ? stop() : start())} className={`flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 ${listening ? "border-accent bg-accent-soft text-accent" : "border-line"}`}>
                {listening ? <><Square className="h-3.5 w-3.5" /> Stop and ask</> : <><Mic className="h-3.5 w-3.5" /> Talk</>}
              </button>
            )}
            <button type="button" onClick={startCommute} disabled={busy} className="flex min-h-9 items-center gap-1.5 rounded-md border border-line px-2.5 disabled:opacity-50"><Car className="h-3.5 w-3.5" /> Commute brief</button>
            <LiveConversation onCaption={(heard, script) => setTurns((t) => [{ heard, answer: { intent: "live", reason: "", ticker: null, company: null, script, citations: [], answerId: null, heard }, at: Date.now() }, ...t].slice(0, 12))} />
          </div>
          {listening && <p className="rounded-md border border-accent/40 bg-accent-soft px-2.5 py-2 text-fg" aria-live="polite">{interim || "Listening…"}</p>}
          {note && <p className="text-[12px] text-neg" role="alert">{note}</p>}
          {turns.length === 0 && !listening && (
            <div className="text-muted">
              <p>Ask about a company or your work. Answers come from Edge&apos;s data with their sources, and say so when nothing answers.</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                <li>&quot;What are the odds Targa is sold?&quot;</li>
                <li>&quot;Is NVDA hiring?&quot; · &quot;Precedents for midstream deals&quot;</li>
                <li>&quot;Catch me up&quot; · &quot;How are my theses?&quot;</li>
                <li>&quot;Note on Targa: CFO open to a call in May&quot;</li>
              </ul>
              <p className="mt-1.5">Edge never sends anything by voice. Audio stays in your browser; only the words are sent.</p>
            </div>
          )}
          <ul className="space-y-2.5">
            {turns.map((t) => (
              <li key={t.at} className="rounded-lg border border-line p-2.5">
                <div className="text-[11.5px] text-muted">You: {t.heard}</div>
                {t.error ? <PlanNotice error={t.error} className="mt-1" /> : !t.answer ? <div className="mt-1 flex items-center gap-1.5 text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking it up…</div> : (
                  <>
                    <p className="mt-1 text-fg">{t.answer.script}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {t.answer.reason && <span className="text-[10.5px] text-muted">{t.answer.reason}</span>}
                      {t.answer.citations.map((c, i) => c.url
                        ? <a key={i} href={c.url} target={c.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="max-w-full truncate rounded-full border border-line px-2 py-0.5 text-[10.5px] text-accent hover:bg-elevated">{c.label}</a>
                        : <span key={i} className="max-w-full truncate rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted">{c.label}</span>)}
                      <button type="button" onClick={() => { setSpeaking(true); speak(t.answer!.script, () => setSpeaking(false)); }} className="ml-auto flex items-center gap-1 text-[11px] text-muted hover:text-fg" aria-label="Read again"><Volume2 className="h-3 w-3" /> Again</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    </>
  );
}

type LiveSession = { key: string; model: string; session: string; maxSeconds: number };

/** The premium live conversation: WebRTC with the realtime model, whose tool calls run through /api/edge/voice/ask. */
function LiveConversation({ onCaption }: { onCaption: (heard: string, script: string) => void }) {
  const unlocked = useFeature("edge.voice-realtime");
  const [state, setState] = useState<"idle" | "starting" | "live">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const meta = useRef<{ session: string; started: number } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const lastHeard = useRef("");

  const end = useCallback(() => {
    pc.current?.close(); pc.current = null;
    mic.current?.getTracks().forEach((t) => t.stop()); mic.current = null;
    const m = meta.current; meta.current = null;
    if (m) void post("/api/edge/voice/session/end", { session: m.session, seconds: Math.round((Date.now() - m.started) / 1000) }).catch(() => undefined);
    setState("idle"); setSecs(0);
  }, []);
  useEffect(() => () => end(), [end]);

  useEffect(() => {
    if (state !== "live") return;
    const id = window.setInterval(() => {
      const m = meta.current;
      if (!m) return;
      const s = Math.round((Date.now() - m.started) / 1000);
      setSecs(s);
      if (s >= 600) end();
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, end]);

  const startLive = async () => {
    setErr(null); setState("starting"); hush();
    try {
      const s = await post<LiveSession>("/api/edge/voice/session", {});
      const conn = new RTCPeerConnection();
      pc.current = conn;
      const el = audio.current ?? new Audio();
      el.autoplay = true; audio.current = el;
      conn.ontrack = (e) => { el.srcObject = e.streams[0]; };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.current = stream;
      stream.getTracks().forEach((t) => conn.addTrack(t, stream));
      const dc = conn.createDataChannel("oai-events");
      dc.onmessage = async (ev) => {
        let msg: { type?: string; name?: string; call_id?: string; arguments?: string; transcript?: string } = {};
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript) lastHeard.current = msg.transcript;
        if ((msg.type === "response.output_audio_transcript.done" || msg.type === "response.audio_transcript.done") && msg.transcript) onCaption(lastHeard.current || "(spoken)", msg.transcript);
        if (msg.type === "response.function_call_arguments.done" && msg.name === "edge_tool" && msg.call_id) {
          let args: { text?: string; intent?: string; ticker?: string } = {};
          try { args = JSON.parse(msg.arguments ?? "{}"); } catch { /* empty args */ }
          let output: unknown;
          try {
            const a = await post<Answer>("/api/edge/voice/ask", { text: args.text ?? lastHeard.current ?? "", intent: args.intent, ticker: args.ticker });
            output = { script: a.script, sources: a.citations.map((c) => c.label) };
          } catch (e) { output = { error: errorMessage(e) }; }
          if (dc.readyState === "open") {
            dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: msg.call_id, output: JSON.stringify(output) } }));
            dc.send(JSON.stringify({ type: "response.create" }));
          }
        }
      };
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      const res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(s.model)}`, { method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${s.key}`, "Content-Type": "application/sdp" } });
      if (!res.ok) throw new Error("The live voice service did not connect. Try again, or use hold-to-talk.");
      await conn.setRemoteDescription({ type: "answer", sdp: await res.text() });
      meta.current = { session: s.session, started: Date.now() };
      setState("live");
    } catch (e) {
      const m = (e as { name?: string } | null)?.name === "NotAllowedError" ? "The microphone is blocked for this site. Allow it in the browser to talk live." : errorMessage(e);
      pc.current?.close(); pc.current = null;
      mic.current?.getTracks().forEach((t) => t.stop()); mic.current = null;
      setErr(m); setState("idle");
    }
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {state === "live" ? (
        <button type="button" onClick={end} className="flex min-h-9 items-center gap-1.5 rounded-md border border-accent bg-accent-soft px-2.5 text-accent"><X className="h-3.5 w-3.5" /> End live · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} / 10:00</button>
      ) : (
        <button type="button" onClick={() => void startLive()} disabled={state === "starting" || unlocked === false} title={unlocked === false ? "Part of a paid plan" : "A real-time spoken conversation, up to ten minutes"} className="flex min-h-9 items-center gap-1.5 rounded-md border border-line px-2.5 disabled:opacity-50">
          {state === "starting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />} Live conversation
        </button>
      )}
      <PremiumBadge feature="edge.voice-realtime" />
      {err && <PlanNotice error={err} className="basis-full" />}
    </span>
  );
}

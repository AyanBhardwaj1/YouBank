//! Meeting audio: the microphone, and what the computer plays (the other side of the call), mixed to
//! 16 kHz mono and written as WAV chunks of about 30 seconds for the server to transcribe.
//!
//! System audio, per platform, all through cpal:
//! - Windows: WASAPI loopback (an input stream on the default output device).
//! - macOS: CoreAudio's process tap on the default output device (macOS 14.2 or later; the system asks
//!   for "System Audio Recording" permission the first time). Earlier macOS, or a refusal: microphone only.
//! - Linux: the default output's monitor source through PulseAudio (PipeWire answers the same protocol
//!   through pipewire-pulse). Without one: microphone only.
//!
//! When system audio cannot be opened the copilot records the microphone alone and says so: the others
//! are still heard through the speakers, but not through headphones.
//!
//! Each chunk starts one second before the previous one ended, so a word cut at a boundary is heard
//! whole in one of them (the server's stitcher removes the repeat). With each chunk go the microphone
//! and system levels every quarter second, which is how the server knows which lines were the person's
//! own: their voice is loudest in the microphone.
//!
//! The streams live on one thread of their own (cpal's streams cannot move between threads on every
//! platform), which also cuts the chunks. Nothing here touches the network.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const RATE: u32 = 16_000;
pub const CHUNK_SECS: f64 = 30.0;
pub const OVERLAP_SECS: f64 = 1.0;
/// Levels are measured over frames this long.
pub const FRAME_SECS: f64 = 0.25;

/// One chunk written to disk, waiting to be sent: `<dir>/chunk-00012.wav` with this beside it as JSON.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkMeta {
    pub seq: u32,
    /// Seconds into the meeting where the chunk begins (the overlap included).
    pub start: f64,
    pub duration: f64,
    /// Levels, hex, two characters a frame.
    pub mic: String,
    pub sys: String,
}

/// What the capture thread reports while it runs.
pub enum Event {
    /// A chunk was written beside its levels (`chunk-00012.wav` and `.json`), ready to send.
    Chunk(ChunkMeta),
    /// A stream stopped working (a device unplugged): the message for the person.
    Problem(String),
}

/// A recording in progress. Dropping it without `stop` leaves the thread to end on its own at the next tick.
pub struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    /// Why system audio is not recorded, if it is not.
    pub system_note: Option<String>,
    pub mic_name: String,
}

impl Capture {
    /// Stop: the last partial chunk is written before this returns.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/* ---------------- Pure helpers (tested) ---------------- */

/// Interleaved frames to mono by averaging the channels. Pure.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks(channels).map(|f| f.iter().sum::<f32>() / f.len() as f32).collect()
}

/// Resample mono audio from `from` Hz to `to` Hz: a box filter as wide as the step (a cheap guard
/// against aliasing when going down), then linear interpolation. Speech at 16 kHz needs no better. Pure.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if input.is_empty() || from == 0 || to == 0 {
        return Vec::new();
    }
    if from == to {
        return input.to_vec();
    }
    let step = from as f64 / to as f64;
    let width = step.floor().max(1.0) as usize;
    let smoothed: Vec<f32> = if width > 1 {
        let mut acc = 0.0f32;
        let mut out = Vec::with_capacity(input.len());
        for i in 0..input.len() {
            acc += input[i];
            if i >= width {
                acc -= input[i - width];
            }
            out.push(acc / (i + 1).min(width) as f32);
        }
        out
    } else {
        input.to_vec()
    };
    let n = ((input.len() as f64) / step).floor() as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * step;
            let j = pos.floor() as usize;
            let frac = (pos - j as f64) as f32;
            let a = smoothed[j.min(smoothed.len() - 1)];
            let b = smoothed[(j + 1).min(smoothed.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

/// Loudness per frame (RMS, on a 0..255 scale that is roughly logarithmic), for telling voices apart. Pure.
pub fn levels(samples: &[f32], rate: u32, frame_secs: f64) -> Vec<u8> {
    let frame = ((rate as f64) * frame_secs).round().max(1.0) as usize;
    samples
        .chunks(frame)
        .map(|f| {
            let rms = (f.iter().map(|x| x * x).sum::<f32>() / f.len() as f32).sqrt();
            // -60 dBFS and below is 0, 0 dBFS is 255.
            let db = 20.0 * rms.max(1e-6).log10();
            (((db + 60.0) / 60.0).clamp(0.0, 1.0) * 255.0).round() as u8
        })
        .collect()
}

/// Levels as hex, two characters each. Pure.
pub fn hex(levels: &[u8]) -> String {
    levels.iter().map(|b| format!("{b:02x}")).collect()
}

/// The microphone and system audio as one track, the shorter padded with silence, kept within range. Pure.
pub fn mix(a: &[f32], b: &[f32]) -> Vec<f32> {
    let n = a.len().max(b.len());
    (0..n).map(|i| (a.get(i).copied().unwrap_or(0.0) + b.get(i).copied().unwrap_or(0.0)).clamp(-1.0, 1.0)).collect()
}

/// 16-bit PCM WAV. Pure.
pub fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    out
}

/// How many samples of silence to add so a stream that delivered `received` samples since `elapsed`
/// keeps time: loopback delivers nothing while nothing plays, and the gap must stay a gap. Only gaps
/// longer than `slack` seconds count, so normal callback jitter adds nothing. Pure.
pub fn gap_to_fill(received: u64, elapsed: Duration, rate: u32, slack: f64) -> u64 {
    let expected = (elapsed.as_secs_f64() * rate as f64) as u64;
    let slack = (slack * rate as f64) as u64;
    if expected > received + slack {
        expected - received
    } else {
        0
    }
}

/* ---------------- Streams ---------------- */

/// Mono samples at a device's rate, with how many arrived since the stream started.
struct Track {
    rate: u32,
    buf: Vec<f32>,
    received: u64,
    started: Instant,
    /// Fill gaps with silence (system audio); the microphone delivers continuously.
    keep_time: bool,
}

impl Track {
    fn new(rate: u32, keep_time: bool) -> Self {
        Self { rate, buf: Vec::new(), received: 0, started: Instant::now(), keep_time }
    }

    fn push(&mut self, mono: &[f32]) {
        if self.keep_time {
            let gap = gap_to_fill(
                self.received,
                self.started.elapsed().saturating_sub(Duration::from_secs_f64(mono.len() as f64 / self.rate as f64)),
                self.rate,
                0.3,
            );
            if gap > 0 {
                self.buf.extend(std::iter::repeat_n(0.0, gap as usize));
                self.received += gap;
            }
        }
        self.buf.extend_from_slice(mono);
        self.received += mono.len() as u64;
    }

    /// Everything so far at 16 kHz, emptying the buffer; for a time-keeping track, silence up to now first.
    fn drain(&mut self) -> Vec<f32> {
        if self.keep_time {
            let gap = gap_to_fill(self.received, self.started.elapsed(), self.rate, 0.3);
            if gap > 0 {
                self.buf.extend(std::iter::repeat_n(0.0, gap as usize));
                self.received += gap;
            }
        }
        resample(&std::mem::take(&mut self.buf), self.rate, RATE)
    }
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    track: Arc<Mutex<Track>>,
    problems: mpsc::Sender<Event>,
    what: &'static str,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let err = move |e: cpal::Error| {
        let _ = problems.send(Event::Problem(format!("The {what} stopped working ({e}).")));
    };
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                let floats: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                let mono = downmix(&floats, channels);
                if let Ok(mut t) = track.lock() {
                    t.push(&mono);
                }
            },
            err,
            Some(Duration::from_secs(5)),
        )
        .map_err(|e| e.to_string())
}

/// Open an input stream on `device` in whatever sample format it offers.
fn open(
    device: &cpal::Device,
    config: cpal::SupportedStreamConfig,
    keep_time: bool,
    problems: mpsc::Sender<Event>,
    what: &'static str,
) -> Result<(cpal::Stream, Arc<Mutex<Track>>), String> {
    let track = Arc::new(Mutex::new(Track::new(config.sample_rate(), keep_time)));
    let c = config.config();
    let t = track.clone();
    let stream = match config.sample_format() {
        SampleFormat::F32 => build::<f32>(device, c, t, problems, what),
        SampleFormat::F64 => build::<f64>(device, c, t, problems, what),
        SampleFormat::I16 => build::<i16>(device, c, t, problems, what),
        SampleFormat::I32 => build::<i32>(device, c, t, problems, what),
        SampleFormat::I8 => build::<i8>(device, c, t, problems, what),
        SampleFormat::U8 => build::<u8>(device, c, t, problems, what),
        SampleFormat::U16 => build::<u16>(device, c, t, problems, what),
        SampleFormat::U32 => build::<u32>(device, c, t, problems, what),
        f => Err(format!("the {what} uses a sample format ({f:?}) this version cannot read")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    if let Ok(mut t) = track.lock() {
        t.started = Instant::now();
    }
    Ok((stream, track))
}

fn device_name(d: &cpal::Device) -> String {
    d.description().map(|x| x.name().to_string()).unwrap_or_else(|_| "microphone".into())
}

/// The device that carries what the computer plays, as an input.
fn system_device(host: &cpal::Host) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
    #[cfg(target_os = "linux")]
    {
        // PulseAudio (or PipeWire's pulse server): the default output's monitor source.
        let out = host.default_output_device().ok_or("no audio output was found")?;
        let sink = out.id().map(|i| i.id().to_string()).unwrap_or_default();
        let monitors: Vec<cpal::Device> =
            host.input_devices().map_err(|e| e.to_string())?.filter(|d| d.id().map(|i| i.id().ends_with(".monitor")).unwrap_or(false)).collect();
        let pick = monitors
            .iter()
            .find(|d| d.id().map(|i| i.id() == format!("{sink}.monitor")).unwrap_or(false))
            .or_else(|| monitors.first())
            .cloned()
            .ok_or("this system has no monitor source to record from (PulseAudio or PipeWire is needed)")?;
        let config = pick.default_input_config().map_err(|e| e.to_string())?;
        Ok((pick, config))
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Windows (WASAPI loopback) and macOS (a CoreAudio process tap): an input stream on the output.
        let out = host.default_output_device().ok_or("no audio output was found")?;
        let config = out.default_output_config().map_err(|e| e.to_string())?;
        Ok((out, config))
    }
}

/// Write one chunk and its levels into `dir`. Returns the WAV's path.
fn write_chunk(dir: &Path, meta: &ChunkMeta, samples: &[f32]) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let wav_path = dir.join(format!("chunk-{:05}.wav", meta.seq));
    let tmp = wav_path.with_extension("tmp");
    std::fs::write(&tmp, wav(samples, RATE))?;
    std::fs::rename(&tmp, &wav_path)?;
    crate::settings::write_json(&wav_path.with_extension("json"), meta)?;
    Ok(wav_path)
}

/// Cuts the mixed audio into overlapping chunks. Pure apart from the clock it is given.
pub struct Chunker {
    pub seq: u32,
    /// Seconds of new audio emitted so far.
    pub emitted: f64,
    tail_mix: Vec<f32>,
    tail_mic: Vec<f32>,
    tail_sys: Vec<f32>,
}

impl Default for Chunker {
    fn default() -> Self {
        Self::new()
    }
}

impl Chunker {
    pub fn new() -> Self {
        Self { seq: 0, emitted: 0.0, tail_mix: Vec::new(), tail_mic: Vec::new(), tail_sys: Vec::new() }
    }

    /// The next chunk from new microphone and system audio (16 kHz): the last second of the previous
    /// chunk, then the new audio. None when there is nothing new.
    pub fn next(&mut self, mic: Vec<f32>, sys: Vec<f32>) -> Option<(ChunkMeta, Vec<f32>)> {
        let n = mic.len().max(sys.len());
        if n == 0 {
            return None;
        }
        let pad = |mut v: Vec<f32>| {
            v.resize(n, 0.0);
            v
        };
        let (mic, sys) = (pad(mic), pad(sys));
        let new_mix = mix(&mic, &sys);
        let overlap = self.tail_mix.len();
        let all = |tail: &[f32], new: &[f32]| [tail, new].concat();
        let (samples, m, s) = (all(&self.tail_mix, &new_mix), all(&self.tail_mic, &mic), all(&self.tail_sys, &sys));
        let start = (self.emitted - overlap as f64 / RATE as f64).max(0.0);
        let meta = ChunkMeta {
            seq: self.seq,
            start,
            duration: samples.len() as f64 / RATE as f64,
            mic: hex(&levels(&m, RATE, FRAME_SECS)),
            sys: hex(&levels(&s, RATE, FRAME_SECS)),
        };
        let keep = ((OVERLAP_SECS * RATE as f64) as usize).min(samples.len());
        self.tail_mix = samples[samples.len() - keep..].to_vec();
        self.tail_mic = m[m.len() - keep..].to_vec();
        self.tail_sys = s[s.len() - keep..].to_vec();
        self.emitted += n as f64 / RATE as f64;
        self.seq += 1;
        Some((meta, samples))
    }
}

/// Start recording into `dir`. `system` asks for system audio too; if it cannot be opened the
/// recording goes on with the microphone and `system_note` says why.
pub fn start(dir: PathBuf, system: bool, events: mpsc::Sender<Event>) -> Result<Capture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(Option<String>, String), String>>();
    let flag = stop.clone();
    let thread = std::thread::Builder::new()
        .name("meeting-capture".into())
        .spawn(move || {
            let host = cpal::default_host();
            let Some(mic_dev) = host.default_input_device() else {
                let _ = ready_tx.send(Err("No microphone was found. Connect one, or check that YouBank may use it in your system's privacy settings.".into()));
                return;
            };
            let mic_cfg = match mic_dev.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("The microphone could not be opened ({e}). Check that YouBank may use it in your system's privacy settings.")));
                    return;
                }
            };
            let (mic_stream, mic) = match open(&mic_dev, mic_cfg, false, events.clone(), "microphone") {
                Ok(x) => x,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("The microphone could not be opened ({e}). Check that YouBank may use it in your system's privacy settings.")));
                    return;
                }
            };
            let mut note = None;
            let sys = if system {
                match system_device(&host).and_then(|(d, c)| open(&d, c, true, events.clone(), "system audio")) {
                    Ok(x) => Some(x),
                    Err(e) => {
                        note = Some(format!("System audio could not be recorded ({e}), so only your microphone is: the others are heard through your speakers, but not through headphones."));
                        None
                    }
                }
            } else {
                note = Some("System audio is off in the settings, so only your microphone is recorded.".into());
                None
            };
            let _ = ready_tx.send(Ok((note, device_name(&mic_dev))));

            let mut chunker = Chunker::new();
            let mut last = Instant::now();
            let emit = |chunker: &mut Chunker| {
                let m = mic.lock().map(|mut t| t.drain()).unwrap_or_default();
                let s = sys.as_ref().and_then(|(_, t)| t.lock().ok().map(|mut t| t.drain())).unwrap_or_default();
                if let Some((meta, samples)) = chunker.next(m, s) {
                    match write_chunk(&dir, &meta, &samples) {
                        Ok(_) => {
                            let _ = events.send(Event::Chunk(meta));
                        }
                        Err(e) => {
                            let _ = events.send(Event::Problem(format!("A piece of the recording could not be saved ({e}).")));
                        }
                    }
                }
            };
            while !flag.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(250));
                if last.elapsed().as_secs_f64() >= CHUNK_SECS {
                    last = Instant::now();
                    emit(&mut chunker);
                }
            }
            emit(&mut chunker);
            drop(mic_stream);
            drop(sys);
        })
        .map_err(|e| format!("Could not start recording: {e}"))?;
    match ready_rx.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok((system_note, mic_name))) => Ok(Capture { stop, thread: Some(thread), system_note, mic_name }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            Err("The microphone did not answer. Check that YouBank may use it, then try again.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_and_rate() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        let tone: Vec<f32> = (0..48_000).map(|i| ((i as f32) * 0.01).sin() * 0.5).collect();
        let r = resample(&tone, 48_000, RATE);
        assert_eq!(r.len(), 16_000);
        assert!(r.iter().all(|x| x.abs() <= 0.5 + 1e-3));
        assert_eq!(resample(&[0.1, 0.2], 16_000, 16_000), vec![0.1, 0.2]);
        assert_eq!(resample(&tone[..44_100], 44_100, RATE).len(), 16_000);
        assert!(resample(&[], 48_000, RATE).is_empty());
    }

    #[test]
    fn levels_and_hex() {
        let loud = vec![0.5f32; 4_000];
        let quiet = vec![0.0001f32; 4_000];
        let l = levels(&[loud, quiet].concat(), RATE, FRAME_SECS);
        assert_eq!(l.len(), 2);
        assert!(l[0] > 200 && l[1] < 10, "{l:?}");
        assert_eq!(hex(&[0, 15, 255]), "000fff");
    }

    #[test]
    fn wav_header() {
        let w = wav(&[0.0, 1.0, -1.0], RATE);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes([w[24], w[25], w[26], w[27]]), RATE);
        assert_eq!(u32::from_le_bytes([w[40], w[41], w[42], w[43]]), 6);
        assert_eq!(i16::from_le_bytes([w[46], w[47]]), 32767);
        assert_eq!(i16::from_le_bytes([w[48], w[49]]), -32767);
    }

    #[test]
    fn mixing_and_gaps() {
        assert_eq!(mix(&[0.5, 0.9], &[0.2]), vec![0.7, 0.9]);
        assert_eq!(mix(&[0.8], &[0.8]), vec![1.0]);
        assert_eq!(gap_to_fill(16_000, Duration::from_secs(3), RATE, 0.3), 32_000);
        assert_eq!(gap_to_fill(47_000, Duration::from_secs(3), RATE, 0.3), 0);
    }

    #[test]
    fn chunks_overlap_by_a_second() {
        let mut c = Chunker::new();
        let (a, sa) = c.next(vec![0.1; 30 * RATE as usize], vec![]).unwrap();
        assert_eq!((a.seq, a.start, a.duration), (0, 0.0, 30.0));
        assert_eq!(sa.len(), 30 * RATE as usize);
        assert_eq!(a.mic.len(), 2 * 120);
        let (b, sb) = c.next(vec![0.2; 10 * RATE as usize], vec![0.3; 9 * RATE as usize]).unwrap();
        assert_eq!((b.seq, b.start, b.duration), (1, 29.0, 11.0));
        assert!((sb[0] - 0.1).abs() < 1e-6 && (sb[RATE as usize] - 0.5).abs() < 1e-6);
        assert!(c.next(vec![], vec![]).is_none());
        assert_eq!(c.emitted, 40.0);
    }
}

// =============================================================================
// piano-audio.js — Web Audio sampler for piano keyboard
// Plays DATA/piano/<stem>.<ext>; missing samples are pitch-shifted from the
// nearest available sample within ±maxShift semitones.
// =============================================================================
//
// SYNC POINT (note_ref -> sample filename): '#' -> 's'   e.g. 'C#4' -> 'Cs4'
//   Must match: piano-keyboard.js noteToFileStem, Python backend (future), DATA/piano/*
// =============================================================================

const NOTE_RE = /^([A-G])(#?)([0-8])$/;
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteToMidi(note) {
  const m = NOTE_RE.exec(note);
  if (!m) return null;
  return (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] ? 1 : 0);
}

export function midiToNote(midi) {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

const fileStem = (note) => note.replace('#', 's');

/**
 * @param {object} opts
 * @param {string} opts.baseUrl     sample directory (default 'DATA/piano/')
 * @param {string} opts.ext         sample extension (default 'mp3')
 * @param {number} opts.volume      master gain 0–1 (default 0.8)
 * @param {number} opts.releaseSec  fade on key release (default 0.6)
 * @param {boolean} opts.sustain    true = ignore release, let notes ring (default false)
 * @param {number} opts.maxShift    max semitones to pitch-shift a fallback sample (default 3)
 * @param {string[]} opts.missing   note_refs with no sample file — skipped without a request
 */
export function createPianoAudio(opts = {}) {
  const {
    baseUrl = 'DATA/piano/',
    ext = 'mp3',
    volume = 0.8,
    releaseSec = 0.6,
    sustain = false,
    maxShift = 3,
    missing = [],
  } = opts;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('piano-audio: Web Audio API not supported');

  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const buffers = new Map();   // midi -> Promise<AudioBuffer|null>
  const voices = new Map();    // note -> [{src, gain}]

  const missingSet = new Set(missing);

  function loadMidi(midi) {
    if (missingSet.has(midiToNote(midi))) return Promise.resolve(null); // known gap: no 404
    if (!buffers.has(midi)) {
      const url = `${baseUrl}${fileStem(midiToNote(midi))}.${ext}`;
      const p = fetch(url, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
        .catch(() => null);
      buffers.set(midi, p);
    }
    return buffers.get(midi);
  }

  // Exact sample, else nearest within ±maxShift (prefer sample above — less timbre smear going down)
  async function resolve(midi) {
    const exact = await loadMidi(midi);
    if (exact) return { buffer: exact, rate: 1 };
    for (let d = 1; d <= maxShift; d++) {
      for (const src of [midi + d, midi - d]) {
        const buf = await loadMidi(src);
        if (buf) return { buffer: buf, rate: 2 ** ((midi - src) / 12) };
      }
    }
    console.warn(`piano-audio: no sample within ±${maxShift} of ${midiToNote(midi)}`);
    return null;
  }

  const held = new Set(); // keys currently down (release may arrive before sample loads)

  async function play(note, velocity = 1) {
    const midi = noteToMidi(note);
    if (midi === null) return;
    held.add(note);
    if (ctx.state === 'suspended') await ctx.resume(); // must follow a user gesture

    const res = await resolve(midi);
    if (!res) return;

    const src = ctx.createBufferSource();
    src.buffer = res.buffer;
    src.playbackRate.value = res.rate;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, velocity));

    src.connect(gain).connect(master);
    src.start();

    const voice = { src, gain };
    if (!voices.has(note)) voices.set(note, []);
    voices.get(note).push(voice);
    src.onended = () => {
      const list = voices.get(note);
      if (!list) return;
      const i = list.indexOf(voice);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) voices.delete(note);
    };

    if (!held.has(note)) release(note); // key already up while sample was loading
  }

  function release(note) {
    held.delete(note);
    if (sustain) return;
    const list = voices.get(note);
    if (!list) return;
    const t = ctx.currentTime;
    for (const { src, gain } of list) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + releaseSec);
      src.stop(t + releaseSec + 0.02);
    }
  }

  function preload(notes) {
    return Promise.all(
      [...notes].map((n) => noteToMidi(n)).filter((m) => m !== null).map(loadMidi),
    );
  }

  return {
    play,
    release,
    preload,
    stopAll: () => [...voices.keys()].forEach(release),
    setVolume: (v) => { master.gain.value = Math.max(0, Math.min(1, v)); },
    context: ctx,
  };
}

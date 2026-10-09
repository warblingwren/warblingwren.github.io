// =============================================================================
// piano-audio.js — Web Audio sampler for the piano keyboard (and, through createSampler, the guitar)
// Plays <baseUrl><stem>.<ext>; missing samples are pitch-shifted from the
// nearest available sample within ±maxShift semitones.
//
// Default behaviour (ringUntilNext: true): a played key or chord rings until the
// next key or chord is played; key-up does not cut the sound.
//
// createSampler(opts)     — the shared engine (guitar-audio.js uses it with DATA/guitar/)
// createPianoAudio(opts)  — createSampler with the piano defaults (unchanged API)
// =============================================================================
//
// SYNC POINT (note_ref -> sample filename): '#' -> 's'   e.g. 'C#4' -> 'Cs4'
//   Must match: piano.js noteToFileStem, Python backend (future), DATA/piano/*, DATA/guitar/*
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

/** Piano sampler: createSampler with the piano defaults (DATA/piano/, 'piano:mute'). Same API as before. */
export function createPianoAudio(opts = {}) {
  return createSampler({ name: 'piano-audio', baseUrl: 'DATA/piano/', muteEvent: 'piano:mute', ...opts });
}

/**
 * @param {object} opts
 * @param {string} opts.name           prefix for console messages (default 'sampler')
 * @param {string} opts.baseUrl        sample directory (default 'DATA/piano/')
 * @param {string} opts.ext            sample extension (default 'mp3')
 * @param {number} opts.volume         master gain 0–1 (default 0.8)
 * @param {number} opts.releaseSec     fade when a sound is stopped (default 0.6)
 * @param {boolean} opts.ringUntilNext true = sound rings until the next play; key-up ignored (default true)
 * @param {number} opts.maxShift       max semitones to pitch-shift a fallback sample (default 3)
 * @param {string[]} opts.missing      note_refs with no sample file — skipped without a request
 * @param {string[]} opts.range        [lowest, highest] note_ref with a sample file, e.g. ['D2', 'D5'];
 *                                     notes outside are never requested (no 404s) and play pitch-shifted
 *                                     from the nearest sample inside (default: no limit)
 * @param {number} opts.strumMs        default delay between chord notes for playChord (default 0)
 * @param {boolean} opts.muted         start muted (default false)
 * @param {string} opts.muteEvent      event name carrying {muted} from the instrument's mute button
 *                                     (default 'piano:mute')
 * @param {EventTarget|null} opts.muteEvents  listens here for opts.muteEvent (default document; null = don't listen)
 */
export function createSampler(opts = {}) {
  const {
    name = 'sampler',
    baseUrl = 'DATA/piano/',
    ext = 'mp3',
    volume = 0.8,
    releaseSec = 0.6,
    ringUntilNext = true,
    maxShift = 3,
    missing = [],
    range = null,
    strumMs: defaultStrum = 0,
    muted: startMuted = false,
    muteEvent = 'piano:mute',
    muteEvents = document,
  } = opts;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error(`${name}: Web Audio API not supported`);
  const lo = Array.isArray(range) ? noteToMidi(range[0]) : null;
  const hi = Array.isArray(range) ? noteToMidi(range[1]) : null;
  const inRange = (m) => (lo === null || m >= lo) && (hi === null || m <= hi);

  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const missingSet = new Set(missing);
  const buffers = new Map();   // midi -> Promise<AudioBuffer|null>
  const voices = new Set();    // {note, src, gain}
  const held = new Set();      // ringUntilNext=false only: keys currently down
  let generation = 0;          // newest play wins if samples load out of order
  let muted = Boolean(startMuted);

  // --- loading ------------------------------------------------------------
  function loadMidi(midi) {
    if (missingSet.has(midiToNote(midi)) || !inRange(midi)) return Promise.resolve(null); // known gap: no 404
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

  // Exact sample, else nearest within ±maxShift (prefer sample above; outside opts.range: the nearest edge)
  async function resolve(midi) {
    const exact = await loadMidi(midi);
    if (exact) return { buffer: exact, rate: 1 };
    for (let d = 1; d <= maxShift; d++) {
      for (const src of [midi + d, midi - d]) {
        if (!inRange(src)) continue;
        const buf = await loadMidi(src);
        if (buf) return { buffer: buf, rate: 2 ** ((midi - src) / 12) };
      }
    }
    console.warn(`${name}: no sample within ±${maxShift} of ${midiToNote(midi)}`);
    return null;
  }

  // --- voices -------------------------------------------------------------
  function fade(voice, sec) {
    const t = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    try { voice.src.stop(t + sec + 0.02); } catch { /* already stopped */ }
    voices.delete(voice);
  }

  function startVoice(note, res, velocity, when) {
    const src = ctx.createBufferSource();
    src.buffer = res.buffer;
    src.playbackRate.value = res.rate;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, velocity));
    src.connect(gain).connect(master);
    src.start(when);
    const voice = { note, src, gain };
    voices.add(voice);
    src.onended = () => voices.delete(voice);
    return voice;
  }

  /**
   * Strike one or more notes together (fresh attack every time).
   * @param {string[]} notes
   * @param {number} velocity  0–1
   * @param {number} strumMs   delay between notes
   */
  async function strike(notes, velocity = 1, strumMs = 0) {
    if (muted) return;
    const midis = notes.map(noteToMidi).filter((m) => m !== null);
    if (!midis.length) return;
    const my = ++generation;

    // Stop what is ringing now — the new strike replaces it
    if (ringUntilNext) [...voices].forEach((v) => fade(v, releaseSec));
    if (ctx.state === 'suspended') await ctx.resume(); // must follow a user gesture

    const resolved = await Promise.all(midis.map(resolve));
    if (ringUntilNext && my !== generation) return; // a newer strike superseded this one
    if (muted) return;                               // muted while the samples were loading

    const t0 = ctx.currentTime;
    resolved.forEach((res, i) => {
      if (!res) return;
      const note = midiToNote(midis[i]);
      startVoice(note, res, velocity, t0 + (i * strumMs) / 1000);
      // ringUntilNext=false: key already up while the sample was loading
      if (!ringUntilNext && !held.has(note)) release(note);
    });
  }

  function play(note, velocity = 1) {
    if (!ringUntilNext) held.add(note);
    return strike([note], velocity);
  }

  function playChord(notes, velocity = 0.7, strumMs = defaultStrum) {
    return strike(notes, velocity, strumMs);
  }

  // Key-up. Ignored when ringUntilNext (sound rings until the next strike).
  function release(note) {
    if (ringUntilNext) return;
    held.delete(note);
    for (const v of [...voices]) if (v.note === note) fade(v, releaseSec);
  }

  function stopAll(sec = releaseSec) {
    generation += 1;
    [...voices].forEach((v) => fade(v, sec));
  }

  // Mute: nothing sounds until unmuted; anything ringing fades out quickly.
  function setMuted(on) {
    muted = Boolean(on);
    if (muted) stopAll(0.05);
    return muted;
  }

  // The instrument's mute button emits opts.muteEvent ('piano:mute' / 'guitar:mute'), bubbling to document
  if (muteEvent && muteEvents && typeof muteEvents.addEventListener === 'function') {
    muteEvents.addEventListener(muteEvent, (e) => setMuted(Boolean(e.detail && e.detail.muted)));
  }

  function preload(notes) {
    return Promise.all(
      [...notes].map((n) => noteToMidi(n)).filter((m) => m !== null).map(loadMidi),
    );
  }

  return {
    play,
    playChord,
    release,
    preload,
    stopAll,
    setMuted,
    isMuted: () => muted,
    setVolume: (v) => { master.gain.value = Math.max(0, Math.min(1, v)); },
    context: ctx,
  };
}

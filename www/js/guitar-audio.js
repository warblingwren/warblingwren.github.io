// =============================================================================
// guitar-audio.js — Web Audio sampler for the guitar (same engine and API as piano-audio.js)
// Plays DATA/guitar/<stem>.<ext>. The sample set covers D2–D5 chromatically; notes outside it
// (Drop C's C2, frets above D5 up to E6 at the 24th fret) are pitch-shifted from the nearest sample.
//
// Chords are strummed low string -> high string (playChord default strumMs: 30).
// Behaviour as the piano: a sound rings until the next one is played; the fretboard's mute button
// ('guitar:mute' {muted}, from guitar.js) silences every play path.
// =============================================================================
//
// SYNC POINT (note_ref -> sample filename): '#' -> 's'   e.g. 'C#3' -> 'Cs3'   (piano-audio.js fileStem)
//   Must match: DATA/guitar/* (D2.mp3 … D5.mp3)
// SYNC POINT: range ['D2', 'D5'] = the lowest / highest file in DATA/guitar/
// =============================================================================

import { createSampler } from './piano-audio.js';

export const VERSION = 1;

/**
 * @param {object} opts  same options as createSampler (piano-audio.js); guitar defaults:
 *   baseUrl 'DATA/guitar/', ext 'mp3', range ['D2', 'D5'], maxShift 14 (C2 … E6 reachable),
 *   strumMs 30, releaseSec 0.8, muteEvent 'guitar:mute'
 * @returns {{play, playChord, release, preload, stopAll, setMuted, isMuted, setVolume, context}}
 *   playChord(notes, velocity = 0.7, strumMs = 30) — notes low to high, strummed in that order
 */
export function createGuitarAudio(opts = {}) {
  return createSampler({
    name: 'guitar-audio',
    baseUrl: 'DATA/guitar/',
    ext: 'mp3',
    range: ['D2', 'D5'],
    maxShift: 14,
    strumMs: 30,
    releaseSec: 0.8,
    muteEvent: 'guitar:mute',
    ...opts,
  });
}

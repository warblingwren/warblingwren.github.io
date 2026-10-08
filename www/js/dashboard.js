/* ==========================================================================
   dashboard.js
   ========================================================================== */

import './colors.js'
import { renderPianoKeyboard, OCTAVE_FAMILIES } from './piano.js';
import { createPianoAudio } from './piano-audio.js';
import { renderChordControls } from './piano-chords.js';
import { renderCircleProgressions } from './circle-o-5ths.js';
import { renderGuitarFretboard } from './guitar.js';

(function () {
  //javascript code here
  console.log('[+] Dashboard JS Loaded')
})();

const piano = await renderPianoKeyboard('piano-keyboard', {
  dataUrl: 'DATA/piano_tuning.json',
  scrollTo: 'C4',                    // desktop: centered note | responsive: starting octave
  mobileOctaves: 2,                  // responsive range C4–C6, shift with ‹ ›
  mobileQuery: '(max-width: 768px)', // SYNC: matches @media in piano-keyboard.css
});

const audio = createPianoAudio({
  baseUrl: 'DATA/piano/',
  ext: 'mp3',
  missing: ['A0', 'A#0', 'B0'], // no files — pitch-shifted down from C1
});

const el = document.getElementById('piano-keyboard');
el.addEventListener('piano:press',   (e) => audio.play(e.detail.note));
el.addEventListener('piano:release', (e) => audio.release(e.detail.note));

//const chords = renderChordControls({ piano, audio });
const chords = renderChordControls({ piano, audio, target: 'piano-chords' });
//const progressions = await renderCircleProgressions({ piano, audio, target: 'circle-progressions'  });

const progressions = await renderCircleProgressions({
  piano,
  audio,
  target: 'root-circle-progressions',
  relativeTarget: 'minor-circle-progressions',
  selectorTarget: 'progression-selector',
});

const guitar = await renderGuitarFretboard({ 
  target: 'guitar-fretboard', 
  dataUrl: 'DATA/guitar_tuning.json', 
  piano, 
  progressions 
});

/*
const el = document.getElementById('piano-keyboard');
el.addEventListener('piano:press',    (e) => console.log('press',   e.detail)); // {note, index, file}
el.addEventListener('piano:release',  (e) => console.log('release', e.detail));
el.addEventListener('piano:rerender', (e) => console.log('range',   e.detail)); // {from, to, compact}
*/

// piano.highlight(['C4','E4','G4']);  // persists across octave shifts / resize
// piano.shiftOctave(1);  piano.isCompact();  piano.keys();  // keys is now a function
// NOTE: 2 octaves at 375px = 22px white / 14px black keys — below 44px touch target. Accept, or drop to 1.5 octaves (C4–G5)?


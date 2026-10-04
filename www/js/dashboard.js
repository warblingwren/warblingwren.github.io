/* ==========================================================================
   dashboard.js
   ========================================================================== */

//import { renderPianoKeyboard } from './piano.js';
import { renderPianoKeyboard, OCTAVE_FAMILIES } from './piano.js';

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

const el = document.getElementById('piano-keyboard');
el.addEventListener('piano:press',    (e) => console.log('press',   e.detail)); // {note, index, file}
el.addEventListener('piano:release',  (e) => console.log('release', e.detail));
el.addEventListener('piano:rerender', (e) => console.log('range',   e.detail)); // {from, to, compact}

// piano.highlight(['C4','E4','G4']);  // persists across octave shifts / resize
// piano.shiftOctave(1);  piano.isCompact();  piano.keys();  // keys is now a function
// NOTE: 2 octaves at 375px = 22px white / 14px black keys — below 44px touch target. Accept, or drop to 1.5 octaves (C4–G5)?



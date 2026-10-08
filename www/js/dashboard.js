import './colors.js';
import { renderPianoKeyboard } from './piano.js';
import { createPianoAudio } from './piano-audio.js';
import { renderChordControls } from './piano-chords.js';
import { renderCircleProgressions } from './circle-o-5ths.js';
import { renderGuitarFretboard } from './guitar.js';

const piano = await renderPianoKeyboard({ target: 'piano-keyboard', dataUrl: 'DATA/piano_tuning.json', scrollTo: 'C4', mobileOctaves: 2, mobileQuery: '(max-width: 768px)' });
const audio = createPianoAudio({ baseUrl: 'DATA/piano/', ext: 'mp3', missing: ['A0', 'A#0', 'B0'] });
const el = document.getElementById('piano-keyboard');
el.addEventListener('piano:press',   (e) => audio.play(e.detail.note));
el.addEventListener('piano:release', (e) => audio.release(e.detail.note));
const chords = renderChordControls({ piano, audio, target: 'chord-controls' });
const progressions = await renderCircleProgressions({ piano, audio, target: 'root-circle-progressions', relativeTarget: 'minor-circle-progressions', selectorTarget: 'progression-selector' });
const guitar = await renderGuitarFretboard({ target: 'guitar-fretboard', dataUrl: 'DATA/guitar_tuning.json' });

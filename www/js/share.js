// =============================================================================
// share.js — sharing for Warbling Wren: permalinks (live URL state), the share button and the share modal.
// Future sharing methods (email, text message, social platforms) are added here.
//
//   const share = createShareState();                 // live ?query state
//   registerAppState(share, { chords, progressions, guitar, guitarChords });
//   share.restore();                                  // apply a shared link (page load)
//   share.start();                                    // keep the address bar in step with every change
//   renderShareButton({ target: IDS.share, getUrl: share.url, getSummary });
//   openShareModal({ target, url, title, qr })        // can also be called directly
//
// URL format (version 1) — readable parameters, defaults left out, in this order:
//   v=1                      format version (always first)
//   tuning=drop-d            guitar tuning (name in lowercase, ♭ -> b, spaces -> -); Standard is the default
//   chord=Bbm7b5             root chord (♭ -> b, ♯ -> #, sent as %23); C is the default
//   prog=jazz-ii-v-i         progression id (DATA/progressions.json)
//   pc / pcr                 piano voicing (octave 1–7) of the root / relative chord panel
//   pp / ppr                 piano voicings of the root / relative progression cards, in card order
//   gc / gcr                 guitar voicing (fret pattern) of the root / relative chord panel
//   gp / gpr                 guitar voicings of the root / relative progression cards, in card order
// Lists: one value per card joined with '.', '_' = card left at its default, trailing '_' dropped:
//   pp=_.4  -> card 2 at octave 4        gp=_.x5755x -> card 2 played x 5 7 5 5 x
// Fret pattern: one character per string, low string first: x = not played, 0–9, a–o = frets 10–24.
//
// Security: every value is checked against what the app offers (chord names, progression ids, tuning names,
// octave range, fret-pattern syntax + the chord's playable shapes) before it is applied; anything else is
// ignored with one console warning. Values are capped in length and never inserted as HTML.
// QR code (generator below, no dependencies; it exists to support sharing):
//   encodeQr(text, {ecl})   -> {version, size, ecl, mask, modules}   modules[y][x] = true for a dark module
//   renderQrSvg(text, opts) -> <svg> (DOM nodes only, no innerHTML), scales to its container
//   ISO/IEC 18004 byte mode (UTF-8), versions 1–40, error correction L/M/Q/H, all 8 masks + standard penalties.
//   Styling (hex colours only; anything else falls back to the default with a console warning):
//     background '#ffffff' · foreground '#303030' (data) · eye '#303030' (3×3 centres) · eyeBorder '#303030' (7×7 rings)
//
// Styles: www/css/www.css (SHARE section; --ws-* colours in :root).
// Changelog: v1 (2026-10-31) first version — permalinks, share button, modal with QR code + copy link.
//            v2 (2026-10-31) QR generator moved in from qr.js; styles moved from share.css into www.css.
// =============================================================================

export const VERSION = 2;
export const URL_FORMAT = 1;
// SYNC: --ws-css-version in www/css/www.css — share.js warns in the console if they differ
const CSS_VERSION = 1;

const MAX_VALUE = 120;                 // longest accepted parameter value (characters)
const MAX_LIST = 16;                   // longest accepted voicing list (cards)
// Document events after which the URL is rewritten (all bubble to document)
const WATCH = ['chord:select', 'chord:octave', 'progression:change', 'guitar:tuning', 'guitar-chords:show'];

/**
 * Live URL state. Each registered parameter reads its value from the app and can apply a value from a link.
 * @param {object} [opts]
 * @param {number} [opts.debounceMs]  wait after the last change before rewriting the address bar (default 250)
 * @param {string[]} [opts.watch]     document events that trigger a rewrite
 */
export function createShareState({ debounceMs = 250, watch = WATCH } = {}) {
  const params = [];                   // {key, get, set, initial}
  let timer = 0;
  let started = false;
  let restoring = false;

  const own = () => new Set(['v', ...params.map((p) => p.key)]);

  /**
   * @param {string} key   parameter name
   * @param {{get: () => string|null, set: (value: string) => boolean}} p
   *   get: current value as a string (null = nothing to share); the value at registration counts as the default
   *   and is left out of the URL. set: apply a value from a link; return false if it is not valid.
   */
  function register(key, { get, set }) {
    if (!/^[a-z]{1,8}$/.test(key) || params.some((p) => p.key === key)) throw new TypeError(`share: bad or duplicate parameter "${key}"`);
    params.push({ key, get, set, initial: safeGet(get) });
  }
  function safeGet(get) {
    try { const v = get(); return v == null || v === '' ? null : String(v); } catch (e) { console.warn('share:', e); return null; }
  }

  /** The share URL: this page + v=1 + every parameter that differs from its default. */
  function query() {
    const parts = [`v=${URL_FORMAT}`];
    for (const p of params) {
      const v = safeGet(p.get);
      if (v != null && v !== p.initial) parts.push(`${p.key}=${encodeValue(v)}`);
    }
    return parts.length > 1 ? `?${parts.join('&')}` : '';
  }
  const url = () => `${location.origin}${location.pathname}${query()}`;

  // Address bar: our parameters replaced, anything else in the query (and the #hash) kept as it was
  function addressBar() {
    const keep = [];
    const mine = own();
    for (const [k, v] of new URLSearchParams(location.search)) if (!mine.has(k)) keep.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    const q = query();
    const all = [q.slice(1), ...keep].filter(Boolean).join('&');
    return `${location.pathname}${all ? `?${all}` : ''}${location.hash}`;
  }
  function write() {
    timer = 0;
    const next = addressBar();
    if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', next);
  }
  const schedule = () => {
    if (restoring) return;
    clearTimeout(timer);
    timer = setTimeout(write, debounceMs);
  };

  /** Apply the parameters of the current URL (page load). Returns {applied:[keys], ignored:[keys]}. */
  function restore() {
    const q = new URLSearchParams(location.search);
    const applied = [];
    const ignored = [];
    const v = q.get('v');
    if (v != null && v !== String(URL_FORMAT)) {
      console.warn(`share: link format v=${String(v).slice(0, 8)} is not supported (this page reads v=${URL_FORMAT}) — opened with defaults`);
      return { applied, ignored: [...q.keys()] };
    }
    restoring = true;
    try {
      for (const p of params) {
        if (!q.has(p.key)) continue;
        const value = q.get(p.key);
        let ok = false;
        try { ok = value.length <= MAX_VALUE && p.set(value) !== false; } catch (e) { console.warn(`share: ${p.key}:`, e); }
        (ok ? applied : ignored).push(p.key);
      }
    } finally {
      restoring = false;
    }
    if (ignored.length) console.warn(`share: ignored link parameter(s) ${ignored.join(', ')} — not valid on this page; defaults used instead`);
    if (applied.length || ignored.length) {
      write();                                          // tidy the address bar (canonical order, invalid parts dropped)
      // a shared link opens at the top of the page, ready for scrolling
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      window.scrollTo(0, 0);
    }
    return { applied, ignored };
  }

  function start() {
    if (started) return;
    started = true;
    for (const type of watch) document.addEventListener(type, schedule);
  }
  function stop() {
    started = false;
    clearTimeout(timer);
    for (const type of watch) document.removeEventListener(type, schedule);
  }

  return { register, url, restore, start, stop, update: schedule, keys: () => params.map((p) => p.key) };
}

// Unreserved characters (letters, digits, - . _ ~) stay readable; everything else is percent-encoded
const encodeValue = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// --- value codecs --------------------------------------------------------------------------------------
const ascii = (s) => s.replace(/♭/g, 'b').replace(/♯/g, '#');
const tuningSlug = (name) => ascii(name).toLowerCase().replace(/[^a-z0-9#]+/g, '-').replace(/^-|-$/g, '');

/** One value per card joined with '.', '_' = default; trailing defaults dropped; null if every card is default. */
export function encodeList(list) {
  const out = (list ?? []).map((v) => (v == null ? '_' : String(v)));
  while (out.length && out[out.length - 1] === '_') out.pop();
  return out.length ? out.join('.') : null;
}
/** Inverse of encodeList; null if any entry fails the test (the whole parameter is then ignored). */
export function decodeList(value, test) {
  const parts = String(value).split('.');
  if (!parts.length || parts.length > MAX_LIST) return null;
  const out = parts.map((p) => (p === '_' || p === '' ? null : p));
  return out.every((p) => p == null || test(p)) ? out : null;
}
const OCTAVE = /^[1-7]$/;
const PATTERN = /^[x0-9a-o]{1,12}$/;                   // SYNC: fretPattern() in guitar-chords.js

/**
 * Register Warbling Wren's shareable state (see the URL format at the top of this file). Call after every
 * module has rendered its defaults and before restore().
 */
export function registerAppState(share, { chords, progressions, guitar, guitarChords }) {
  // tuning first: guitar voicings are shapes of the tuning they were chosen in
  if (guitar?.tunings && guitar?.setTuning) {
    const bySlug = new Map(guitar.tunings().map((t) => [tuningSlug(t.name), t.name]));
    share.register('tuning', {
      get: () => tuningSlug(guitar.tuning().name),
      set: (v) => bySlug.has(v) && guitar.setTuning(bySlug.get(v)),
    });
  }
  if (chords?.names && chords?.select) {
    const byAscii = new Map();
    for (const name of chords.names()) {
      const a = ascii(name);
      if (byAscii.has(a) && byAscii.get(a) !== name) console.warn(`share: chord names "${byAscii.get(a)}" and "${name}" share the link text "${a}"`);
      byAscii.set(a, name);
    }
    for (const name of chords.names()) if (!byAscii.has(name)) byAscii.set(name, name);   // a link with ♭ / ♯ typed in
    share.register('chord', {
      get: () => (chords.active() ? ascii(chords.active()) : null),
      set: (v) => byAscii.has(v) && chords.select(byAscii.get(v), { silent: true }),
    });
  }
  if (progressions?.select) {
    const ids = new Set(progressions.progressionIds?.() ?? []);
    share.register('prog', {
      get: () => progressions.state()?.root?.progression?.id ?? null,
      set: (v) => ids.has(v) && progressions.select(v),
    });
  }
  // voicings (after chord + progression: they belong to the chords those show)
  if (chords?.voicings) {
    for (const [key, slot] of [['pc', 'root'], ['pcr', 'relative']]) {
      share.register(key, {
        get: () => chords.voicings()[slot],
        set: (v) => OCTAVE.test(v) && chords.setVoicings({ [slot]: Number(v) })[slot],
      });
    }
  }
  if (progressions?.voicings) {
    for (const [key, slot] of [['pp', 'root'], ['ppr', 'relative']]) {
      share.register(key, {
        get: () => encodeList(progressions.voicings()[slot]),
        set: (v) => {
          const list = decodeList(v, (p) => OCTAVE.test(p));
          if (!list) return false;
          progressions.setVoicings({ [slot]: list.map((p) => (p == null ? null : Number(p))) });
          return true;
        },
      });
    }
  }
  if (guitarChords?.voicings) {
    for (const [key, slot] of [['gc', 'rootChord'], ['gcr', 'relativeChord']]) {
      share.register(key, {
        get: () => guitarChords.voicings()[slot],
        set: (v) => PATTERN.test(v) && (guitarChords.setVoicings({ [slot]: v }), guitarChords.voicings()[slot] === v),
      });
    }
    for (const [key, slot] of [['gp', 'root'], ['gpr', 'relative']]) {
      share.register(key, {
        get: () => encodeList(guitarChords.voicings()[slot]),
        set: (v) => {
          const list = decodeList(v, (p) => PATTERN.test(p));
          if (!list) return false;
          guitarChords.setVoicings({ [slot]: list });
          return true;
        },
      });
    }
  }
}

// =============================================================================
// QR code generator
// =============================================================================

export const QR_DEFAULTS = Object.freeze({
  background: '#ffffff',
  foreground: '#303030',
  eye: '#303030',
  eyeBorder: '#303030',
  ecl: 'M',          // ~15% damage tolerance: a good balance of density and robustness for screens
  margin: 4,         // quiet zone in modules (the standard minimum)
});

const ECL = { L: { ord: 0, fmt: 1 }, M: { ord: 1, fmt: 0 }, Q: { ord: 2, fmt: 3 }, H: { ord: 3, fmt: 2 } };

// Error-correction codewords per block and number of blocks, indexed [ecl.ord][version] (ISO/IEC 18004 table 9)
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

// modules available for data + ECC (everything except function patterns and format/version info)
function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver, e) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[e.ord][ver] * NUM_BLOCKS[e.ord][ver];

// --- Reed–Solomon over GF(2^8), generator polynomial 0x11D ---------------------------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/**
 * @param {string} text
 * @param {{ecl?: 'L'|'M'|'Q'|'H'}} [opts]
 * @returns {{version:number, size:number, ecl:string, modules:boolean[][]}}
 */
export function encodeQr(text, { ecl = QR_DEFAULTS.ecl } = {}) {
  const e = ECL[ecl] ?? ECL.M;
  const bytes = new TextEncoder().encode(String(text));

  // smallest version that holds the data (byte mode: 4-bit mode + 8/16-bit count + 8 bits per byte)
  let ver = 1;
  for (; ver <= 40; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
  }
  if (ver > 40) throw new RangeError(`qr: ${bytes.length} bytes is too long for a QR code at level ${ecl}`);
  const capBits = dataCodewords(ver, e) * 8;

  // --- bit stream ------------------------------------------------------------------
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capBits - bits.length));          // terminator
  put(0, (8 - (bits.length % 8)) % 8);                 // byte align
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // --- blocks + ECC, interleaved ----------------------------------------------------
  const numBlocks = NUM_BLOCKS[e.ord][ver];
  const eccLen = ECC_PER_BLOCK[e.ord][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);                       // placeholder, skipped when interleaving
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]); });
  }

  // --- matrix ------------------------------------------------------------------------
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }   // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {                       // finders + separators
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignmentPositions(ver);
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  const drawFormat = (mask) => {
    const d = (e.fmt << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
    setFn(8, 7, bit(b, 6));
    setFn(8, 8, bit(b, 7));
    setFn(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
    setFn(8, size - 8, true);                                // dark module
  };
  drawFormat(0);                                             // reserve the area
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
      setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i));
    }
  }

  // codewords in the zig-zag order (two-module columns, right to left, skipping the vertical timing line)
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
        if (!fn[y][x] && n < codewords.length * 8) {
          mod[y][x] = bit(codewords[n >>> 3], 7 - (n & 7));
          n++;
        }
      }
    }
  }

  // --- mask: try all 8, keep the lowest penalty -------------------------------------
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty(mod, size);
    if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m);                                           // undo (XOR)
  }
  applyMask(best);
  drawFormat(best);
  return { version: ver, size, ecl: Object.keys(ECL).find((k) => ECL[k] === e), mask: best, modules: mod };
}

// Standard penalty: runs of 5+, 2×2 blocks, finder-like 1:1:3:1:1 patterns, dark/light balance
function penalty(mod, size) {
  let score = 0;
  const lines = (get) => {
    for (let a = 0; a < size; a++) {
      let color = false; let run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
      const add = (len) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
      const count = () => {
        const k = hist[1];
        const core = k > 0 && hist[2] === k && hist[3] === k * 3 && hist[4] === k && hist[5] === k;
        return (core && hist[0] >= k * 4 && hist[6] >= k ? 1 : 0) + (core && hist[6] >= k * 4 && hist[0] >= k ? 1 : 0);
      };
      for (let b = 0; b < size; b++) {
        if (get(a, b) === color) {
          run++;
          if (run === 5) score += 3; else if (run > 5) score++;
        } else {
          add(run);
          if (!color) score += count() * 40;
          color = get(a, b);
          run = 1;
        }
      }
      if (color) { add(run); run = 0; }
      run += size;
      add(run);
      score += count() * 40;
    }
  };
  lines((y, x) => mod[y][x]);
  lines((x, y) => mod[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mod[y][x]) dark++;
      if (y < size - 1 && x < size - 1) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function colour(value, fallback, name) {
  if (value == null) return fallback;
  if (typeof value === 'string' && HEX.test(value.trim())) return value.trim();
  console.warn(`qr: ${name} must be a hex colour such as '#303030' — using ${fallback}`);
  return fallback;
}

/**
 * Styled QR code as an SVG element. The SVG has a viewBox and no fixed size, so it fills the width of its
 * container (size it with CSS); crisp at any size.
 * @param {string} text
 * @param {object} [opts]  background, foreground, eye, eyeBorder (hex), ecl, margin, label (accessible name)
 * @returns {SVGSVGElement}
 */
export function renderQrSvg(text, opts = {}) {
  const o = { ...QR_DEFAULTS, ...opts };
  const bg = colour(opts.background, QR_DEFAULTS.background, 'background');
  const fg = colour(opts.foreground, QR_DEFAULTS.foreground, 'foreground');
  const eye = colour(opts.eye, QR_DEFAULTS.eye, 'eye');
  const ring = colour(opts.eyeBorder, QR_DEFAULTS.eyeBorder, 'eyeBorder');
  const margin = Number.isInteger(o.margin) && o.margin >= 0 && o.margin <= 16 ? o.margin : QR_DEFAULTS.margin;
  const qr = encodeQr(text, { ecl: o.ecl });
  const { size, modules } = qr;
  const full = size + margin * 2;

  // finder pattern areas (7×7) are drawn separately so their ring and centre take their own colours
  const corners = [[0, 0], [size - 7, 0], [0, size - 7]];
  const inFinder = (x, y) => corners.some(([cx, cy]) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7);
  let data = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x] && !inFinder(x, y)) data += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  let rings = '';
  let eyes = '';
  for (const [cx, cy] of corners) {
    const x = cx + margin; const y = cy + margin;
    rings += `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z`;   // outer square minus inner (evenodd)
    eyes += `M${x + 2} ${y + 2}h3v3h-3z`;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const svg = node('svg', { viewBox: `0 0 ${full} ${full}`, 'shape-rendering': 'crispEdges', role: 'img',
    'aria-label': typeof o.label === 'string' && o.label ? o.label : 'QR code', class: 'qr-svg' });
  svg.append(
    node('rect', { width: full, height: full, fill: bg }),
    node('path', { d: data, fill: fg, class: 'qr-data' }),
    node('path', { d: rings, fill: ring, 'fill-rule': 'evenodd', class: 'qr-eye-border' }),
    node('path', { d: eyes, fill: eye, class: 'qr-eye' }),
  );
  svg.dataset.version = String(qr.version);
  return svg;
}

// =============================================================================
// Share button + modal (Bootstrap 4.6 markup and CSS; no Bootstrap JavaScript or jQuery needed)
// =============================================================================

function resolveDiv(target) {
  // DOM-clobbering guard: accept only a real HTMLDivElement
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  return el instanceof HTMLDivElement ? el : null;
}
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ws-icon');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const SHARE_ICON = ['M12 3v12', 'M7.5 7.5 12 3l4.5 4.5', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'];
const COPY_ICON = ['M9 9h10v10H9z', 'M5 15V5h10'];
const CHECK_ICON = ['M5 12.5 10 17.5 19 7'];
const CLOSE_ICON = ['M6 6l12 12', 'M18 6 6 18'];

/**
 * The share button (bottom of the page), rendered into `target`; a click opens the share modal there.
 * @param {object} o
 * @param {string|HTMLDivElement} o.target   e.g. 'share-modal' (<div id="share-modal" class="row">)
 * @param {() => string} o.getUrl            the link to share (share.url)
 * @param {() => string} [o.getSummary]      one line under the title, e.g. 'Dm7 · Jazz ii–V–I'
 * @param {object} [o.qr]                    QR colours (renderQrSvg options, below)
 * @returns {{element: HTMLButtonElement, open: Function, destroy: Function}|null}
 */
export function renderShareButton({ target, getUrl, getSummary = null, label = 'Share', qr = {} } = {}) {
  const host = resolveDiv(target);
  if (!host) { console.error(`share: #${target} is not a <div> — share button not shown`); return null; }
  if (typeof getUrl !== 'function') throw new TypeError('share: getUrl must be a function');
  const cssVersion = parseFloat(getComputedStyle(host).getPropertyValue('--ws-css-version'));
  if (cssVersion !== CSS_VERSION) {
    console.warn(`share: www/css/www.css (share styles) is ${Number.isFinite(cssVersion) ? `version ${cssVersion}` : 'missing or an older version'}; `
      + `share.js expects version ${CSS_VERSION} — the share button and modal may be unstyled`);
  }
  const col = el('div', 'col-12 ws-bar');
  const btn = el('button', 'ws-button');
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.append(icon(SHARE_ICON), el('span', 'ws-button-text', label));
  const open = () => openShareModal({ target: host, url: getUrl(), summary: getSummary?.() ?? '', qr, opener: btn });
  btn.addEventListener('click', open);
  col.append(btn);
  host.append(col);
  return { element: btn, open, destroy: () => col.remove() };
}

/**
 * Share modal: QR code of the link, then the link with a Copy button. Rendered into `target`.
 * Closes with ×, Escape, or a click outside the card; focus returns to the opener.
 * @param {object} o
 * @param {string|HTMLDivElement} o.target
 * @param {string} o.url                    must be an http(s) URL
 * @param {string} [o.title]                default 'Share'
 * @param {string} [o.summary]              one line under the title
 * @param {object} [o.qr]                   colours: background, foreground, eye, eyeBorder (hex)
 * @param {HTMLElement} [o.opener]          focus returns here on close
 * @returns {{close: Function}|null}
 */
export function openShareModal({ target, url, title = 'Share', summary = '', qr = {}, opener = document.activeElement } = {}) {
  const host = resolveDiv(target);
  if (!host) { console.error(`share: #${target} is not a <div> — share modal not shown`); return null; }
  let link;
  try { link = new URL(url); } catch { link = null; }
  if (!link || !/^https?:$/.test(link.protocol)) { console.error('share: url must be an http(s) URL'); return null; }
  host.querySelector(':scope > .ws-modal')?.dispatchEvent(new CustomEvent('ws:close'));   // one at a time

  const backdrop = el('div', 'modal-backdrop fade ws-backdrop');
  const modal = el('div', 'modal fade ws-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', summary ? `${title}: ${summary}` : title);
  modal.tabIndex = -1;
  const dialog = el('div', 'modal-dialog modal-dialog-centered ws-dialog');
  const content = el('div', 'modal-content ws-content');

  const header = el('div', 'modal-header ws-header');
  const heads = el('div', 'ws-heads');
  heads.append(el('h2', 'modal-title ws-title', title));
  if (summary) heads.append(el('p', 'ws-summary', summary));
  const close = el('button', 'ws-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.append(icon(CLOSE_ICON));
  header.append(heads, close);

  const body = el('div', 'modal-body ws-body');
  const figure = el('figure', 'ws-qr');
  try {
    figure.append(renderQrSvg(link.href, { ...qr, label: 'QR code for this link — scan it to open the page on another device' }));
    figure.append(el('figcaption', 'ws-qr-caption', 'Scan to open on another device'));
  } catch (e) {
    console.warn('share:', e);
    figure.append(el('figcaption', 'ws-qr-caption', 'This link is too long for a QR code — copy the link instead'));
  }

  const row = el('div', 'ws-link');
  const input = el('input', 'form-control ws-input');
  input.type = 'text';
  input.readOnly = true;
  input.value = link.href;
  input.setAttribute('aria-label', 'Link to share');
  input.spellcheck = false;
  const copy = el('button', 'ws-copy');
  copy.type = 'button';
  const copyText = el('span', 'ws-copy-text', 'Copy link');
  copy.append(icon(COPY_ICON), copyText);
  row.append(input, copy);
  const status = el('div', 'ws-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  body.append(figure, row, status);
  content.append(header, body);
  dialog.append(content);
  modal.append(dialog);
  host.append(backdrop, modal);

  // --- copy ---------------------------------------------------------------------
  let copiedTimer = 0;
  const copied = (ok) => {
    clearTimeout(copiedTimer);
    copy.classList.toggle('is-copied', ok);
    copy.replaceChildren(icon(ok ? CHECK_ICON : COPY_ICON), copyText);
    copyText.textContent = ok ? 'Copied' : 'Copy link';
    status.textContent = ok ? 'Link copied to the clipboard' : 'Select the link and copy it (Ctrl+C, ⌘C, or press and hold)';
    if (ok) copiedTimer = setTimeout(() => { copy.classList.remove('is-copied'); copy.replaceChildren(icon(COPY_ICON), copyText); copyText.textContent = 'Copy link'; status.textContent = ''; }, 2200);
  };
  const legacyCopy = () => {
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    try { return document.execCommand('copy'); } catch { return false; }
  };
  copy.addEventListener('click', async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(input.value); ok = true; }
    } catch { ok = false; }
    if (!ok) ok = legacyCopy();
    if (!ok) { input.focus(); input.select(); }
    copied(ok);
  });
  input.addEventListener('focus', () => input.select());

  // --- open / close ------------------------------------------------------------------
  const body0 = document.body;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  const prevPad = body0.style.paddingRight;
  body0.classList.add('modal-open');
  if (scrollbar > 0) body0.style.paddingRight = `${scrollbar}px`;   // no page shift when the scrollbar hides
  modal.style.display = 'block';
  void modal.offsetHeight;                               // reflow so the fade-in runs
  backdrop.classList.add('show');
  modal.classList.add('show');
  copy.focus({ preventScroll: true });

  let closed = false;
  function done() {
    clearTimeout(copiedTimer);
    modal.remove();
    backdrop.remove();
    if (!host.querySelector(':scope > .ws-modal')) {
      body0.classList.remove('modal-open');
      body0.style.paddingRight = prevPad;
    }
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
  }
  function hide() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    modal.classList.remove('show');
    backdrop.classList.remove('show');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) done(); else setTimeout(done, 200);
  }
  const focusables = () => [...modal.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); hide(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0]; const last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  close.addEventListener('click', hide);
  modal.addEventListener('ws:close', hide);
  // a click on the dimmed area around the card closes (Bootstrap's .modal covers the window)
  modal.addEventListener('mousedown', (e) => { if (e.target === modal || e.target === dialog) modal.dataset.down = '1'; else delete modal.dataset.down; });
  modal.addEventListener('click', (e) => { if ((e.target === modal || e.target === dialog) && modal.dataset.down === '1') hide(); });
  return { close: hide };
}

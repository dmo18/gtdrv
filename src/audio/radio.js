// Station composers for the car radio (docs/AUDIO.md, "Radio"). Each one
// writes one bar at a time as a list of notes:
//   { beat (0..4), inst, semi (from the sample's reference pitch), vel }
// like createComposer in music.js. The talk station also writes
//   { beat, inst: 'cap', text, dur }  (a caption to show, dur in seconds)
// and the vowel blips 'vocA', 'vocE', 'vocO', 'vocI'. Pure logic: runs in
// node tests. All variation comes from the seeded rng.
import { createComposer } from './music.js';
import { createRng } from '../core/rng.js';
import { DJ_LINES, AD_LINES, createCaptionPicker, pickIndex, syllables } from '../core/radio.js';

const MODES = { aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };
const pick = (rng, a) => a[Math.min(a.length - 1, Math.floor(rng.next() * a.length))];

// ---- station 1: chill driving synth (the original composer, own seed and tempo) ----
export function createChillComposer(rng) {
  return createComposer(rng, { tempo: [82, 12] });
}

// ---- station 2: dance pop, 118 to 124 BPM ----
const DANCE_PROGS = [[0, 5, 2, 6], [0, 3, 5, 4], [5, 3, 0, 6], [0, 6, 5, 6]];
const STAB_PATTERNS = [[0.75, 1.5, 2.25, 3], [0.5, 1, 2.5, 3.5], [0.5, 1.5, 2.5, 3.5], [0.75, 1.75, 2.75]];

export function createDanceComposer(rng) {
  const mode = MODES[pick(rng, Object.keys(MODES))];
  const root = Math.floor(rng.next() * 7) - 3;
  const tempo = 118 + Math.floor(rng.next() * 7);
  let prog = pick(rng, DANCE_PROGS);
  let stabs = pick(rng, STAB_PATTERNS);
  let arp = [];
  const newArp = () => {
    arp = [];
    for (let k = 0; k < 16; k++) arp.push(rng.next() < 0.7 ? Math.floor(rng.next() * 6) : -1);
  };
  newArp();
  const deg = (d) => mode[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  function bar(i) {
    const sec = Math.floor(i / 8) % 4; // intro, full, breakdown, full with lead
    const inSec = i % 8;
    if (inSec === 0 && i > 0) {
      if (rng.next() < 0.5) prog = pick(rng, DANCE_PROGS);
      stabs = pick(rng, STAB_PATTERNS);
      newArp();
    }
    const step = prog[inSec % 4];
    const chord = [deg(step), deg(step + 2), deg(step + 4)];
    const notes = [];
    for (const c of chord) notes.push({ beat: 0, inst: 'pad', semi: root + c, vel: 0.35 });
    if (sec !== 2) {
      for (let b = 0; b < 4; b++) notes.push({ beat: b, inst: 'kick', semi: 0, vel: 0.9 });
      for (let b = 0.5; b < 4; b += 1) notes.push({ beat: b, inst: 'hat', semi: 0, vel: 0.45 });
      if (sec !== 0 || inSec > 3) for (const b of [1, 3]) notes.push({ beat: b, inst: 'clap', semi: 0, vel: 0.6 });
      if (sec === 3) for (let b = 0.25; b < 4; b += 0.5) notes.push({ beat: b, inst: 'hat', semi: 0, vel: 0.18 });
    } else if (inSec >= 6) {
      // a build: the clap rolls into the next section
      for (let b = 0; b < 4; b += inSec === 7 ? 0.25 : 0.5) notes.push({ beat: b, inst: 'clap', semi: 0, vel: 0.2 + 0.1 * (inSec - 5) + b * 0.05 });
    }
    if (sec !== 0 || inSec > 3) {
      // rolling offbeat sub bass
      for (let b = 0.5; b < 4; b += 1) {
        notes.push({ beat: b, inst: 'sub', semi: root + chord[0] + (b === 2.5 && rng.next() < 0.4 ? 7 : 0), vel: 0.8 });
      }
    }
    if (sec === 1 || sec === 3) {
      for (const b of stabs) for (let k = 0; k < 3; k++) notes.push({ beat: b, inst: 'stab', semi: root + chord[k] + (k === 0 ? 12 : 0), vel: 0.4 });
    }
    if (sec === 3 || sec === 2) {
      for (let k = 0; k < 16; k++) {
        const a = arp[k];
        if (a < 0) continue;
        const tone = a < 3 ? chord[a] : chord[a - 3] + 12;
        notes.push({ beat: k * 0.25, inst: 'pluck', semi: root + tone, vel: 0.3 + 0.2 * rng.next() });
      }
    }
    return notes;
  }
  return { tempo, root, bar };
}

// ---- station 3: slow evening jazz: voiced chords, walking bass, brushes ----
const QUALITY = { m7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], M7: [0, 4, 7, 11], m7b5: [0, 3, 6, 10] };
const JAZZ_PROGS = [
  [[2, 'm7'], [7, 'dom7'], [0, 'M7'], [9, 'm7']],
  [[4, 'm7'], [9, 'dom7'], [2, 'm7'], [7, 'dom7']],
  [[0, 'M7'], [9, 'm7'], [2, 'm7'], [7, 'dom7']],
  [[2, 'm7b5'], [7, 'dom7'], [0, 'm7'], [0, 'm7']],
];
const COMP = [[0, 1.667], [1, 2.667], [0.667, 2], [1.667, 3.667], [0, 2.667], [1]];
const wrap = (x, lo) => ((((x - lo) % 12) + 12) % 12) + lo;

// A chord voicing: third, fifth, seventh and the ninth, kept inside one
// octave so the hand moves very little from chord to chord.
export function jazzVoicing(rootSemi, quality) {
  const q = QUALITY[quality] || QUALITY.m7;
  return [q[1], q[2], q[3], 14].map((x) => wrap(rootSemi + x, -2));
}

export function createJazzComposer(rng) {
  const tempo = 72 + Math.floor(rng.next() * 10);
  const root = Math.floor(rng.next() * 7) - 3;
  let prog = pick(rng, JAZZ_PROGS);
  function bar(i) {
    if (i % 8 === 0 && i > 0 && rng.next() < 0.5) prog = pick(rng, JAZZ_PROGS);
    const [rs, ql] = prog[i % 4];
    const next = prog[(i + 1) % 4][0];
    const q = QUALITY[ql];
    const base = root + rs;
    const notes = [];
    // keys: a syncopated comp in the swung eighths
    const voice = jazzVoicing(base, ql);
    const hits = pick(rng, COMP);
    for (let h = 0; h < hits.length; h++) {
      const b = hits[h];
      if (h > 0 && rng.next() < 0.18) continue;
      for (let k = 0; k < voice.length; k++) notes.push({ beat: b + k * 0.012, inst: 'keys', semi: voice[k], vel: 0.32 + 0.12 * rng.next() });
    }
    // a short melody from chord tones and the ninth, now and then
    if (rng.next() < 0.65) {
      const tones = [q[1], q[2], q[3], 14, 9];
      const slots = [1.667, 2, 2.667, 3, 3.667];
      const n = 2 + Math.floor(rng.next() * 3);
      let s = Math.floor(rng.next() * 2);
      for (let k = 0; k < n && s < slots.length; k++, s += 1 + Math.floor(rng.next() * 2)) {
        notes.push({ beat: slots[s], inst: 'keys', semi: wrap(base + pick(rng, tones), 12), vel: 0.4 + 0.15 * rng.next() });
      }
    }
    // walking bass: root, chord tone, chord tone, a half step into the next root
    const bass = [base, base + q[1 + Math.floor(rng.next() * 2)], base + q[2], root + next + (rng.next() < 0.5 ? 1 : -1)];
    for (let b = 0; b < 4; b++) notes.push({ beat: b, inst: 'dbass', semi: wrap(bass[b], -5), vel: b === 0 ? 0.85 : 0.65 });
    // brushes and ride
    for (let b = 0; b < 4; b++) notes.push({ beat: b, inst: 'brush', semi: 0, vel: b % 2 ? 0.55 : 0.33 });
    for (const [b, v] of [[0, 0.3], [1, 0.22], [1.667, 0.18], [2, 0.3], [3, 0.22], [3.667, 0.18]]) notes.push({ beat: b, inst: 'ride', semi: 0, vel: v });
    notes.push({ beat: 0, inst: 'feather', semi: 0, vel: 0.35 });
    if (rng.next() < 0.7) notes.push({ beat: 2, inst: 'feather', semi: 0, vel: 0.25 });
    return notes;
  }
  return { tempo, root, bar };
}

// ---- station 4: talk. A jingle, vowel-blip "speech" under a caption, songs,
// and an ad jingle after every third song. No words are ever spoken. ----
const ADJ = ['Midnight', 'Rusty', 'Quiet', 'Neon', 'Lazy', 'Golden', 'Foggy', 'Borrowed', 'Salty', 'Paper'];
const NOUN = ['Harbor', 'Gull', 'Causeway', 'Lantern', 'Engine', 'Tide', 'Postcard', 'Ferry', 'Rooftop', 'Anchor'];
const STING = ['Gullspeak: the talking shed of Rustwater.', 'You are tuned to Gullspeak.', 'Gullspeak, now with more gulls.'];
const VOWELS = ['vocA', 'vocE', 'vocO', 'vocI'];
const LOOP = ['dj', 'song', 'dj', 'song', 'dj', 'song', 'ad'];
export const TALK_TEMPO = 96;
const BEATS_PER_S = TALK_TEMPO / 60;

// The notes and timing of one spoken line: one vowel blip per syllable,
// the pitch falling at the end of a statement and rising on a question.
// Returns the events (beats, from `at`) and the length in seconds.
export function speechEvents(text, rng, at = 0) {
  const ev = [];
  const words = String(text).split(/\s+/).filter(Boolean);
  let t = 0;
  let semi = Math.floor(rng.next() * 4) - 2;
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    const n = syllables(word);
    const last = /[.!?]$/.test(word);
    const q = /\?$/.test(word);
    for (let s = 0; s < n; s++) {
      semi = Math.max(-5, Math.min(5, semi + Math.floor(rng.next() * 5) - 2));
      let sm = semi + (s === 0 ? 1 : 0);
      if (last && s === n - 1) sm += q ? 3 : -3;
      ev.push({ beat: at + t * BEATS_PER_S, inst: pick(rng, VOWELS), semi: sm, vel: 0.5 + 0.35 * rng.next() + (s === 0 ? 0.1 : 0) });
      t += 0.15 + 0.07 * rng.next();
    }
    t += /[,;:]$/.test(word) ? 0.2 : last ? 0.34 : 0.07;
  }
  return { events: ev, seconds: t };
}

export function createTalkComposer(rng) {
  const song = createComposer(createRng(Math.floor(rng.next() * 1e9) + 1), { tempo: [TALK_TEMPO, 1] });
  const dj = createCaptionPicker(rng, DJ_LINES);
  const ads = createCaptionPicker(rng, AD_LINES, 3);
  let events = [];
  let built = 0; // beats written
  let sbar = 0; // bars taken from the song composer
  let step = -1; // -1: the opening jingle, then the LOOP
  let lastTitle = -1;
  let lastSting = -1;
  const root = song.root;

  // the song's own bars; without `full` only pad and bass (a bed under speech)
  function bed(beat, bars, full) {
    for (let k = 0; k < bars; k++) {
      for (const n of song.bar(sbar++)) {
        if (!full && n.inst !== 'pad' && n.inst !== 'bass') continue;
        events.push({ beat: beat + k * 4 + n.beat, inst: n.inst, semi: n.semi, vel: n.vel * (full ? 1 : 0.55) });
      }
    }
  }
  // two bars: a rising figure on the pentatonic notes of the key, then a tag chord
  function jingle(ad) {
    const at = built;
    const pent = [0, 2, 4, 7, 9];
    let d = Math.floor(rng.next() * 3);
    const pat = ad ? [0, 0.5, 1, 1.5, 2, 3] : [0, 0.75, 1.5, 2, 2.5, 3.5];
    const inst = ad ? 'stab' : 'keys';
    for (let k = 0; k < pat.length; k++) {
      d = Math.max(0, Math.min(9, d + (rng.next() < 0.7 ? 1 : -1)));
      const semi = root + pent[d % 5] + 12 * Math.floor(d / 5);
      events.push({ beat: at + pat[k], inst, semi, vel: 0.6 });
      events.push({ beat: at + pat[k], inst: 'pluck', semi: semi + 12, vel: 0.4 });
    }
    for (const c of [0, 4, 7]) events.push({ beat: at + 4, inst, semi: root + c + 7, vel: 0.65 });
    events.push({ beat: at + 4, inst: 'kick', semi: 0, vel: 0.9 }, { beat: at + 4, inst: 'pad', semi: root, vel: 0.5 });
    if (!ad) {
      lastSting = pickIndex(rng, STING.length, lastSting);
      events.push({ beat: at, inst: 'cap', text: STING[lastSting], dur: 4 });
    }
    built += 8;
  }
  function speech(text, prefix) {
    const sp = speechEvents(text, rng, built + 0.4);
    for (const e of sp.events) events.push(e);
    const bars = Math.max(1, Math.ceil((0.4 + sp.seconds * BEATS_PER_S) / 4));
    events.push({ beat: built, inst: 'cap', text: prefix + text, dur: Math.max(3, sp.seconds + 1.8) });
    bed(built, bars, false);
    built += bars * 4;
  }
  function songSeg() {
    lastTitle = pickIndex(rng, ADJ.length * NOUN.length, lastTitle);
    const title = `${ADJ[lastTitle % ADJ.length]} ${NOUN[Math.floor(lastTitle / ADJ.length) % NOUN.length]}`;
    events.push({ beat: built, inst: 'cap', text: `Now playing: ${title}`, dur: 4.5 });
    bed(built, 8, true);
    built += 32;
  }
  function addSegment() {
    if (step < 0) jingle(false);
    else {
      const kind = LOOP[step % LOOP.length];
      if (kind === 'dj') speech(dj.next(), '');
      else if (kind === 'song') songSeg();
      else {
        jingle(true);
        speech(ads.next(), 'Ad: ');
      }
    }
    step++;
  }
  function bar(i) {
    while (built < (i + 1) * 4) addSegment();
    const lo = i * 4, hi = lo + 4;
    const out = [];
    const keep = [];
    for (const e of events) {
      if (e.beat >= lo && e.beat < hi) out.push({ ...e, beat: e.beat - lo });
      else if (e.beat >= hi) keep.push(e);
    }
    events = keep;
    return out;
  }
  return { tempo: TALK_TEMPO, root, bar };
}

export function createStation(id, rng) {
  if (id === 'chill') return createChillComposer(rng);
  if (id === 'dance') return createDanceComposer(rng);
  if (id === 'jazz') return createJazzComposer(rng);
  if (id === 'talk') return createTalkComposer(rng);
  return null;
}

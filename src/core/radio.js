// Car radio: the station list, the saved-setting check and the DJ caption
// lines (docs/AUDIO.md, "Radio"). Pure logic, runs in node tests. The
// talk station has no speech: these lines are shown as captions while a
// stylised synthesised texture plays. Everything here is original; no
// real station, song, brand or person is named.

export const STATIONS = [
  { id: 'off', name: 'Radio off', tag: 'Off' },
  { id: 'chill', name: 'Lagoon Drive', tag: 'Chill synth' },
  { id: 'dance', name: 'Pulse Harbour', tag: 'Dance pop' },
  { id: 'jazz', name: 'Lamplight Keys', tag: 'Evening jazz' },
  { id: 'talk', name: 'Gullspeak', tag: 'Talk and jingles' },
];
export const STATION_IDS = STATIONS.map((s) => s.id);
export const DEFAULT_STATION = 'off';

// Strict allow-list: anything that is not exactly a known id is 'off'.
export function sanitizeStation(v) {
  return typeof v === 'string' && STATION_IDS.includes(v) ? v : DEFAULT_STATION;
}

export function stationInfo(id) {
  return STATIONS[STATION_IDS.indexOf(sanitizeStation(id))];
}

// The next (dir 1) or previous (dir -1) station in the list, wrapping.
export function nextStation(id, dir = 1) {
  const i = STATION_IDS.indexOf(sanitizeStation(id));
  const n = STATION_IDS.length;
  return STATION_IDS[(((i + (dir < 0 ? -1 : 1)) % n) + n) % n];
}

// The radio plays in a car or a boat only.
export const canListen = (mode) => mode === 'car' || mode === 'boat';

// DJ chatter for the talk station: funny, about the island and the people
// who live on it. Short, so a caption fits a small strip.
export const DJ_LINES = [
  'Good evening, Rustwater. The gulls have voted and they want your fries.',
  'Traffic on the Long Causeway is moving at the speed of a thoughtful snail.',
  'Reminder: the lighthouse is not a drive-through, no matter what Big Hollis says.',
  'That was a song. This is a pause. Both are free.',
  'Doreen the dock cat has been elected harbour inspector again. No one ran against her.',
  'If you can read this caption, you are driving too slowly, or I am typing too fast.',
  'The ferry is late. The ferry has always been late. It is part of its charm.',
  'Weather: sunny, with a forty percent chance of seagulls on your windscreen.',
  'Marla at the fish stand says today is the freshest fish of the week. She says that daily.',
  'A pothole on Salt Street has been named Gerald. Please wave when you pass.',
  'Tonight on Gullspeak: tide tables, bad poetry and one very long argument about bridges.',
  'Remember, a handbrake turn is a hobby, not a commute.',
  'The mayor of the old quarter has lost his hat. It is on his head. We checked.',
  'Our traffic helicopter is a pigeon named Wendell. He is doing his best.',
  'Rustwater Harbour reminds boaters that water is deeper in the middle. You are welcome.',
  'Somebody has parked a boat on the roundabout again. The roundabout is fine, thank you.',
  'This next tune is dedicated to everyone who has ever honked at a pelican.',
  'Fun fact: the island has more lighthouses than lighthouse keepers. They are all on break.',
  'The bakery on Cog Lane has sold out of rolls and is now selling rumours.',
  'Seen a rusty van with a mattress on top? That is not a van, that is Tuesday.',
  'A shout out to the night shift at the cannery. You smell wonderful, we mean heroic.',
  'Old Tide Bridge will be closed for repairs. By repairs we mean a nap.',
  'Listener Pip asks: is it legal to race a tractor? We asked the tractor. It declined.',
  'Gullspeak: broadcasting from a shed with excellent acoustics and a leaky roof.',
  'If your engine makes a strange noise, it is probably singing. Let it finish.',
  'The beach café now serves soup in a hubcap. Reviews are mixed and warm.',
  'Local inventor Ottoline has built a car that runs on optimism. It is parked a lot.',
  'The tunnel under the hill is very long and very dark. Sing, it helps.',
  'Please do not feed the sharks. They have a diet plan and it is going well.',
  'Our sponsor tonight is the colour orange. Thank you, orange.',
  'In sports: the dock crane beat the lamppost in a staring contest. No winner was declared.',
  'Today is national Honk Gently Day. We invented it just now. Join us.',
  'The airfield wants you to know the runway is for planes. The cows have been told.',
  'A fog is rolling in. It has no destination, it just likes the view.',
  'Your horoscope: a left turn will go better than expected. A right turn will also be fine.',
  'The harbour master asks that boats stop waving at the bigger boats. It is unsettling.',
  'Somewhere out there, a donkey on Ferry Road is having the best day of his life.',
  'Back after this song, which has a trumpet. We were told there would be a trumpet.',
  'Keep both hands on the wheel and one eye on the pelican. Two if the pelican is large.',
  'Rustwater is the only island where the lighthouse has its own fan club. Hi, fan club.',
];

// Short ad breaks (a jingle plays first). Invented products only.
export const AD_LINES = [
  'Brinebrite Soap: for sailors, for sinks, for the occasional sea monster.',
  'Wobble and Sons Tyres: round, black and mostly legal.',
  'Visit Salty Sal\'s Noodle Dock. Slurping is encouraged, splashing is tolerated.',
  'Gullguard hats: because the sky is rude.',
  'Cog Lane Bakery: now with rolls. We found some.',
  'Harbour Mutual Boat Insurance: we cover waves, but not feelings.',
  'Dr. Kelp\'s Cough Syrup: tastes like the sea, works like a nap.',
  'Rattlebolt Garage: we fix it, or we politely hide it.',
];

// Pick a line index with the rng that is never the same as `last`
// (and so never the same line twice in a row). Deterministic per rng.
export function pickIndex(rng, count, last = -1) {
  if (count <= 1) return 0;
  let i = Math.floor(rng.next() * count);
  if (i >= count) i = count - 1;
  if (i === last) i = (i + 1 + Math.floor(rng.next() * (count - 1))) % count;
  return i;
}

// A caption picker over a list of lines: next() gives text, never the
// same line twice in a row, and also avoids the last few recent lines
// while the list is long enough, so the show feels varied.
export function createCaptionPicker(rng, lines = DJ_LINES, memory = 6) {
  const recent = [];
  let last = -1;
  const keep = Math.max(0, Math.min(memory, lines.length - 2));
  return {
    next() {
      let i = pickIndex(rng, lines.length, last);
      for (let tries = 0; tries < 12 && keep > 0 && recent.includes(i); tries++) i = pickIndex(rng, lines.length, last);
      last = i;
      if (keep > 0) {
        recent.push(i);
        if (recent.length > keep) recent.shift();
      }
      return lines[i];
    },
  };
}

// Rough syllable count of an English word (vowel groups, minus a silent e).
export function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (n > 1 && /[^aeiou]e$/.test(w) && !/le$/.test(w)) n--;
  return Math.max(1, n);
}

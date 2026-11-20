// Offline analysis of the whole generated sound bank in node (no
// browser): builds every buffer with the JS filter path, measures it and
// prints a table. `--json file` also writes the numbers; `--md` prints
// a Markdown table for docs/AUDIO.md. Nothing is played; these are
// measurements only.
import { writeFile } from 'node:fs/promises';
import { createBank } from '../src/audio/banks.js';
import { ENGINES } from '../src/audio/engines.js';
import { measure, pitchOf } from '../src/audio/analyze.js';

export function fakeCtx(sampleRate = 48000) {
  return {
    sampleRate,
    createBuffer(ch, n, sr) {
      const data = [];
      for (let c = 0; c < ch; c++) data.push(new Float32Array(n));
      return { numberOfChannels: ch, length: n, sampleRate: sr, duration: n / sr, getChannelData: (c) => data[c] };
    },
  };
}

export function buildAll(sampleRate = 48000) {
  const ctx = fakeCtx(sampleRate);
  const bank = createBank(ctx, { engines: Object.keys(ENGINES) });
  let guard = 0;
  while (!bank.step(1e9) && guard++ < 1e6) { /* JS path never waits */ }
  return bank;
}

const isMain = process.argv[1] && process.argv[1].endsWith('audio-analyze.mjs');
if (isMain) {
  const t0 = performance.now();
  const bank = buildAll();
  const ms = performance.now() - t0;
  const rows = [];
  const loops = new Set(bank.loops);
  for (const name of Object.keys(bank.buffers).sort()) {
    const b = bank.buffers[name];
    const d = b.getChannelData(0);
    const m = measure(d, b.sampleRate, loops.has(name));
    if (name.startsWith('eng:')) m.f0 = pitchOf(d, b.sampleRate, 15, 700);
    rows.push({ name, loop: loops.has(name), sr: b.sampleRate, ...m });
  }
  const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  const md = process.argv.includes('--md');
  if (md) {
    console.log('| sound | type | dur s | peak dBFS | RMS dBFS | crest dB | loud | centroid Hz | <100 | 100-300 | 300-1k | 1k-3k | 3k-8k | decay s |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  } else {
    console.log('name'.padEnd(24), 'L', '  dur', ' peak', '  rms', 'crest', ' loud', ' cent', ' flat', ' <100 100-3 .3-1k 1k-3k 3k-8k  >8k', 'decay', '  f0');
  }
  for (const r of rows) {
    const bands = r.bands.map((v) => (v * 100).toFixed(0).padStart(5)).join('');
    if (md) {
      console.log(`| ${r.name} | ${r.loop ? 'loop' : 'shot'} | ${f(r.dur, 2)} | ${f(r.peakDb)} | ${f(r.rmsDb)} | ${f(r.crestDb)} | ${f(r.lufs)} | ${f(r.centroid, 0)} | ${r.bands.slice(0, 5).map((v) => (v * 100).toFixed(0)).join(' | ')} | ${r.loop ? '-' : f(r.decay, 2)} |`);
    } else {
      console.log(r.name.padEnd(24), r.loop ? 'L' : ' ', f(r.dur, 2).padStart(5), f(r.peakDb).padStart(5), f(r.rmsDb).padStart(5), f(r.crestDb).padStart(5),
        f(r.lufs).padStart(5), f(r.centroid, 0).padStart(5), f(r.flat, 2).padStart(5), bands, f(r.decay, 2).padStart(5), r.f0 ? f(r.f0, 0).padStart(5) : '');
    }
  }
  console.log(`\n${rows.length} buffers, ${(bank.bytes / 1048576).toFixed(2)} MB, built in ${ms.toFixed(0)} ms (JS path, node)`);
  const ji = process.argv.indexOf('--json');
  if (ji > 0) await writeFile(process.argv[ji + 1], JSON.stringify(rows, null, 1));
}

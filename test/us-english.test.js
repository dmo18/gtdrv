// The game is American English with American units. This scans the source,
// the HTML pages and the docs for British spellings and for metric or
// 24-hour text a player could read, and fails with file:line.
// Internal metric values (m/s, km/h inside code, comments about meters) are fine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each entry skips a whole file, or only the lines holding `text`, with the reason.
const ALLOWLIST = [
  { file: 'docs/PLAN_V3.md', reason: 'the plan quotes the old British words (section 1.9) and lists them as the word counts it replaces' },
  { file: 'src/core/explore.js', text: 'a-port-quay', reason: 'old saves hold this adventure id; it is read and written back as a-port-pier' },
  { file: 'src/world/miami-spots.js', text: 'Brickell City Centre', reason: 'real name exactly as it is spelled in the OSM map data it is matched against' },
];

const BRITISH = [
  /cent(re|red|res|ring)\b/i, /\bmetres?\b/i, /kilomet(re|res)\b/i, /(?:milli|centi|deci)metres?\b/i, /colour/i, /\btyres?\b/i, /\bkerb/i, /\bgrey/i,
  /pavement/i, /favourite/i, /neighbour/i, /bonnet/i, /windscreen/i, /harbour/i, /\bquays?\b/i, /car[ -]parks?\b/i,
  /tarmac/i, /\bpetrol\b/i, /\blorr(y|ies)\b/i, /\blicence/i, /\btravell/i, /armour/i, /manoeuvr/i,
  /\bprogramme/i, /defence/i, /\bwhilst\b/i, /\bcancell/i, /behaviour/i, /\b(normal|organ|recogn|real|optim|initial|summar|stabil|synchron|serial|visual|custom|util|minim|maxim|categor|emphas)is(e|ed|es|ing|ation)\b/i,
  /\b(label|model|signal|level|fuel|travel)l(ed|ing)\b/i, /roundabout/i, /zebra/i, /\bpubs?\b/i, /\bcheers\b/i,
  /jewellery/i, /aluminium/i, /\btonnes?\b/i, /\bmum\b/i, /\bwing mirror/i, /\bcatalogue/i,
];
// A metric unit or a 24-hour clock inside a quoted string, or a pound sign anywhere.
const PLAYER_TEXT = [
  { re: /(['"`])[^'"`\n]*(\bkm\/h\b|\bkph\b|\bkilomet\w*|\blitres?\b|\d ?(km|kg|cm|mm)\b|°C\b)[^'"`\n]*\1/, why: 'metric unit in a string' },
  { re: /£/, why: 'pound sign' },
  { re: /(['"`])[^'"`\n]*\b(1[3-9]|2[0-3]):[0-5]\d\b[^'"`\n]*\1/, why: '24-hour clock text' },
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'data' && dir.endsWith(path.join('src', 'world'))) continue; // map data keeps OSM wording
      walk(p, out);
    } else out.push(p);
  }
}

function targets() {
  const all = [];
  walk(path.join(ROOT, 'src'), all);
  const files = all.filter((f) => f.endsWith('.js') || f.endsWith('.html'));
  for (const d of ['public', 'docs']) {
    const ext = d === 'public' ? '.html' : '.md';
    for (const n of fs.readdirSync(path.join(ROOT, d))) if (n.endsWith(ext)) files.push(path.join(ROOT, d, n));
  }
  return files.filter((f) => !ALLOWLIST.some((a) => !a.text && path.join(ROOT, a.file) === f));
}
const allowed = (f, line) => ALLOWLIST.some((a) => a.text && path.join(ROOT, a.file) === f && line.includes(a.text));

const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);

test('the allowlist stays tiny and every entry has a reason', () => {
  assert.ok(ALLOWLIST.length <= 3);
  for (const a of ALLOWLIST) {
    assert.ok(a.reason && a.reason.length > 20, a.file);
    assert.ok(fs.existsSync(path.join(ROOT, a.file)), a.file);
  }
});

test('no British spelling or word in src, public pages or docs', () => {
  const bad = [];
  for (const f of targets()) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (allowed(f, line)) return;
      for (const re of BRITISH) if (re.test(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${re} in "${line.trim().slice(0, 80)}"`);
    });
  }
  assert.deepEqual(bad, [], '\n' + bad.join('\n'));
});

test('no metric, pound or 24-hour text a player could read', () => {
  const bad = [];
  for (const f of targets()) {
    const isCode = f.endsWith('.js');
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (allowed(f, line) || (isCode && isComment(line))) return;
      const code = isCode ? line.replace(/\s\/\/ .*$/, '') : line;
      if (!isCode) return; // docs and pages: only the British word list applies
      for (const { re, why } of PLAYER_TEXT) if (re.test(code)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${why}: "${line.trim().slice(0, 80)}"`);
    });
  }
  assert.deepEqual(bad, [], '\n' + bad.join('\n'));
});

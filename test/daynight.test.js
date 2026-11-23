import test from 'node:test';
import assert from 'node:assert/strict';
import { skyAt, createDayNight } from '../src/systems/daynight.js';

const NUM = ['sunIntensity', 'hemiIntensity', 'sunDirX', 'sunDirY', 'sunDirZ', 'night', 'windowGlow'];
const HEX = ['sky', 'horizon', 'fog', 'sunColor', 'hemiSky', 'hemiGround'];
const channels = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

test('skyAt is continuous across midnight', () => {
  const a = skyAt(23.999), b = skyAt(0);
  for (const k of NUM) assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${k}: ${a[k]} vs ${b[k]}`);
  for (const k of HEX) {
    const ca = channels(a[k]), cb = channels(b[k]);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(ca[i] - cb[i]) <= 2, `${k} channel ${i}`);
  }
});

test('skyAt gives finite values all day', () => {
  for (let h = 0; h <= 24.0001; h += 0.05) {
    const s = skyAt(h);
    for (const k of [...NUM, ...HEX]) assert.ok(Number.isFinite(s[k]), `${k} at ${h}`);
    for (const k of HEX) assert.ok(s[k] >= 0 && s[k] <= 0xffffff, `${k} range at ${h}`);
    assert.ok(s.night >= 0 && s.night <= 1);
    assert.ok(s.windowGlow >= 0 && s.windowGlow <= 1);
  }
});

test('noon is brighter than midnight, but night is not black', () => {
  const noon = skyAt(12.5), mid = skyAt(0);
  assert.ok(noon.sunIntensity > mid.sunIntensity);
  assert.ok(noon.hemiIntensity > mid.hemiIntensity);
  assert.ok(mid.hemiIntensity > 0.5);
  const [r, g, b] = channels(mid.hemiSky);
  assert.ok(b > r && b > 60 && g > 20, 'moonlit blue');
});

test('night and window glow follow the time of day', () => {
  assert.ok(skyAt(1).night > 0.95);
  assert.ok(skyAt(13).night < 0.05);
  assert.ok(skyAt(1).windowGlow > 0.8);
  assert.ok(skyAt(23).windowGlow > 0.8);
  assert.equal(skyAt(12).windowGlow, 0);
});

test('sun is up by day and light never comes from below', () => {
  for (const h of [8, 10, 12, 14, 16, 18]) assert.ok(skyAt(h).sunY > 0, `sun at ${h}`);
  for (let h = 0; h < 24; h += 0.05) {
    const s = skyAt(h);
    assert.ok(Math.abs(Math.hypot(s.sunDirX, s.sunDirY, s.sunDirZ) - 1) < 1e-9, `normalised at ${h}`);
    assert.ok(s.sunDirY > 0, `light from above at ${h}`);
  }
  // At night the light follows the moon, not the sun under the ground.
  const n = skyAt(1);
  assert.ok(n.sunY < 0);
  assert.ok(n.sunDirX * n.moonX + n.sunDirY * n.moonY + n.sunDirZ * n.moonZ > 0.9);
});

test('day/night system runs without a scene and changes weather', () => {
  const seen = [];
  const game = { clock: 9, events: { emit: (n, w) => seen.push([n, w]) } };
  const dn = createDayNight(game, { dayMinutes: 14 });
  dn.render(1, 1 / 60);
  // One real day of steps returns the clock close to where it started.
  let wrapped = 0, prev = game.clock;
  for (let i = 0; i < 14 * 60 * 60; i++) {
    dn.fixedUpdate(1 / 60);
    if (game.clock < prev) wrapped++;
    prev = game.clock;
  }
  assert.equal(wrapped, 1);
  assert.ok(Math.abs(game.clock - 9) < 0.05, `clock ${game.clock}`);
  assert.ok(['clear', 'overcast', 'rain', 'fog'].includes(game.weather.name));
  assert.ok(dn.setWeather('rain', true));
  assert.equal(dn.weather, 'rain');
  assert.equal(game.weather.rain, 1);
  assert.ok(seen.some((e) => e[0] === 'weather' && e[1] === 'rain'));
  assert.equal(dn.setWeather('snow'), false);
});

test('sea shore map fills in slices and switches on', async () => {
  const { createWater } = await import('../src/render/water.js');
  // A straight shore along x = 0: land for x < 0.
  const w = createWater({ shoreDist: (x) => -x });
  const cam = { x: 100, z: 50 };
  for (let i = 0; i < 12; i++) w.update(i / 60, cam);
  const u = w.near.material;
  assert.ok(u, 'near sea material exists');
  // Moving far away starts a new fill without throwing.
  for (let i = 0; i < 12; i++) w.update(1 + i / 60, { x: 900, z: -400 });
});

test('weather and a lack of scene leave the day/night logic working', () => {
  const game = { clock: 17.5, progress: { settings: { reduceMotion: true } } };
  const dn = createDayNight(game);
  for (let i = 0; i < 120; i++) dn.fixedUpdate(1 / 60);
  assert.ok(Number.isFinite(game.clock));
  dn.setWeather('rain', true);
  assert.equal(game.weather.name, 'rain');
  assert.ok(game.weather.overcast > 0.9);
});

test('night layers come on one a frame, and go off at once', async () => {
  const THREE = await import('three');
  const scene = new THREE.Scene();
  const game = { clock: 13, scene, camera: new THREE.PerspectiveCamera(60, 2, 0.5, 2000), cityMesh: { userData: { lamps: [{ x: 0, z: 0, h: 7 }], glows: [] } } };
  const dn = createDayNight(game, { dayMinutes: 14 });
  const names = ['stars', 'lamp-glow', 'lamp-pools'];
  const on = () => names.filter((n) => scene.getObjectByName(n).visible).length;
  dn.render(1, 1 / 60);
  assert.equal(on(), 0, 'nothing of the night by day');
  dn.setHour(23.5);
  dn.render(1, 1 / 60);
  assert.equal(on(), 1, 'one layer on the first night frame');
  dn.render(1, 1 / 60);
  assert.equal(on(), 2);
  for (let i = 0; i < 4; i++) dn.render(1, 1 / 60);
  assert.equal(on(), 3, 'all of them a few frames later');
  dn.setHour(13);
  dn.render(1, 1 / 60);
  assert.equal(on(), 0, 'all off on the first day frame');
});

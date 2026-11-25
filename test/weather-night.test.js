// 0.13.5 weather and night: the sky, rain and sea fixes found with
// scripts/drive-review.mjs (--hour, --weather) at 748x360.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDayNight } from '../src/systems/daynight.js';

function world(clock) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 220, 1050);
  const camera = new THREE.PerspectiveCamera(60, 2, 0.5, 2000);
  const game = { clock, scene, camera, cityMesh: { userData: { lamps: [{ x: 0, z: 0, h: 7 }], glows: [] } } };
  const dn = createDayNight(game, { dayMinutes: 14 });
  return { game, scene, dn };
}

test('no stars in a pink dusk sky; they come out once it is dark', () => {
  const { scene, dn } = world(19.3);
  for (let i = 0; i < 6; i++) dn.render(1, 1 / 60);
  const stars = scene.getObjectByName('stars');
  assert.equal(stars.visible, false, 'dusk');
  assert.ok(stars.material.opacity < 0.02);
  dn.setHour(23);
  for (let i = 0; i < 6; i++) dn.render(1, 1 / 60);
  assert.equal(stars.visible, true, 'night');
  assert.ok(stars.material.opacity > 0.9);
});

test('the sky at and below the horizon is the fog color (no band from the air)', () => {
  const { scene } = world(19.3);
  const fs = scene.getObjectByName('sky-dome').material.fragmentShader;
  assert.match(fs, /col = mix\(col, uFog, exp\(-max\(y, 0\.0\) \* \d+\.0\)\);/);
});

test('rain: visible streaks near the eye, none at the lens, softer at night', () => {
  const { scene, dn } = world(13);
  dn.setWeather('rain', true);
  dn.render(1, 1 / 60);
  const rain = scene.getObjectByName('rain');
  assert.equal(rain.visible, true);
  const u = rain.material.uniforms;
  assert.ok(u.uBox.value.x <= 50, 'a small box keeps the drops near the eye');
  assert.ok(u.uOpacity.value >= 0.45, `day opacity ${u.uOpacity.value}`);
  assert.match(rain.material.vertexShader, /smoothstep\([\d.]+, [\d.]+, length\(rel\)\)/, 'near fade');
  const day = u.uOpacity.value;
  dn.setHour(23);
  dn.render(1, 1 / 60);
  assert.ok(u.uOpacity.value < day && u.uOpacity.value > 0.2, `night opacity ${u.uOpacity.value}`);
  dn.setWeather('clear', true);
  dn.render(1, 1 / 60);
  assert.equal(rain.visible, false);
});

test('sea: the shore tint fades at the edge of its window, the ripples by 75 m', async () => {
  const { createWater } = await import('../src/render/water.js');
  const w = createWater({ shoreDist: (x) => -x });
  const shader = { vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>', uniforms: {} };
  w.near.material.onBeforeCompile(shader);
  const fs = shader.fragmentShader;
  assert.ok(!/step\(0\.02, rwSu\.x\)/.test(fs), 'no hard cut at the window edge');
  assert.match(fs, /smoothstep\(0\.01, 0\.1, min\(rwE\.x, rwE\.y\)\)/);
  assert.match(fs, /smoothstep\(18\.0, 75\.0, rwD\)/);
});

test('particles fade out at the lens instead of filling the screen', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/render/effects.js', import.meta.url), 'utf8'));
  assert.match(src, /vCol = vec4\(iCol, iData\.y \* smoothstep\([\d.]+, [\d.]+, -mv\.z\)\);/);
});

// Connects the minimap and the full-screen map to the game: feeds them
// the player's position and blips, and handles the waypoint.
import { createMapRenderer, createMinimap, createFullMap } from '../ui/minimap.js';

const ZOOM = { foot: 110, car: 190, boat: 260, plane: 620, heli: 420 };
const BLIP_COLORS = { car: '#f4efe6', boat: '#7fd3e6', plane: '#ffd166', heli: '#ffd166' };

export function createMapUi(game, uiRoot) {
  const renderer = createMapRenderer(game.city);
  const minimap = createMinimap(game.hud.minimapCanvas, renderer);
  const blips = [];
  for (let i = 0; i < 48; i++) blips.push({ x: 0, z: 0, type: 'dot', color: '#fff' });
  const state = { x: 0, z: 0, heading: 0, zoomMetres: 190, blips, blipCount: 0, waypoint: null };
  // Other systems (races, deliveries) add their own markers here.
  const markers = [];
  let zoom = 190;
  let pausedByMap = false;

  const fullMap = createFullMap(uiRoot, renderer, {
    onWaypoint(p) {
      state.waypoint = p ? { x: p.x, z: p.z } : null;
      game.waypoint = state.waypoint;
      game.events.emit('ui');
    },
    onClose() {
      if (pausedByMap) game.paused = false;
      pausedByMap = false;
      game.touch.setVisible(true);
    },
  });

  return {
    name: 'map',
    renderer,
    markers,
    fullMap,
    addMarker(m) {
      markers.push(m);
      return m;
    },
    removeMarker(m) {
      const i = markers.indexOf(m);
      if (i >= 0) markers.splice(i, 1);
    },
    // Runs even while paused, so the map button always works.
    always() {
      if (game.input.consume('map')) {
        if (fullMap.isOpen()) fullMap.close();
        else {
          pausedByMap = !game.paused;
          game.paused = true;
          game.touch.setVisible(false);
          fullMap.open(state);
        }
      }
    },
    render(_alpha, dt) {
      const p = game.player;
      state.x = p.x;
      state.z = p.z;
      // Flying and driving: map turns with the craft. On foot: with the camera.
      state.heading = p.vehicle ? p.heading : game.camHeading;
      const target = (ZOOM[p.mode] || 190) + (p.y || 0) * 0.8;
      zoom += (target - zoom) * Math.min(1, dt * 2);
      state.zoomMetres = Math.round(zoom / 5) * 5;
      let n = 0;
      const vs = game.vehicles;
      const r2 = (state.zoomMetres * 1.1) ** 2;
      for (let i = 0; i < vs.length && n < 30; i++) {
        const v = vs[i];
        if (v === p.vehicle) continue;
        if (v.kind === 'car' && v.parked) continue;
        const dx = v.x - p.x, dz = v.z - p.z;
        if (dx * dx + dz * dz > r2 && v.kind === 'car') continue;
        const b = blips[n++];
        b.x = v.x;
        b.z = v.z;
        b.type = v.kind;
        b.color = BLIP_COLORS[v.kind] || '#fff';
      }
      for (let i = 0; i < markers.length && n < blips.length; i++) {
        const m = markers[i];
        const b = blips[n++];
        b.x = m.x;
        b.z = m.z;
        b.type = m.type || 'marker';
        b.color = m.color || '#e2733a';
      }
      state.blipCount = n;
      minimap.draw(state);
    },
  };
}

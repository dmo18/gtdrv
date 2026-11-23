// Connects the minimap and the full-screen map to the game: feeds them
// the player's position and blips, and handles the waypoint.
import { createMapRenderer, createMinimap, createFullMap } from '../ui/minimap.js';

const ZOOM = { foot: 110, car: 190, boat: 260, plane: 620, heli: 420 };
const BLIP_COLORS = { car: '#f4efe6', boat: '#7fd3e6', plane: '#ffd166', heli: '#ffd166', tank: '#c9b98a' };
const LAYER_REACH = 1.5; // minimap: a layer marker shows within this many zoom radii

export function createMapUi(game, uiRoot) {
  const renderer = createMapRenderer(game.city);
  const minimap = createMinimap(game.hud.minimapCanvas, renderer);
  const blips = [];
  for (let i = 0; i < 96; i++) blips.push({ x: 0, z: 0, type: 'dot', color: '#fff', h: 0, label: '', r: 0 });
  // Other systems (races, deliveries) add their own markers here:
  // { x, z, type, color, label? }. The full map draws the same list.
  const markers = [];
  // Layers (addLayer): { id, markers() } where markers() returns a list of the same shape,
  // read every frame (explore markers: type 'explore-rumour', 'explore-garage', 'explore-ring' with r).
  const layers = [];
  // What the full map draws: the plain markers, then every layer's (rebuilt in place each frame).
  const all = [];
  const state = { x: 0, z: 0, heading: 0, zoomMetres: 190, blips, blipCount: 0, waypoint: null, markers: all };
  let zoom = 190;
  let pausedByMap = false;

  // The Travel list (PLAN_V2 3.4): only on a Miami region; returns the plain refusal or ''.
  const travel = game.city.region
    ? { current: game.city.mapId, go: (id) => (game.session && game.session.travelTo ? game.session.travelTo(id) : '') }
    : null;
  const fullMap = createFullMap(uiRoot, renderer, {
    travel,
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
    // A named set of markers that follows its owner's list (adventures and garages add theirs
    // here so they show the question mark, ring and garage glyphs). Returns a handle.
    addLayer(layer) {
      if (!layer || typeof layer.markers !== 'function') return null;
      layers.push(layer);
      return { id: layer.id, remove() { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); } };
    },
    removeLayer(id) {
      for (let i = layers.length - 1; i >= 0; i--) if (layers[i].id === id) layers.splice(i, 1);
    },
    // The markers drawn on both maps, plain ones first.
    allMarkers: all,
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
        b.h = v.kind === 'tank' ? v.heading + (v.turretYaw || 0) : 0; // tank blip: barrel tick
        b.label = '';
        b.r = 0;
      }
      all.length = 0;
      for (let i = 0; i < markers.length; i++) all.push(markers[i]);
      const reach2 = (state.zoomMetres * LAYER_REACH) ** 2;
      for (let l = 0; l < layers.length; l++) {
        const list = layers[l].markers();
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          all.push(m);
          // the minimap shows the ones near enough, and the tracked ring always
          const dx = m.x - p.x, dz = m.z - p.z;
          if (n >= blips.length || (m.type !== 'explore-ring' && dx * dx + dz * dz > reach2)) continue;
          const b = blips[n++];
          b.x = m.x; b.z = m.z; b.type = m.type || 'marker'; b.color = m.color || '#e2733a'; b.label = m.label || ''; b.r = m.r || 0;
        }
      }
      for (let i = 0; i < markers.length && n < blips.length; i++) {
        const m = markers[i];
        const b = blips[n++];
        b.x = m.x;
        b.z = m.z;
        b.type = m.type || 'marker';
        b.color = m.color || '#e2733a';
        b.label = m.label || '';
        b.r = m.r || 0;
      }
      state.blipCount = n;
      // Under the title the HUD is hidden: the map raster waits for play (or main.js's idle build).
      if (uiRoot && uiRoot.style && uiRoot.style.visibility === 'hidden' && !renderer.built) return;
      minimap.draw(state);
    },
  };
}

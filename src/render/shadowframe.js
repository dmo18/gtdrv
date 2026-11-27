// The sun's shadow map frame (0.13.9 visual glitches). Pure numbers, no
// three.js: graphics.js turns the result into the shadow camera.
//
// Before, the shadow camera looked straight along the sun and snapped its
// position to whole texels in the sun's own axes. Those axes turned with
// the sun (daynight.js moves it in 0.1 degree steps, three times a second
// at the 14 minute day), and the city lies 2 to 6 km from the world origin,
// so each step slid the whole texel grid by meters: every shadow edge in
// view was drawn again on other texels, and thin shadows (lamp posts,
// signs, fences, railings) shimmered three times a second even with the
// camera standing still.
//
// Now the map is the ground seen along the sun: a point P goes to the
// ground point under it along the sun ray, (x - y lx/ly, z - y lz/ly), so
// the texel grid lies on the ground in world axes, the same for every
// sun. The frame's middle T snaps to whole texels of that grid as the
// camera moves; the sun can move every frame and the ground's texels stay
// where they are (only the casters' shadows move, as they should). Depth
// is the distance toward the sun, snapped to whole meters at T.
//
// The shadow camera stands at T with no rotation (view = P - T); its
// projection is the ortho box times the matrix M (row major):
//   [ 1, -lx/ly,  0, 0 ]   x' east on the ground
//   [ 0,  lz/ly, -1, 0 ]   y' north on the ground
//   [ lx,  ly,   lz, -D ]  z' toward the sun, the focus at -D
//   [ 0,   0,    0,  1 ]
// (determinant 1 / ly > 0, as a camera's view: the shadow pass keeps its
// back faces).
export const MIN_LY = 0.15; // the lowest sun the frame takes (about 8.6 degrees)

export function createShadowFrame() {
  return {
    tx: 0, tz: 0, // the frame's middle on the ground (whole texels)
    sx: 0, sz: 0, // the shear: lx / ly, lz / ly
    lx: 0, ly: 1, lz: 0,
    d: 0, // depth offset (the focus at z' = -d)
  };
}

// dir: unit vector toward the sun; (px, pz): the focus on the ground;
// texel: m per shadow texel; D: the camera's distance toward the sun.
export function shadowFrame(st, dx, dy, dz, px, pz, texel, D) {
  let ly = dy;
  if (ly < MIN_LY) ly = MIN_LY;
  const n = Math.hypot(dx, ly, dz);
  st.lx = dx / n; st.ly = ly / n; st.lz = dz / n;
  st.sx = st.lx / st.ly; st.sz = st.lz / st.ly;
  st.tx = Math.round(px / texel) * texel;
  st.tz = Math.round(pz / texel) * texel;
  const lt = st.lx * st.tx + st.lz * st.tz;
  st.d = Math.round(lt + D) - lt;
  return st;
}

// Map coordinates of a world point (before the ortho box), for tests and
// for the matrix: x', y' on the ground grid, z' toward the sun.
export function shadowMapXY(st, x, y, z, out) {
  const vx = x - st.tx, vz = z - st.tz;
  out.x = vx - y * st.sx;
  out.y = y * st.sz - vz;
  out.z = st.lx * vx + st.ly * y + st.lz * vz - st.d;
  return out;
}

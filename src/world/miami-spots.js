// Hand-placed places for the Miami map (docs/MAP.md section 3.3). Plain
// data: createMiamiCity (world/miami.js) snaps each one to the real
// streets and coastline, and test/miami.test.js checks every one against
// the data (on land, in water, clear of buildings).
//
// Coordinates: x east, z south, metres from lat 25.78, lon -80.18.

// Milestone 1 core crop: Downtown, Brickell, Overtown, Edgewater,
// Wynwood south, Watson Island and the west end of PortMiami. Land past
// the crop is cut off LAND_MARGIN metres outside it (a straight seawall);
// roads end at the crop edge itself.
export const MIAMI_CROP = { x0: -2600, z0: -2600, x1: 1400, z1: 1800 };
export const LAND_MARGIN = 150;

export const MIAMI_SPOTS = {
  // Player start: Southeast 1st Street in Downtown, facing east.
  spawn: { street: 'Southeast 1st Street', x: -1100, z: 780, heading: 0 },

  // Gullwing Airfield on an invented islet in open water in north
  // Biscayne Bay. The causeway leaves the east end of Northeast 24th
  // Street; the islet's z range follows from that node (as in citygen:
  // anchor z - 205 .. anchor z + 95), x from these values.
  airfield: { street: 'Northeast 24th Street', x: -585, z: -2257, isletX0: 10, isletX1: 790 },

  // Piers, contract order: three main piers, the airfield dock is added
  // last by the adapter. Each starts on land at (x, z) and is marched in
  // direction (dx, dz) to the shore, then built 64 m out to sea.
  piers: [
    { label: 'Bayfront Marina', x: -600, z: 330, dx: 1, dz: 0, boats: ['speedboat', 'fisher', 'jetski', 'yacht', 'dinghy', 'speedboat'] },
    { label: 'Watson Island Marina', x: 560, z: -300, dx: 0, dz: 1, boats: ['jetski', 'speedboat', 'jetski', 'dinghy'] },
    { label: 'Brickell Key Landing', x: -420, z: 1420, dx: 1, dz: 0, boats: ['fisher', 'dinghy', 'speedboat', 'jetski'] },
  ],

  // A seaplane by the real seaplane base on Watson Island (the second
  // one floats by the airfield dock, as on the procedural map).
  seaplane: { x: 300, z: -230, heading: Math.PI / 2 },

  // Open-ground helipad on Watson Island (citygen's docks pad).
  helipads: [{ label: 'Watson Island Helipad', x: 640, z: -640 }],

  // District table: later rects win. Keys are the procedural district
  // keys (DISTRICTS in citygen.js) so traffic mixes, peds and audio work.
  districts: [
    { key: 'midtown', x0: -4000, z0: -4000, x1: 4000, z1: 4000 },
    { key: 'residential', x0: -2700, z0: 250, x1: -1650, z1: 2000 },
    { key: 'industrial', x0: -2700, z0: -2700, x1: -1400, z1: -1900 },
    { key: 'downtown', x0: -1650, z0: -250, x1: -480, z1: 1300 },
    { key: 'downtown', x0: -1800, z0: 1100, x1: -800, z1: 2000 },
    { key: 'downtown', x0: -700, z0: 1250, x1: -300, z1: 1600 },
    { key: 'docks', x0: -480, z0: -150, x1: 1600, z1: 1000 },
    { key: 'residential', x0: -480, z0: -1450, x1: 1600, z1: -950 },
    { key: 'park', x0: 0, z0: -950, x1: 1100, z1: -150 },
    { key: 'park', x0: -820, z0: 380, x1: -480, z1: 1000 },
    { key: 'park', x0: -900, z0: -820, x1: -480, z1: -520 },
    { key: 'park', x0: -720, z0: -1330, x1: -480, z1: -1060 },
  ],

  // Short hand-made links where the flattened data leaves a real
  // connection out (the elevated ramps are dropped): pairs of points,
  // each snapped to the nearest graph node.
  links: [],
};

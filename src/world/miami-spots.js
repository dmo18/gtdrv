// Hand-placed places for the Miami map (docs/MAP.md section 3.3). Plain
// data: createMiamiCity (world/miami.js) snaps each one to the real
// streets and coastline, and test/miami.test.js checks every one against
// the data (on land, in water, clear of buildings).
//
// Coordinates: x east, z south, meters from lat 25.78, lon -80.18.

// Milestone 1 core crop: Downtown, Brickell, Overtown, Edgewater,
// Wynwood south, Watson, Star, Palm and Hibiscus Islands and the west
// half of PortMiami. Since milestone 3 the game builds the whole data
// box; the crop is only a test option (createMiamiCity opts.crop). Land
// past the crop is cut off LAND_MARGIN meters outside it (a straight
// seawall); roads end at the crop edge itself.
export const MIAMI_CROP = { x0: -2600, z0: -2600, x1: 2450, z1: 1800 };
export const LAND_MARGIN = 150;

// The core (docs/REVAMP.md 6.1): a quality tier, not a wall. The whole box
// is playable and dressed by the same rules; the core holds the hand
// content and is where the density tests run (test/world-density.test.js).
export const MIAMI_CORE = { x0: -2700, z0: -2700, x1: 2450, z1: 1900 };

// Player start (6.8): Southeast 1st Street in Downtown, facing east.
const SPAWN = { street: 'Southeast 1st Street', x: -1100, z: 780, heading: 0 };

// Course spec (world/courses.js buildSpecCourses): ids are the island's,
// so medals and best times keep their slots; names and routes are Miami's.
export const MIAMI_COURSES = {
  street: [
    { id: 'street-glasswell', name: 'Downtown Loop', laps: 2, blurb: 'Two laps of Downtown Miami: Biscayne Boulevard, Southeast 4th Street and Miami Avenue.',
      via: [{ x: -760, z: 150 }, { x: -740, z: 960 }, { x: -1370, z: 970 }, { x: -1400, z: 140 }] },
    { id: 'street-fernside', name: 'Calle Ocho Loop', laps: 2, blurb: 'Two quick laps of Little Havana, out along Calle Ocho and back.',
      via: [{ x: -1760, z: 1530 }, { x: -2420, z: 1530 }, { x: -2420, z: 1010 }, { x: -1760, z: 1010 }] },
    { id: 'street-rim', name: 'Bay Bridges Rally', laps: 1, blurb: 'One long lap of the bay bridges: the Venetian Causeway, the MacArthur Causeway and Biscayne Boulevard.',
      via: [{ x: -780, z: 400 }, { x: -760, z: -1150 }, { x: 2100, z: -1600 }, { x: 2100, z: -800 }, { x: -780, z: -620 }, { x: 1800, z: -100 }] },
  ],
  causeway: { name: 'Causeway Dash', blurb: 'From Edgewater across the causeway to the airfield gate and back.', a: { x: -900, z: -2560 }, b: { x: -900, z: -2200 }, c: { x: -1100, z: -2400 } },
  boats: [
    { id: 'boat-saltyard', name: 'Palm Island Sprint', blurb: 'A short dash east from Watson Island, past Palm and Hibiscus Islands.', r: 16,
      start: { x: 800, z: -1000 }, gates: [{ x: 1050, z: -950 }, { x: 1300, z: -900 }, { x: 1550, z: -820 }, { x: 1800, z: -740 }, { x: 2050, z: -650 }, { x: 2300, z: -520 }, { x: 2550, z: -420 }] },
    { id: 'boat-slalom', name: 'Venetian Slalom', blurb: 'Swing left and right through the buoys along the Venetian Causeway.', r: 13, maxLeg: 140,
      start: { x: -250, z: -1480 }, gates: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({ x: -150 + k * 150, z: k % 2 ? -1400 : -1560 })) },
    { id: 'boat-island', name: 'Fisherman\'s Channel Round', blurb: 'The big one: a full lap of the south bay, out along the port piers and back by Brickell Key.', r: 18, lap: true,
      start: { x: -150, z: 1650 }, gates: [{ x: -100, z: 1300 }, { x: 400, z: 900 }, { x: 1000, z: 1050 }, { x: 1600, z: 1350 }, { x: 2300, z: 1700 }, { x: 1600, z: 1800 }, { x: 900, z: 1800 }, { x: 200, z: 1800 }] },
  ],
  gull: { name: 'First Feathers', blurb: 'An easy, low loop around Gullwing Airfield. Take off east.' },
  threader: { name: 'Biscayne Threader', blurb: 'Down Biscayne Boulevard and back up Northeast 2nd Avenue, low between the towers.',
    rings: [
      { x: -110, z: -2300, y: 60, r: 16 },
      { x: -905, z: -2420, y: 50, r: 16 },
      { street: 'Biscayne Boulevard', x: -910, z: -2180, y: 30, r: 14, canyon: true },
      { street: 'Biscayne Boulevard', x: -905, z: -1850, y: 30, r: 14, canyon: true },
      { street: 'Biscayne Boulevard', x: -902, z: -1580, y: 30, r: 14, canyon: true },
      { street: 'Biscayne Boulevard', x: -910, z: -1090, y: 30, r: 14, canyon: true },
      { x: -960, z: -560, y: 60, r: 16 },
      { x: -1250, z: -380, y: 60, r: 16 },
      { street: 'Northeast 2nd Avenue', x: -1068, z: -640, y: 30, r: 14, canyon: true },
      { street: 'Northeast 2nd Avenue', x: -1067, z: -860, y: 30, r: 14, canyon: true },
      { street: 'Northeast 2nd Avenue', x: -1068, z: -1060, y: 30, r: 14, canyon: true },
      { x: -1150, z: -1500, y: 55, r: 16 },
    ] },
  rooftop: { name: 'Rooftop Hopper', blurb: 'Tight rings and three Edgewater rooftop touch-downs, then home to the helipad.' },
  courier: { name: 'Port Parcel Dash', blurb: 'A parcel from Wynwood for the PortMiami gate. Do not dawdle.', from: { x: -2000, z: -2300 }, to: { x: 100, z: 200 } },
  fare: { name: 'Fare and Square', blurb: 'A chatty passenger with stops in Little Havana, Brickell and Edgewater.', from: { x: -1200, z: 600 }, stops: [{ x: -2300, z: 1300 }, { x: -1100, z: 1650 }, { x: -850, z: -1900 }] },
  tide: { name: 'Brickell Key Parcel', blurb: 'Rush a crate from Bayfront Marina down the bay to Brickell Key.', start: { x: -300, z: 420 }, gates: [{ x: -280, z: 700 }, { x: -250, z: 1000 }, { x: -230, z: 1250 }, { x: -200, z: 1380 }] },
  airmail: { name: 'Gullwing Air Mail', blurb: 'Fly the mail bag from the airfield to the Watson Island helipad.' },
};

export const MIAMI_SPOTS = {
  // Player start: Southeast 1st Street in Downtown, facing east.
  spawn: SPAWN,

  // The designed first view (6.8): the title camera behind the spawn on
  // Southeast 1st Street, towers ahead lit by the low sun behind it.
  startView: {
    spawn: SPAWN,
    camera: { back: 22, side: 0.5, height: 7, lookAhead: 40, lookHeight: 6, fov: 55, dolly: 12, dollySpeed: 0.5 },
    time: 17.5,
    weather: 'clear',
    traffic: 6,
    parked: 6,
  },

  // Sand (lot type `beach`, 6.2 and 6.3): rects on real open or sandy
  // shores. The lot builder makes the land within 30 m of the water in a
  // rect a beach. `src` is the data name the shore is checked against.
  beaches: [
    // The open north shore of Watson Island, facing the Venetian Causeway.
    { name: 'Watson Island North Beach', src: 'Watson Island', x0: 60, z0: -900, x1: 900, z1: -760 },
    // The sandy causeway shore by the Rickenbacker Causeway (south edge of the box).
    { name: 'Rickenbacker Causeway Beach', src: 'Rickenbacker Causeway', x0: 0, z0: 3540, x1: 1000, z1: 3891 },
  ],

  // Gullwing Airfield on an invented islet in open water in north
  // Biscayne Bay. The causeway leaves the east end of Northeast 26th
  // Street (24th, as first planned, puts the islet within 100 m of a
  // small real island south of it); the islet's z range follows from
  // that node (as in citygen: anchor z - 205 .. anchor z + 95), x from
  // these values.
  airfield: { street: 'Northeast 26th Street', x: -551, z: -2416, isletX0: 10, isletX1: 790 },

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
    { key: 'midtown', x0: -5000, z0: -5000, x1: 5000, z1: 5000 },
    // Past the old core crop (milestone 3: the whole box).
    { key: 'industrial', x0: -4600, z0: -3950, x1: -2700, z1: -1700 },
    { key: 'residential', x0: -4600, z0: 400, x1: -2700, z1: 3950 },
    { key: 'residential', x0: -2700, z0: 1900, x1: -600, z1: 3950 },
    { key: 'residential', x0: 2700, z0: -3950, x1: 4600, z1: 2700 },
    { key: 'park', x0: 1500, z0: 2700, x1: 4600, z1: 3950 },
    { key: 'residential', x0: -2700, z0: 250, x1: -1650, z1: 2000 },
    { key: 'industrial', x0: -2700, z0: -2700, x1: -1400, z1: -1900 },
    { key: 'downtown', x0: -1650, z0: -250, x1: -480, z1: 1300 },
    { key: 'downtown', x0: -1800, z0: 1100, x1: -800, z1: 2000 },
    { key: 'downtown', x0: -700, z0: 1250, x1: -300, z1: 1600 },
    { key: 'docks', x0: -480, z0: -150, x1: 1600, z1: 1000 },
    { key: 'residential', x0: -480, z0: -1450, x1: 1600, z1: -950 },
    // Watson Island: the park polygons in the data stay parks; the rest
    // (in reality the attraction, museum, marina and hotel parcels) is
    // built land.
    { key: 'midtown', x0: 0, z0: -950, x1: 1100, z1: -150 },
    { key: 'park', x0: -820, z0: 380, x1: -480, z1: 1000 },
    { key: 'park', x0: -900, z0: -820, x1: -480, z1: -520 },
    { key: 'park', x0: -720, z0: -1330, x1: -480, z1: -1060 },
  ],

  // Landmarks with invented names and their own shapes (docs/REVAMP.md
  // section 2 and 6.1): each is drawn by the renderer as `shape` instead
  // of plain boxes, and is tall or open enough to be seen from 600 m.
  // `fit` 'site': it takes over the real footprints within `r` m of the
  // point (the boxes stay for collision and are marked `landmark`);
  // 'open': it stands on free ground found within 150 m of the point, as
  // one box of l by w m (x by z) and h m. Names are invented (D1); `on`
  // says what real place the site is, for the reader only.
  landmarks: [
    { id: 'tidewater-arena', name: 'Tidewater Arena', shape: 'arena', fit: 'site', x: -749, z: -204, r: 75, h: 34, on: 'the bayfront arena' },
    { id: 'riverfront-hall', name: 'Riverfront Hall', shape: 'drum', fit: 'site', x: -1146, z: 984, r: 40, h: 64, on: 'the convention hall on the river mouth' },
    { id: 'opal-opera', name: 'Opal Opera House', shape: 'shell', fit: 'site', x: -802, z: -1053, r: 70, h: 34, on: 'the performing arts center' },
    { id: 'wavecrest-terminal', name: 'Wavecrest Terminal', shape: 'wave', fit: 'site', x: 960, z: 348, r: 60, h: 30, on: 'a PortMiami cruise terminal' },
    { id: 'twin-spires', name: 'Brickell Twin Spires', shape: 'twin', fit: 'site', x: -1216, z: 1458, r: 45, h: 170, on: 'the Brickell towers by the Metromover' },
    { id: 'bayfront-sail', name: 'Bayfront Sail', shape: 'sail', fit: 'open', x: -700, z: 650, l: 30, w: 18, h: 30, on: 'Bayfront Park, by the amphitheatre' },
    { id: 'harbor-wheel', name: 'Harbor Wheel', shape: 'wheel', fit: 'open', x: -660, z: 200, l: 16, w: 16, h: 62, on: 'the bayfront north of Bayfront Park' },
    { id: 'key-point-light', name: 'Key Point Light', shape: 'lighthouse', fit: 'open', x: -360, z: 1480, l: 9, w: 9, h: 34, on: 'the east shore of Brickell Key' },
    { id: 'watson-aviary', name: 'Watson Aviary', shape: 'dome', fit: 'open', x: 560, z: -470, l: 40, w: 40, h: 30, on: 'the attraction parcels of Watson Island' },
    { id: 'omni-needle', name: 'Omni Needle', shape: 'needle', fit: 'open', x: -980, z: -1250, l: 10, w: 10, h: 135, on: 'Edgewater, by the old Omni site' },
    { id: 'wynwood-tank', name: 'Wynwood Water Tank', shape: 'watertower', fit: 'open', x: -2150, z: -2050, l: 14, w: 14, h: 44, on: 'a Wynwood warehouse block' },
    { id: 'overtown-arch', name: 'Overtown Rail Arch', shape: 'arch', fit: 'open', x: -1560, z: -420, l: 40, w: 8, h: 58, on: 'beside the rail line in Overtown' },
  ],

  // Short hand-made links where the flattened data leaves a real
  // connection out (the elevated ramps are dropped): pairs of points,
  // each snapped to the nearest graph node.
  links: [],

  // Police roof pad: the midtown roof nearest this anchor (Park West).
  roofPadAnchor: { x: -1150, z: -350 },

  // The Cinder tank (citygen's Cinder Row Rustback): on open ground in a
  // Wynwood warehouse yard nearest this point.
  cinder: { x: -2050, z: -2350 },

  // Gantry cranes on the PortMiami south pier (booms out over
  // Fisherman's Channel): each is moved down from (x, z) to the pier edge.
  cranes: [{ x: 1700, z: 1200 }, { x: 1780, z: 1240 }, { x: 1860, z: 1280 }],

  // The six secrets (ids and names kept so saves stay valid; see
  // world/secrets.js placeSecrets) and the Ghostwake garage.
  secrets: {
    // In Fisherman's Channel off the PortMiami south pier.
    'drowned-box': { x: 1300, z: 1160 },
    // A rooftop lounge on a Wynwood roof.
    'roof-garden': { region: { x0: -2550, z0: -2550, x1: -1500, z1: -1750 } },
    // The Brickell Key seawall, facing the bay.
    'the-gullet': { x: -280, z: 1600 },
    // The east tip of Palm Island, facing Miami Beach across the bay.
    rustlamp: { x: 2330, z: 250 },
    // The longest narrow gap between Wynwood buildings (the murals).
    'tag-alley': { region: { x0: -2550, z0: -2600, x1: -1480, z1: -1720 } },
    // Margaret Pace Park, on the Edgewater bayfront.
    'lone-ride': { x: -630, z: -1590 },
    // A lock-up by the Miami River boatyards.
    garage: { x: -2350, z: 420 },
  },

  // Street stunt ramps (original names, quiet streets); the two dock
  // ramps are added at the airfield islet as on the island map.
  ramps: [
    { name: 'Wynwood Kicker', street: 'Northwest 24th Street', x: -2000, z: -2220 },
    { name: 'Little Havana Hop', street: 'Southwest 4th Street', x: -2300, z: 1090 },
    { name: 'Edgewater Launch', street: 'Northeast 19th Street', x: -900, z: -1640 },
    { name: 'Palm Island Skip', street: 'Palm Avenue', x: 1800, z: 20 },
  ],

  // Neighborhood names for the HUD (placeOf). Later entries win. Each
  // `src` is the map-data feature (label, street, park, building or
  // water name) the name is taken from; a test checks it is in the data.
  // A rect is x0, z0, x1, z1; a `line` is a capsule ax, az, bx, bz, r.
  places: [
    // Past the old core crop (milestone 3); the entries after these win
    // where they overlap.
    { name: 'Allapattah', src: 'Allapattah', x0: -4600, z0: -3950, x1: -2700, z1: -1700 },
    { name: 'Civic Center', src: 'Civic Center Library Kiosk', x0: -4600, z0: -1700, x1: -2700, z1: 400 },
    { name: 'Little Havana', src: 'Life House, Little Havana', x0: -4600, z0: 400, x1: -2700, z1: 1900 },
    { name: 'Shenandoah', src: 'Shenandoah', x0: -4600, z0: 1900, x1: -2900, z1: 2800 },
    { name: 'Bay Heights', src: 'Bay Heights', x0: -4600, z0: 2800, x1: -2900, z1: 3950 },
    { name: 'The Roads', src: 'The Roads', x0: -2900, z0: 1900, x1: -1950, z1: 3000 },
    { name: 'Brickell', src: 'Brickell', x0: -1950, z0: 1900, x1: -600, z1: 3000 },
    { name: 'Brickell Hammock', src: 'Brickell Hammock', x0: -2900, z0: 3000, x1: -600, z1: 3950 },
    { name: 'Wynwood', src: 'Wynwood Walls', x0: -2700, z0: -3950, x1: -1700, z1: -2700 },
    { name: 'Midtown', src: 'Midtown', x0: -1700, z0: -3450, x1: -480, z1: -2700 },
    { name: 'Design District', src: 'Design District', x0: -1700, z0: -3950, x1: -480, z1: -3450 },
    { name: 'Miami Beach', src: 'Miami Beach', x0: 2700, z0: -3950, x1: 4600, z1: 1700 },
    { name: 'Fisher Island', src: 'Fisher Island', x0: 3300, z0: 1700, x1: 4600, z1: 2700 },
    { name: 'Virginia Key', src: 'Virginia Key Beach North Point Park', x0: 1500, z0: 2700, x1: 4600, z1: 3950 },
    { name: 'Overtown', src: 'Overtown Transit Village North', x0: -2700, z0: -1700, x1: -1450, z1: 400 },
    { name: 'Wynwood', src: 'Wynwood Walls', x0: -2700, z0: -2700, x1: -1450, z1: -1700 },
    { name: 'Edgewater', src: 'Edgewater', x0: -1450, z0: -2700, x1: -480, z1: -1100 },
    { name: 'Park West', src: 'Park West', x0: -1450, z0: -1100, x1: -480, z1: -100 },
    { name: 'Downtown Miami', src: 'Downtown Miami', x0: -1650, z0: -100, x1: -330, z1: 1100 },
    { name: 'Little Havana', src: 'Life House, Little Havana', x0: -2700, z0: 400, x1: -1950, z1: 1900 },
    { name: 'Brickell', src: 'Brickell', x0: -1950, z0: 1100, x1: -650, z1: 1900 },
    { name: 'Brickell Key', src: 'Brickell Key', x0: -700, z0: 1250, x1: -250, z1: 1750 },
    { name: 'Bayfront Park', src: 'Bayfront Park', x0: -820, z0: 200, x1: -330, z1: 820 },
    { name: 'Museum Park', src: 'Museum Park', x0: -900, z0: -820, x1: -480, z1: -480 },
    { name: 'Margaret Pace Park', src: 'Margaret Pace Park', x0: -710, z0: -1780, x1: -540, z1: -1370 },
    { name: 'Venetian Islands', src: 'Venetian Islands', x0: -480, z0: -1800, x1: 2700, z1: -950 },
    { name: 'Watson Island', src: 'Watson Island', x0: 0, z0: -950, x1: 1100, z1: -150 },
    { name: 'Dodge Island', src: 'Dodge Island Cut', x0: -250, z0: -150, x1: 2700, z1: 1700 },
    { name: 'Palm Island', src: 'Palm Avenue', line: [1230, -250, 2300, 250, 110] },
    { name: 'Hibiscus Island', src: 'North Hibiscus Drive', line: [1480, -590, 2420, -140, 95] },
  ],
  // On the water: Biscayne Bay, except along the river.
  waterPlaces: [
    { name: 'Biscayne Bay', src: '900 Biscayne Bay', x0: -5000, z0: -5000, x1: 5000, z1: 5000 },
    { name: 'Miami River', src: 'Miami River', x0: -2700, z0: 100, x1: -1980, z1: 720 },
    { name: 'Miami River', src: 'Miami River', x0: -2100, z0: 600, x1: -1500, z1: 1150 },
    { name: 'Miami River', src: 'Miami River', x0: -1550, z0: 950, x1: -640, z1: 1170 },
  ],

  courses: MIAMI_COURSES,

  // Text that names places (tutorial hints, the menu).
  texts: {
    craft: 'Boats wait at the piers. Aircraft are at Gullwing Airfield, out in the bay over the causeway from Northeast 26th Street.',
    fleet: 'The jet, stunt plane, heavy helicopter and yacht wait at Gullwing Airfield and Bayfront Marina.',
    boot: 'A bay city of rust, salt and bad ideas.',
  },
  // Secret notes worded for these spots (the Records list).
  secretNotes: {
    'drowned-box': 'A shipping container sinking off the PortMiami south pier.',
    'roof-garden': 'Somebody keeps a lounge on a Wynwood rooftop nobody can walk up to.',
    'the-gullet': 'A dark arch in the Brickell Key seawall.',
    rustlamp: 'A rusted lighthouse on the far tip of Palm Island.',
    'tag-alley': 'A narrow Wynwood alley with a tag that was not there yesterday.',
    'lone-ride': 'A playground in Margaret Pace Park with one ride too many.',
  },
};

// Real Miami places shown on the full map and the minimap, so a player can
// find them (not game places). `src` is the name in the map data (a label,
// building or park), `name` is what the map prints. Meters, same frame as
// the data. Virginia Key lies south of the data box, so it is not listed.
// Where the real name is a venue brand (decision D1) the map prints the
// invented name of the landmark that stands there (MIAMI_SPOTS.landmarks)
// or a plain description; `src` keeps the data name it was found by. The
// city adds its other invented landmarks after these (city.mapLandmarks).
export const MIAMI_LANDMARKS = [
  { name: 'Tidewater Arena', src: 'Kaseya Center', x: -749, z: -203.9, landmark: 'tidewater-arena' },
  { name: 'Freedom Tower', src: 'Freedom Tower', x: -1060.9, z: -55.2 },
  { name: 'Bayfront Park', src: 'Bayfront Park', x: -733.5, z: 762.1 },
  { name: 'Opal Opera House', src: 'Adrienne Arsht Center', x: -802.2, z: -1052.9, landmark: 'opal-opera' },
  { name: 'Downtown Rail Hub', src: 'Miami Central', x: -1574.4, z: 261.1 },
  { name: 'Government Center', src: 'Government Center', x: -1612.6, z: 437.8 },
  { name: 'Museum Park', src: 'Museum Park', x: -797.7, z: -658.1 },
  { name: 'Brickell Twin Spires', src: 'Brickell City Centre', x: -1215.7, z: 1458.1, landmark: 'twin-spires' },
  { name: 'Design District', src: 'Miami Design District', x: -1131.4, z: -3629.8 },
  { name: 'Little Havana', src: 'Latin Quarter', x: -3977.3, z: 1266.4 },
  { name: 'Vizcaya', src: 'Vizcaya', x: -3178.6, z: 3367.9 },
  { name: 'Port of Miami', src: 'Cruise Terminal D', x: 960, z: 347.7 },
  { name: 'Watson Island', src: 'Watson Park', x: 234.1, z: -562.7 },
  { name: 'Fisher Island', src: 'Fisher Island', x: 3944.9, z: 2120.2 },
  { name: 'Miami Beach', src: 'Miami Beach', x: 4475.7, z: -1436.6 },
  { name: 'Overtown', src: 'Historic Overtown/Lyric Theatre', x: -1630.3, z: -101.9 },
  { name: 'Wynwood', src: 'Wynwood Walls', x: -1517.3, z: -2381.3 },
  { name: 'Torch of Friendship', src: 'Torch of Friendship', x: -636.5, z: 584.7 },
  { name: 'Brickell Key', src: 'Brickell Key', x: -502.1, z: 1406.7 },
  { name: 'Venetian Islands', src: 'Venetian Islands', x: 1692, z: -1339.1 },
  { name: 'Flagler Street Theatre', src: 'Olympia Theater at Gusman Center', x: -1049, z: 655.6 },
  { name: 'Riverfront Hall', src: 'James L. Knight Center Theater', x: -1145.8, z: 984.2, landmark: 'riverfront-hall' },
  { name: 'Lummus Park', src: 'Lummus Park', x: -2312, z: 405.4 },
];

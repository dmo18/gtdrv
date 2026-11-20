// Hand-placed places for the Miami map (docs/MAP.md section 3.3). Plain
// data: createMiamiCity (world/miami.js) snaps each one to the real
// streets and coastline, and test/miami.test.js checks every one against
// the data (on land, in water, clear of buildings).
//
// Coordinates: x east, z south, metres from lat 25.78, lon -80.18.

// Milestone 1 core crop: Downtown, Brickell, Overtown, Edgewater,
// Wynwood south, Watson, Star, Palm and Hibiscus Islands and the west
// half of PortMiami. Land past
// the crop is cut off LAND_MARGIN metres outside it (a straight seawall);
// roads end at the crop edge itself.
export const MIAMI_CROP = { x0: -2600, z0: -2600, x1: 2450, z1: 1800 };
export const LAND_MARGIN = 150;

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
    { id: 'boat-island', name: 'Fisherman\'s Channel Round', blurb: 'The big one: a full lap of the south bay, out along the port quays and back by Brickell Key.', r: 18, lap: true,
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
  spawn: { street: 'Southeast 1st Street', x: -1100, z: 780, heading: 0 },

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

  // Police roof pad: the midtown roof nearest this anchor (Park West).
  roofPadAnchor: { x: -1150, z: -350 },

  // The Cinder tank (citygen's Cinder Row Rustback): on open ground in a
  // Wynwood warehouse yard nearest this point.
  cinder: { x: -2050, z: -2350 },

  // Gantry cranes on the PortMiami south quay (booms out over
  // Fisherman's Channel): each is moved down from (x, z) to the quay edge.
  cranes: [{ x: 1700, z: 1200 }, { x: 1780, z: 1240 }, { x: 1860, z: 1280 }],

  // The six secrets (ids and names kept so saves stay valid; see
  // world/secrets.js placeSecrets) and the Ghostwake garage.
  secrets: {
    // In Fisherman's Channel off the PortMiami south quay.
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

  // Neighbourhood names for the HUD (placeOf). Later entries win. Each
  // `src` is the map-data feature (label, street, park, building or
  // water name) the name is taken from; a test checks it is in the data.
  // A rect is x0, z0, x1, z1; a `line` is a capsule ax, az, bx, bz, r.
  places: [
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
    { name: 'Biscayne Bay', src: '900 Biscayne Bay', x0: -4000, z0: -4000, x1: 4000, z1: 4000 },
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
    'drowned-box': 'A shipping container sinking off the PortMiami south quay.',
    'roof-garden': 'Somebody keeps a lounge on a Wynwood rooftop nobody can walk up to.',
    'the-gullet': 'A dark arch in the Brickell Key seawall.',
    rustlamp: 'A rusted lighthouse on the far tip of Palm Island.',
    'tag-alley': 'A narrow Wynwood alley with a tag that was not there yesterday.',
    'lone-ride': 'A playground in Margaret Pace Park with one ride too many.',
  },
};

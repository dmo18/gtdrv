# Fleet style sheet (FLEET-0, version 0.10.0)

The design brief for the road vehicles of Rustwater (docs/PLAN_V3.md 1.3, 1.9, 2.4 and
2.6). It answers the owner's two lines about the cars, word for word:

> "All the cars look British not American"
> "All the cars are boxes, not really smooth cars, trucks, etc."

FLEET-0 builds three bodies to this sheet (a midsize sedan, a full-size SUV and a
full-size crew-cab pickup) at three levels each and sends their review sheets to the
owner. The other thirteen classes of the 2.4 table start only after his yes (task FLEET).

Everything here is invented. No real make, model, badge, grille shape, lamp signature or
logo is copied; the names are made up and checked against nothing but plain words.

## 1. What makes a car read as American (and not as a Euro hatchback)

1. Size. American cars are long and wide: a midsize sedan is 4.9 m long and 1.86 m wide,
   a full-size SUV 5.35 m by 2.06 m, a crew-cab pickup 5.9 m long. The old fleet was a
   3.8 m hatchback and a 4.6 m sedan.
2. A long hood. The windshield base sits far back from the nose: at least 1.25 m on every
   fleet body (sedan 1.6 m, SUV 1.6 m, pickup 1.9 m). The hood is a third of a sedan's
   side and almost half a pickup's.
3. A high belt line and a shallow greenhouse. The shoulder (the top of the doors) sits at
   63 to 66 percent of the car's height; the side glass is a band, not a wall.
4. A real trunk, a real bed, an upright tailgate. No hatchbacks in the American roles: the
   sedan has a 0.76 m trunk deck behind the rear glass, the pickup a 1.57 m open bed, the
   SUV an upright liftgate with three side windows.
5. Wheels at the corners, big wheels. Short front overhang, wheels of 0.69 m (sedan) to
   0.82 m (SUV, pickup) across, filling round arches.
6. A face. A wide chrome-framed grille between wide, low lamps; on the SUV and the pickup
   the grille is the tallest thing on the front, framed by upright lamp blocks.
7. Florida details: a plate on the rear only (white with green characters, the plate text
   of src/render/vehiclemats.js), red tail lamps with a small white reverse strip, amber
   side markers.
8. The driver sits on the left (-z in the car frame), the steering wheel in front of him.

## 2. What makes a car smooth (and not a box)

Every body is lofted: sections (rings) along the length, each a smooth curve, joined by
faces whose normals change little from one section to the next. No body part is a box,
at any level. Boxes remain only for small parts under 0.3 m (mirror arms, door pulls,
running-board hangers).

- Plan view: a superellipse per end (exponent `pF` / `pR`: 6 to 7 for the sedan, 9 to
  14 for the trucks), so corners are rounded in plan, tighter on the trucks.
- Side view: the deck (`top`), shoulder (`belt`) and sill (`bottom`) curves are
  monotone cubics through a dozen points; the ends lean in at the top and the chin
  (`lean`), so the fascias round over instead of standing as walls.
- Section: a tucked sill, a full lower door, a crisp character line, the upper door
  leaning in to the shoulder, then a crowned deck (superellipse exponent `q` 3.6 for the
  sedan, 4.4 to 4.6 for the trucks: flatter, with a tighter edge).
- Greenhouse: lofted on the deck; glass base, side glass, roof rail, crowned roof.
  Tumblehome (the glass leans in as it rises): 0.4 m per m on the sedan, 0.13 to 0.15 on
  the trucks.
- Wheel arches: cut into the sill line around each wheel with a rolled lip, dark liners
  inside, the fenders flared a little over the wheels.
- Creases are deliberate and few: door and hood shut lines (6 mm cuts), the greenhouse
  base, the bed edges. The smoothness test skips them and nothing else.

## 3. The three bodies

| | Avenel (midsize sedan) | Tallgrass (full-size SUV) | Ironbark (crew-cab pickup) |
|---|---|---|---|
| spec id | `midsize` | `suv` | `crewcab` |
| length, width, height | 4.90, 1.86, 1.45 m | 5.35, 2.06, 1.92 m | 5.90, 2.03, 1.95 m |
| wheelbase, wheel radius | 2.83, 0.345 m | 3.07, 0.41 m | 3.68, 0.41 m |
| windshield base behind the nose | 1.6 m | 1.6 m | 1.9 m |
| windshield rake (run over rise) | 1.65 | 1.13 | 1.23 |
| shoulder height | 0.92 m | 1.23 m | 1.28 m |
| roof | fast, to a short rear glass | flat, to an upright liftgate | flat cab, upright back glass |
| rear | trunk 0.76 m, lip spoiler | three side windows, roof rails | bed 1.57 m, tailgate |
| sides | two doors a side, chrome pulls | running boards | running boards |
| face | wide chrome grille, swept lamps with an L light guide, fog lamps | tall chrome grille, rectangular lamp blocks | tallest grille, upright lamps |
| tail | wide lamps joined by a light bar | tall corner lamps | tall corner lamps on the bed sides |
| wheels | 5 twin-spoke, silver | 6 wide spokes, bright | 6 wide spokes, dark |
| driver's eye (x, y, z) | -0.39, 1.17, -0.34 m | -0.17, 1.64, -0.40 m | -0.21, 1.68, -0.40 m |

Handling: the base chassis (sedan for the Avenel, pickup for the other two) until the
HANDLE task gives each class its own line of the 2.4 table. The pickup's longer
wheelbase gives a 7.5 m full-lock radius, as the table's 47 ft circle asks.

Names: invented words, no maker. Further names for FLEET, to be checked the same way:
Marlow (compact), Brigham (full-size sedan), Sandpiper (crossover), Redtail (muscle),
Kestrel (sports), Shoreline (convertible), Homestead (minivan), Cartway (cargo van).

## 4. Paint (US street palette)

White and black are the most common, then silver and gray, then blue and red. Each
body has its own list in its spec; lots add white (`0xe8e8e6`) and black (`0x24272b`).

| body | colors |
|---|---|
| Avenel | white, black, silver, gray, navy, red, bronze |
| Tallgrass | black, white, gray, slate blue, maroon, silver |
| Ironbark | white, black, silver, red, blue, olive |

Paint is one clearcoated material per color; dark colors read metallic, pale ones solid.

## 5. Three levels (none of them a box)

| level | range | triangles | draws | what it is |
|---|---|---|---|---|
| L0 | under 20 m, at most 4 cars (the nearest; the player's own always) | 5,900 to 6,600 | 4 | body with cabin (seats, dash, steering wheel on the left), see-through glass with the contact shadow, lamps (head, tail, plate), four instanced wheels |
| L1 | 20 to 60 m | about 1,300 | 1 | the mid body with the glass as a dark band, lamp lenses as vertex color bands (lit at night), grille, rear plate, four plain wheels, all one mesh in the paint material |
| L2 | 60 to 170 m, and the static parked cars in lots | about 290 | 1 (one per model in a lot) | an 8-section lofted shell: hood, cabin with tumblehome, dark glass band and roof rail, trunk deck or bed, wheel arcs, wheels with a hub, lamp dots and grille |

Past 170 m a fleet body is not drawn. Lot cars: up to 6 within 24 m are the L1 body
(one instanced draw per color), the rest the L2 shell, one instanced mesh per model with
the paint per instance, in a cheap diffuse material (sun and sky, no reflections) whose
lamp dots light at night.

Where it lives: `src/render/carbody.js` (styles `midsize`, `suv`, `crewcab`; `buildCar`,
`buildCarL1`, `buildCarL2`, `eyePoint`), `src/render/vehiclemesh.js` (the level
switch), `src/render/graphics.js` (which cars get L0, L1, L2), `src/systems/parked.js`
(lot shells), `src/render/vehiclemats.js` (`lotShellMaterial`).

## 6. Checks

Automatic (test/carmesh.test.js, the fleet tests):

- Triangles per level within the budgets above; draws 4, 1, 1; the level switch.
- Smoothness: along the length, the largest turn between neighboring faces of the upper
  body and deck stays under 14 degrees at L0, 30 at L1 and 50 at L2 (over the roof 1.6
  times that), shut lines and greenhouse ends excepted, nose and tail rounding (0.45 m)
  left out.
- Height profile: the hood never rises toward the nose and drops at least 6 cm over its
  last 40 cm, crowns in section; the roof is the highest point; the windshield climbs
  without a dip and is raked (run over rise over 0.9); the roof is narrower than the glass
  base (tumblehome); the sill lifts over each wheel (arches); a trunk, a bed, an upright
  tailgate as the class asks.
- Four wheels at every level; head and tail lamps at every level; a rear plate and no
  front plate.
- The driver's eye in the spec (`eye: {x, y, z}`) is on the left, in the cabin, and the
  steering wheel is in front of the left seat.

By eye: `node scripts/vehicle-shots.mjs --fleet` renders the review sheets to
`dist/fleet/` (915x412 at 2x, headless Chromium with SwiftShader): `side.png`,
`front.png`, `threequarter.png` (the three bodies, rows L0, L1, L2), one sheet per body
with a rear view (`midsize.png`, `suv.png`, `crewcab.png`), and `distance.png` (each
level at a distance it is drawn at, at the phone's scale). In the running game:
`node scripts/vehicle-shots.mjs --game --size=915x412 g:suv:side:11`.

Budgets: the Normal street view stays within 210 calls and 295k triangles on the Beach
and Downtown starts (`node scripts/perf.mjs`, `node scripts/perf.mjs map=miami-downtown`).

## 7. Rules for the other thirteen (task FLEET)

- Build on the same kit and the same three levels; a style per class, the 2.4 table's
  size, a face from section 1, a palette from section 4.
- Police is the full-size sedan in black and white with a push bar; the taxi the same
  body in yellow; the service vehicles keep their bodies with US details.
- Retire the hatchback, the one-box van and the cab-over truck from traffic and lots.
- Every class passes the fleet tests and gets its own review sheet before it ships.

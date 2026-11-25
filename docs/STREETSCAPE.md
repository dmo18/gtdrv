# Streetscape review (version 0.12.1, 0.13.2)

Owner's verdict on 0.10.0 and before: "wasteland", "not a single street
familiar", "fucked up looking roads", "glitchy wastelands"
(docs/owner/r3-*.jpg). Version 0.11.0 rebuilt junctions and lots. The
STREETSCAPE work started for 0.12.0, was parked in
docs/wip/0.12-partial.patch (its streetscape files: ground, junctions,
lots, citymesh, lotmesh, realcity, drive-review) and is finished here for
0.12.1. The patch file itself is left as it is.

## Method

`node scripts/drive-review.mjs <outDir> <tag>` builds the game into a
scratch folder (never `dist/`), and in each of the five regions follows a
1.5 km route along named main streets from the start: a chase-camera frame
every 50 m at 915x412 (31 frames a region), a top view from 40 m at every
fifth frame, and both views at the owner's spots. Contact sheets of four
frames go to `<outDir>/sheets/`. Options: `--only=<region,...>`, `--spots`
(the owner's spots only), `--at=name:x:z:headingDeg:height,...` (any other
place, with one region), `--night`, `--no-traffic`, `--no-build`.

Routes: Beach, Ocean Drive south then 5th Street west to Alton Road;
Downtown, Southeast 1st Street east then Biscayne Boulevard north; North,
Northwest 34th Street east then East Coast Avenue; West, Southwest 5th
Street east; South, Southwest 1st Avenue south-west then Southwest 28th
Road. Owner's spots: Downtown `miami-6th`, `sw1st-miami`, `se5th-brickell`;
Beach `ocean-10th`, `alton-5th`, `lincoln-washington`.

For 0.12.1 every region route and spot was shot (tag `r5`), then the
defect places again after each fix: Downtown `--at=bridge:-1352:1150:90:20`
(S Miami Ave bridge), `m6:-1376:1306:300:40` (S Miami Ave at SW 6th St),
`fan1:-1187:953:90:35`, `fan2:-2633:159:0:45`, `fan3:-1949:416:0:35`;
North `fc:-1963:-3121:0:40` (a forecourt). Checks in node (no browser):
what the ground says against what the meshes draw at a point, and a
0.5 m coverage map of road the meshes leave bare or cover with raised
sidewalk.

## Defects, ranked as the task gave them

| # | Place | What was wrong | Cause in code | Fix | State |
|---|---|---|---|---|---|
| 1 | Every region: gaps under 2 m between two road spaces | Road in physics (the narrow-gap net, `world/ground.js netAt`) but drawn as lot ground or bare land; between two sidewalks the net was a flat slot 15 cm deep, drawn as a green line | `netAt` had no mesh, and gave flat road whatever lay each side | `netAt` now gives raised sidewalk (2) where both sides are sidewalk or median, flat road (1) where either side is road. `ground.netQuads(x0, z0, x1, z1, out, kind)`: the net cells of one kind (same 0.25 m lattice, same `netAt`), flood filled from seeds where two roads are in reach and merged into rectangles. `render/citymesh.js netRoads` draws kind 1 as asphalt just under the strips, kind 2 as sidewalk just under the sidewalk top, in 60 m boxes per tile (`realcity.js NET_BOX`), into the tile's existing asphalt and sidewalk builders: no new draw call | Fixed. Test (d) untouched and at zero |
| 2a | S Miami Ave over the Miami River, x -1352, z 1100 to 1250 | A raised concrete strip with white walls down the middle of the avenue | The two bridge decks are 3.5 m apart over water: the sea-wall tracer (`world/edgelines.js`) put a 0.9 m rail along each deck's inner edge, drawn and solid | A divided road's left side reaches past the middle of a gap to its partner under `MEDIAN_GAP` (6 m), so there is no rail down the gap; the gap is paved as asphalt (`pairGap`, each half its share) and the inner deck side wall is not drawn | Fixed (bridge shot: one deck, lane paint, no rails) |
| 2b | S Miami Ave at SW 6th St (owner spot `miami-6th`) | A thin raised strip of sidewalk down the middle of the roadway, which a car drove through | Two carriageways of S Miami Ave overlap by about 1 m; one's 3 m right sidewalk lay on the other's asphalt (road first in the ground); the island next to it was two sidewalks with a 1 m slot | A strip's sidewalk piece is drawn only where the ground does not say road at its middle; corner triangles are judged by the ground (see 3); the slot is raised net (1) | Fixed |
| 3 | Fan junctions (rings that cross themselves): 32 in five regions (Beach 6, Downtown 8, North 2, West 6, South 10) | Spiky asphalt from a fan round the middle, sidewalk wedges and curbs across the asphalt | The ring drawn as a fan of triangles round the junction middle; corner triangles drawn whatever lay under them | `world/junctions.js`: a fan's asphalt (and its area in the ground) is each arm's carriageway carried straight from its mouth to its node plus the convex hull of those ends (straight edges, no spikes). `citymesh.js cornerTri`: every junction's corner triangles (not only fans') are tested at seven points against the ground and cut in four where mixed (to 1.5 m, three cuts at most), so a sliver across asphalt is not drawn; a curb return with road on both sides is not drawn; fans draw no curb through the crossing. About 4 % of corner triangles (all regions) had lain on road | Improved: clean arms, no spikes, no pads on asphalt. Where an arm's real sidewalk crosses between two other arms (fan1, S 1st Ave at SE 4th St) it is raised in physics and still drawn |
| 4a | Lawns and yards everywhere | Planting beds drawn as smooth green tubes | `render/lotmesh.js softStrip` drew a bed as one extruded profile | Beds are rows of faceted shrub mounds (15 triangles each, two sizes, one every 2.6 m, flowers on some); single shrubs use the same mound (was a 48-triangle blob); rows (hedge, fence, wall, bed) turn to the street grid of the block (`world/lots.js gridSkew`) | Fixed for beds. Clipped hedges stay soft strips (test "hedges, beds and shrubs are low soft forms" keeps them; a box hedge was tried and fails it); long ones along parking lots still read heavy |
| 4b | Forecourts (plaza lots), Downtown and North | The same 9 m lattice of tree, bed, bed, seat wall in every forecourt, on the raster axes | `dressLot` plaza: `gridPts(9, ...)` with a fixed modular pattern | A pitch of 8 to 11 m per lot, points nudged up to 1.1 m, one in five left open, the kind drawn per point from the lot's seed; seat walls turned to the street grid where both ends stay on the lot | Fixed (North `fc`) |
| 4c | Lawns beside every street | Lawns ended in 5 m stair steps with a band of pale paving before the sidewalk | Lots stop 4 m back from every curb on the 5 m raster; the band was plain land | `world/lots.js spreadGround` (`lotGrid.ground`): lot grounds spread two cells into land in no lot, so the lawn runs under the sidewalk and ends on its straight edge (`lotmesh.js lotFringe`). Lot ground and fringe quads now merge down z as well as along x (`groundRuns`), in 15-row bands: fewer triangles than before the fringe | Fixed |
| 4d | Lot to lot boundaries | A paved forecourt meets a lawn in 5 m steps | The lot raster itself | `render/lotmesh.js lotCut` (0.13.1): a cell on a stair between two grounds is split on its diagonal, edging along the cut | Fixed for 1-cell stairs; steeper steps keep a chamfer |

Also from the parked work, checked in the shots and kept: a planted median
runs on through a T that nothing crosses (`roadGeo.mthru`); where a street
crosses a divided road each half paves its share of the gap; the middle
of a median over 8 m is lawn; land within 7 m of a pedestrian street is
paving (no lawn onto Lincoln Road); a corner between two bare sides
(gore, gap) is asphalt; bay lines 0.24 m; no black shrubs or dumpsters
(negative index); lot features never stand on a junction's asphalt.

## Budget (Normal street view, `scripts/perf.mjs map=<region>`, day)

| Region | 0.12.0 | 0.12.1 |
|---|---|---|
| Beach | 130 calls / 244k | 122 / 233k |
| Downtown | 208 / 293k | 209 / 292k |
| North | 166 / 246k | 164 / 232k |
| West | 152 / 280k | 146 / 255k |
| South | 119 / 260k | 114 / 249k |

Static city draw calls are unchanged (68 in the Downtown view); call
counts move by a few between runs with traffic, events and police. The
two extra shader programs in every region are basic-material markers of
the event layer, not city materials.

## Not done

- Large plain paving round towers downtown.
- Hedges as described in 4a.
- Fan junctions are still wide asphalt where the data's arms cross; the
  list is `roadGeo.junctions.filter((j) => j.fan)`. (0.13.1: an arm's
  sidewalk stops at its mouth inside the mouth hull, which is paved.)
- 0.13.1 fixed: lot to lot 1-cell steps (4d), crossing lane paint of two
  overlapping carriageways (`paintRivals`), the Lincoln Road wedge (the
  ring past the streets' mouths drawn as mall paving). See docs/STATUS.md.

## 0.13.2 wastelands

`node scripts/drive-review.mjs <outDir> <tag> --survey --size=748x360
[--day]`: ten places a region picked from the city data (core, beach,
bridge, residential, industrial, park, airfield, parking lot, grass lot,
start street), each from the player's eye (1.6 m) and the chase camera,
day and night. Defects fixed, most seen first (details in docs/STATUS.md):

| # | Defect | Fix |
|---|---|---|
| 1 | Chipped, ragged edges on every line, stop bar and crosswalk | Worn paint holes 8 % to 1.6 % of the texture (`textures.js makePaint`) |
| 2 | Parking lots as grids of bricks | Island with a tree every 11 bays (was 14); day fills 0.45 / 0.42 / 0.42 Downtown, midtown, beach |
| 3 | Dead ends stop as a square cut in the lawn (399 in five regions) | `world/deadends.js deadEnds(city)`: a striped barricade just past each end, drawn (`props.js drawBarrier`) and solid (`collision.js`) |
| 4 | Containers as flat toy-colored boxes | Weathered paint, a darker top rail per tier |

Left: big sparse lawns (feature cap), bare works yards and parking lot
margins, hedge tubes along parking lots, `lotCut` sand triangles on a
beachfront plaza, a gray seam on some planted medians, an asphalt sliver
past a few dead ends.

## Data added

- `lotGrid.ground` (Uint8Array, one per land cell): the drawn ground type
  (lot type + 1) of the cell, made the first time it is read (a lazy,
  non-enumerable getter: about 70 ms on the whole box, kept out of the
  city build, whose lots stage had gone from about 4.0 to 5.0 of its 5.4
  calibration limit). `lotGrid.type` and `lotGrid.id` unchanged.
- Street-name blades are placed off a junction's asphalt
  (`world/miami.js bladesAndStops`); fan areas are smaller now, so some
  fan nodes gain a blade. The node fingerprints in test/regions.test.js
  were repinned for that (Beach has no change); edges, buildings, lots
  and lot grid fingerprints are unchanged.
- `roadGeo.mthru[q]` (Uint8Array per edge end): 1 where the median runs
  on through the junction at that end.
- `roadGeo.junctions[j].corners[k]`: `qa, sideA, qb, sideB`.
- A fan junction's `tris` are its arm carriageways and middle hull (was a
  fan round its middle); `ring` is unchanged.
- `groundOf(city).baseAt(x, z)` (the surface without the net) and
  `netQuads(x0, z0, x1, z1, out, kind = 1)`. `surfaceAt` gives 2 on raised
  net ground (was 1), so `groundAt` is the curb height there.
- `junctions.js pairGap(city, e, d, lc)`: distance from a divided half's
  left curb to its partner's.

Tests: test/streetscape.test.js (net kinds in physics and mesh, bridge
gaps on the road field, fan arms in the junction area, no raised sidewalk
drawn on road at the two defect places).

# Roads diagnosis and plan (0.15, milestone A, D1)

Owner, three rounds running (0.13.6 to 0.13.11): "roads are a mess and
make no sense": streets that do not line up, big to small width jumps,
illogical multi-lane streets, lines all over, grass in streets, light
poles in the road, misaligned crossings with grass wedges and slanted
sidewalk slabs, blocks that feel too long.

This file is the diagnosis (what is wrong, with numbers, and why in the
code) and the plan (four work packages on disjoint files). Nothing in
`src/` was changed for it.

## Method

- Top views: `node scripts/aerial-review.mjs <out> <tag> --only=<region>
  --at=name:x:z:side` (the game's own render, orthographic, north up,
  paint at any distance, no trees or fog).
- Street level: `node scripts/drive-review.mjs <out> <tag> --only=<region>
  --size=748x360 --day --at=name:x:z:headingDeg:topHeight` (chase camera
  25 m before the point; heading 0 is east, 90 south, 270 north).
- Node audits: `node scripts/street-align.mjs --json` (0.13.8) and the new
  `node scripts/road-audit.mjs [regions] [--json] [--list=<metric.path>]`
  (about 6 s for five regions, no browser). `--png=<file>:<region>:<x>:<z>:<side>`
  checks an aerial PNG against the physics ground: per ground kind
  (0 land or lot, 1 road, 2 sidewalk, 3 median) the area drawn green,
  pale or asphalt gray.
- Before images (this tree, 0.14.1 code): `docs/preview/roads-before-*.png`.

## What the player sees, per spot

Coordinates are world meters (x east, z south).

| # | Spot | Kind | What looks wrong | What a real road would look like |
|---|---|---|---|---|
| 1 | Beach, 5th Street at Alton Road (3935, 620) | multi-lane arterial, divided, bridge ramp to MacArthur Causeway | One asphalt field about 100 m across (junction ring 3397 m2, 8 nodes, 9 arms). A tiny triangle island floats in it. 5th Street's median stops and starts as thin green slivers beside the lanes. At street level the car sits in a gray plain with crosswalk bars off to one side. | Six-lane divided road: continuous raised medians ending in rounded noses at the crosswalks, a compact signalized box with curb returns, triangular slip-lane islands with curbs, crosswalks on every arm. |
| 2 | Beach, Washington Avenue at 7th Street (4645, 330), `roads-before-wash7-blob.png` | 4-way, one-way pair drawn as one road | An octagon of asphalt about 40 m wide (1241 m2) with straight chamfered corners instead of curb returns; the Washington arms enter 22 m out (trims) and their yellow lines cross with bits of gore chevron at the stop bar; the north and south arms are about 4 m out of line. | Four lanes with a double yellow running straight through a box no bigger than the two roads' widths plus 4 m curb returns. |
| 3 | South, SW 17th Avenue at SW 17th Terrace (-4226, 2662), `roads-before-sw17-bubble.png`; West, SW 17th Ave south of SW 8th St, `roads-before-sw17-chevrons.png` | 3-way, short split | Past a T, the avenue splits for 25 m (an OSM pedestrian refuge): drawn as two one-ways with white chevrons between them, a second set of stop bars and crosswalks mid-block, then joins again. At street level the chevrons sit in the driver's lane between the yellow lines. | One 2 + 2 avenue with its center turn lane; at most a small curbed refuge island at the crosswalk; stop bars only on the side street. |
| 4 | South, SW 22nd Street (Coral Way) at SW 3rd Avenue (-3440, 3210), `roads-before-sw22-slivers.png` | 5-arm junction of two divided roads | Medians end in square cuts, then trail off as a dashed line of green specks along the yellow line into the junction; a gore hatch in one carriageway; a 1791 m2 junction of 5 nodes. At street level the green dashes read as grass growing in the road. | A divided road's median ends in one rounded, curbed nose before the crosswalk; nothing green inside the curbs. |
| 5 | Beach, Meridian Avenue at 16th Street (4354, -1004), `roads-before-meridian16-width.png` | residential 4-way | Meridian is 7.2 m wide south of 16th (OSM class living_street) and 12 m north of it (residential): the road visibly doubles across the junction. The 12 m residential streets are unmarked and their 2.4 m parking lanes are nearly always empty, so they read as four-lane roads. | One width along the street (Meridian is one street), with parked cars filling most of the parking lanes so the moving lanes read as two. |
| 6 | Downtown, NW 27th Street at an offset crossing (-2322, -2441) | offset 4-way (two T's 21.6 m apart) | Two T junctions merged into one skewed parallelogram of asphalt; the north-south street has no curb between the two T's; slanted sidewalk wedges at the corners. | Two separate T junctions with a short block of the north-south street, curbed, between them. |
| 7 | Downtown, S Miami Avenue bridge over the Miami River (-1352, 1150), `roads-before-river-lots.png` | bridge ramp | The bridge itself is clean, but every lot around it is a parking lot of the same dark asphalt as the roads, with no curb or tone change: 21,800 m2 of road-colored lot against 16,200 m2 of real road in the 300 m square. Where the road ends is not readable. | Parking lots lighter or warmer, with visible bay lines, a curb and planting strip where they meet a street, entered only at driveways. |
| 8 | Downtown, SE 1st Street at SE 2nd Avenue (-1025, 733), and Biscayne Blvd at NE 2nd St (-780, 415) | downtown one-way grid, divided boulevard | Mostly sensible: one-way 3-lane streets with lane lines, compact boxes, crosswalks. One flaw: at the next corner south on SE 2nd Avenue (-1019, 822) a parallel carriageway and a curved, slanted sidewalk slab. | (Close to right; the grid works because its streets are one class, one way, and rarely split.) |
| 9 | Beach, Collins Avenue at 14th Street (4924, -588) | signalized 4-way | Looks offset in the top view, but the data and the drawn arms are straight (both arms at one node, -82 and 98 degrees): not a defect. | (As drawn.) |
| 10 | South, SW 20th Road at SW 5th Avenue (-2522, 2080) | the owner's 0.13.8 junction | Fixed in 0.13.8: a plain symmetric crossing. | (As drawn.) |

## Numbers (this tree, five regions)

From `scripts/road-audit.mjs` unless marked (street-align: `scripts/street-align.mjs`).

| Metric | Downtown | Beach | North | West | South | Total |
|---|---|---|---|---|---|---|
| Same-name straight joints (bend or junction) | 1573 | 1357 | 1191 | 1202 | 912 | 6235 |
| width change over 1 m | 133 | 182 | 75 | 124 | 112 | 626 |
| width change over 3 m | 94 | 164 | 64 | 111 | 107 | 540 |
| of which divided half against two-way block | 83 | 135 | 66 | 97 | 102 | 483 |
| half and two-way with different lanes per direction | 60 | 24 | 28 | 36 | 13 | 161 |
| class changes at a joint | 45 | 39 | 27 | 27 | 18 | 156 |
| parking changes at a joint | 38 | 41 | 8 | 14 | 5 | 106 |
| paint set changes at a joint | 57 | 27 | 16 | 27 | 12 | 139 |
| Median starts or stops at a joint | 36 | 40 | 25 | 10 | 16 | 127 |
| Gores (chevrons) | 40 | 38 | 20 | 23 | 24 | 145 |
| of which between two arms of one street | 18 | 19 | 10 | 13 | 13 | 73 |
| Divided runs / bubbles (both ends meet a two-way block) / bubbles under 60 m | 49 / 19 / 5 | 53 / 29 / 15 | 19 / 11 / 0 | 30 / 12 / 5 | 64 / 17 / 5 | 215 / 88 / 30 |
| Short split legs (unpaired one-way meeting a two-way block of its name, under 30 m) | 60 | 76 | 30 | 50 | 131 | 347 |
| Junctions | 819 | 607 | 641 | 619 | 436 | 3122 |
| junction area p50 / p90 (m2) | 325 / 558 | 324 / 567 | 340 / 515 | 338 / 511 | 356 / 674 | |
| junctions over 800 m2 / over 1500 m2 | 33 / 7 | 28 / 5 | 17 / 2 | 23 / 8 | 33 / 16 | 134 / 38 |
| junctions of 4 or more nodes | 35 | 29 | 3 | 18 | 34 | 119 |
| junctions where two halves of one street leave side by side | 106 | 120 | 58 | 68 | 131 | 483 |
| their area p90 (others' p90) | 1175 (462) | 950 (468) | 1353 (477) | 1104 (435) | 1133 (447) | |
| their arm trims p90 (others') m | 29 (13) | 19 (14) | 40 (12) | 26 (12) | 17 (12) | |
| Through junctions: data node lines over 1 m apart | 41 | 21 | 24 | 17 | 28 | 131 |
| drawn lane divide over 1 m apart where the data is not (one-way / two-way) | 28 / 1 | 39 / 3 | 19 / 0 | 8 / 1 | 8 / 0 | 102 / 5 |
| Sliver curb meters (non-road strip under 2 m, road beyond) | 624 | 456 | 196 | 256 | 372 | 1904 |
| of which lawn / sidewalk / median | 104 / 394 / 126 | 196 / 156 / 104 | 122 / 72 / 2 | 86 / 148 / 22 | 246 / 46 / 80 | 754 / 816 / 334 |
| along a divided half | 258 | 310 | 132 | 112 | 336 | 1148 |
| Strip over strip, away from junctions (m) | 196 | 48 | 0 | 16 | 0 | 260 |
| Junction to junction runs p50 / p90 (m) | 91 / 185 | 90 / 170 | 93 / 204 | 100 / 169 | 56 / 167 | |
| runs under 25 m | 327 | 340 | 113 | 234 | 464 | 1478 |
| street-align: merged halves' left curbs over 0.5 m apart (samples) | 495 / 785 | 881 / 2233 | 271 / 609 | 241 / 527 | 479 / 796 | 2367 / 4950 |
| street-align: yellow lines apart | 187 | 300 | 98 | 49 | 132 | 766 |
| street-align: corner sidewalk triangles on junction asphalt (junctions) | 99 | 92 | 53 | 61 | 58 | 363 |
| Parking lane meters within 135 m of the start / curb spots there | 670 / 24 | 950 / 22 | 1613 / 49 | 2120 / 62 | 666 / 23 | |

Widths in use (curb to curb, km of road): residential two-way 12 m on
53 to 86 km a region (all of it); living_street 7.2 m (Beach 6.6 km);
unclassified 7.2 m; one-way residential 3.9, 6.3, 8.7, 9.6 and 12 m;
one-way tertiary 3.9 to 12 m; secondary two-way 7.2, 10.5, 13.8 and 17.1 m.

Measured and fine (no action needed):
- Props on the drivable surface: 0 in five regions (test/props-offroad.test.js passes).
- Meshes agree with the physics ground: in eight 300 m top views the road
  ground is drawn green on 0 to 52 m2 (under 0.3 %), and road paint, not
  sidewalk, makes the pale pixels on it. "Grass in the street" is ground
  the physics also calls lawn or median (slivers, medians), not a mesh hole.
- Paint rules themselves: no lane line a section does not have, no center
  line on a one-way, every marked two-way road has one (0 contradictions);
  no two stop bars under 3 m apart.
- Curb steps at bends 0, arm mouths off their junction 0, stub arms 6
  (street-align, as 0.13.8 left them).
- Block lengths are to real scale (p50 56 to 100 m, Miami's grid is 90 to
  200 m); 0.13.7 found the chase camera's width, not the map, made blocks
  feel long.
- Data jogs: of 76 two-way through junctions over 1 m out of line, 71 are
  in the data (offset streets); only 5 come from the code.

## Ranked problems and root causes

Ranked by how much a player sees them (street level, in the first
minutes of a drive). Type: D bad source data, I interpretation of the
data, G geometry, M markings, P props or lots.

1. **Divided streets that are not really divided (I).** OpenStreetMap
   splits a street into two one-ways for a refuge island, a turn bay or a
   narrow median, often for 25 to 80 m. The game draws each split as two
   one-way roads that meet the two-way block at an angle: chevrons in the
   lane (73 gores between two arms of one street), stop bars and
   crosswalks mid-street, medians that start and stop (127), 30 bubbles
   under 60 m, 347 short split legs, two halves drawn "as one road" whose
   curbs are apart in 48 % of samples. Cause: `world/roadprofile.js
   pairDivided` only pairs halves running parallel at their midpoints
   (dot under -0.85, within 30 m) and only decides median or `off`; nothing
   ever turns a pair back into one street, and the angled split legs are
   never paired (`world/miami.js` builds the graph from ways as they are).
2. **Oversized junctions (G).** 134 junctions over 800 m2 (the median is
   330), 38 over 1500 m2. 82 of the 134 are where two halves of one
   street leave the junction side by side: each half is its own arm, and
   `world/junctions.js solveTrims` (clipReach, cornerOf) needs long trims
   to separate two arms a few degrees apart (p90 17 to 40 m against 12 to
   14), so the ring grows; `pairShifts` handles only halves without a
   median; `goreOf` paints chevrons between partners. Multi-node clusters
   (119 of 4 or more nodes) add to it: `buildRoadGeo` unions nodes under
   `CLUSTER_LEN` and `mergeClusters` joins two junctions whose trims want
   more than the edge between them.
3. **Width jumps along one street (I).** 626 same-name straight joints
   change width by over 1 m (540 by over 3 m). 483 are a divided half
   against a two-way block, and in 161 of them the half carries a
   different number of lanes than the two-way block has per direction
   (a 2 + 2 avenue splitting into 1-lane or 3-lane halves). 65 are class
   changes (living_street or unclassified at 7.2 m against residential at
   12 m, Meridian Avenue), 50 parking. Causes: `roadprofile.js
   roadProfile` decides parking by class (`PARKING` is residential and
   tertiary only), so width follows the OSM class; `harmonizeStreets`
   refuses to join a run across a class change at a junction (`!bend &&
   e.cls !== f.cls`) and across one-way against two-way (`e.oneway !==
   f.oneway`).
4. **Local streets read as four-lane roads (I, P).** Every residential
   two-way street is 12 m: 1 + 1 lanes plus a 2.4 m parking lane on each
   curb, unmarked. The parking lanes are almost always empty: within 135 m
   of each start there are 670 to 2120 m of parking lane and 22 to 62 curb
   spots, so even if every spot held a car 78 to 86 % of the lane would be
   bare; the live parked cap (40 on Normal, shared with lot bays) leaves
   fewer still. Causes: `world/miami.js` streetProps lists a curb spot on
   22 % of 6.5 m slots (`rng.chance(0.22)`); `systems/parked.js
   PARKED_CAP`; `roadProfile` parks every residential and tertiary street
   on both curbs.
5. **Grass and sidewalk slivers between road surfaces (G).** 1904 m of
   curb have a strip of non-road under 2 m wide with more road beyond it
   (754 m lawn, 816 m sidewalk, 334 m median), 60 % along divided halves.
   At street level they are the green dashes along the yellow line and
   the square median ends (Coral Way). Cause: `world/ground.js
   geoSurface`: a gap is paved only between strips facing within 25
   degrees (`gapAt`, GAP_MAX) and a sidewalk fill only where a side has a
   sidewalk (`fillAt`); a divided half's median band is half the real gap
   up to 4 m (`junctions.js medianAt`), so converging halves leave lawn or
   a median under 1 m between them; `render/citymesh.js` cuts median ends
   square where the ground says road.
6. **Lane lines jump sideways across junctions on one-way pairs (G).**
   102 one-way through junctions where the drawn lane divide moves over 1
   m though the data lines up (worst 7.5 m, Ocean Drive at 4674, 1296;
   6.8 m Washington Ave at 4645, 320). Cause: `pairDivided` sets `off`
   per edge (from its own midpoint gap, then the mean of its end gaps,
   only within `PAIR_END_MAX`), and `junctions.js pairEnds` aligns the
   ends only at bends; across a junction the next edge's `off` differs
   (Washington: 1.9 m against -0.5 m).
7. **Offset crossings drawn as one skewed blob (D, G).** 131 through
   junctions where the data's own node lines are over 1 m apart (77 over 4
   m; worst 21.6 m, NW 27th Street) are real offsets in the data, but the
   two T's are merged into one junction (`mergeClusters`) and drawn as a
   parallelogram with no curb on the street between them and slanted
   corner slabs.
8. **Markings that change along a street (M).** 139 same-name joints
   where the set of lines changes (turn lane on or off 20, parking lines
   106 counted as parking changes), yellow edge lines of a merged pair
   apart (766 samples), and the gore chevrons of item 1. Causes: per-edge
   tags reaching `roadprofile.js paintLines` through the cross section
   (items 1 and 3), `junctions.js goreOf` between arms of one street.
9. **Parking lots read as roads (P).** Around the Miami River bridge,
   21,800 m2 of lot drawn in road gray against 16,200 m2 of road. Cause:
   `render/lotmesh.js` draws the carpark ground in nearly the road's
   asphalt tone and puts a curb only inside the lot; nothing marks where a
   lot meets a street.
10. **Slanted sidewalk slabs at skewed corners (G).** 363 junctions have
    corner sidewalk triangles whose middle the ground calls road (547
    corners, 14,500 m2); `render/citymesh.js cornerTri` clips most of them
    at draw time, so what remains visible are the corners of skewed and
    merged junctions (items 2 and 7). Cause: `junctions.js cornerOf`
    builds a corner between any two neighboring arms, including two
    halves of one street.

Not the cause any more: light poles in the road (0 since 0.13.7), mesh
holes showing lawn under asphalt (under 0.3 %), lane counts outside the
class caps (0.13.7).

## Work packages

Four packages on disjoint files, so they can run in parallel. Each adds
its own test file; none edits another's files or `scripts/road-audit.mjs`
(they import `auditRoads` from it, read only). After all four merge, one
integration pass re-runs every audit, re-pins fingerprints once and runs
the full gate.

Budgets for every package: whole-box build under 3 s cpu
(test/fixtures/build-budget-run.mjs), Normal street view at most 210 draw
calls and 295k triangles (`scripts/perf.mjs map=<region>`; Downtown is at
199 to 209 calls and 292k now, so any new geometry there needs savings
first), at most 60 shader programs, no allocation in per-frame code,
randomness only through seeded `createRng` (prefer position hashes for
anything new so the existing rng streams do not shift), no test loosened.

### WP1: one street, one cross section (interpretation)

Files: `src/world/roadprofile.js`, `src/world/miami.js` (graph stage and
the curb-spot loop only), new `src/world/pairmerge.js`, new
`test/pairmerge.test.js`; re-pins in `test/regions.test.js`,
`test/gps-audit.test.js` (ids), `test/roadprofile.test.js` cases that
encode the old rules (each with a note, never a looser bound).

Algorithm:
1. Collapse pairs that are one street (`pairmerge.js collapsePairs(nodes,
   edges)`, run in `createMiamiCity` after `buildRoadGraph` and before
   `pairDivided`). Find runs as `pairDivided` does (same name, opposite
   directions, partner on the left within `PAIR_MAX`), and add the split
   legs (an unpaired one-way of the same name meeting a two-way block of
   that name, under 40 m). Collapse a run into one two-way chain when
   either its curb gap is under 3 m along most of its length (today's
   `off` pairs and sliver medians) or it is a bubble under 80 m. The new
   chain follows the mean of the two halves' lines (stations matched by
   arc length), `lanesF` from the forward half and `lanesB` from the other,
   class the higher of the two, name kept. Cross streets that met either
   half are reconnected to the nearest station of the chain (move their
   end node, never across another node). Keep a true divided road (gap 3 m
   or more and longer than 80 m) as it is.
2. Lanes across a split: in `harmonizeStreets`, a remaining divided half
   joins the group of the two-way block it meets, comparing its `lanesF`
   with the block's lanes per direction (today `e.oneway !== f.oneway`
   stops the join).
3. Street, not class: `harmonizeStreets` joins straight same-name runs
   across a class change at a junction (drop the `e.cls !== f.cls` gate
   when the names match and both are local or both collector and up), and
   `roadProfile` treats named two-way living_street and unclassified as
   residential for parking.
4. Parking lanes that are used: a two-way residential street parks on one
   curb (9.6 m) unless the data tags parking or `MIAMI_SPOTS.curbParking`
   names it; keep both curbs on tertiary. Curb spots on a parking lane
   every 6.5 m at about 60 %, decided by a position hash while the loop
   still makes its `rng.chance(0.22)` draw (so every later draw of the
   seeded stream is unchanged). The live cap (`PARKED_CAP`) still limits
   how many hold real cars; WP4 fills the rest. If the owner prefers 12 m
   streets, leave the width and rely on WP4 item 1.
   Paint that goes with the section (`paintLines`, this file): a parking
   lane on a local street gets its `park` edge line (today only collectors
   and up have it; `edgePaint` already draws the kind), so an empty one
   reads as parking, not as a lane.

Before and after (road-audit unless marked): width changes over 1 m 626 to
at most 250; divided half against two-way 483 to at most 150 and lanes per
direction differing 161 to 0; class-caused jumps 65 to at most 15; median
toggles 127 to at most 40; bubbles under 60 m 30 to 0; short split legs
347 to at most 80; street-align merged halves apart 2367 to at most 400,
yellow lines apart 766 to at most 150; curb spots within 135 m of each
start at least 3 times today's; Meridian Avenue one width from 10th to
19th Street.

Risks: node and edge ids shift (region fingerprints, gps-audit ids,
regions.js start streets, the West ramp case, service homes on curb bays:
check `CURB_BAYS` still lands on a parking lane); routing (a collapsed
pair becomes a legal two-way, as the pair was; test/roadlogic.test.js
reachability must hold); signals and stop signs snap after the graph
(`signalsAndStops`), so run the collapse before it; traffic lane offsets
read `lanesF`/`lanesB` (no change needed). Build time: one pass over pairs,
expected under 30 ms on the whole box. Draw calls fall slightly (fewer
strips). Size: large, about 600 to 900 lines with tests.

### WP2: junctions for paired and offset arms (geometry)

Files: `src/world/junctions.js`, new `test/junction-shape.test.js`.

Algorithm:
1. Composite arms: two arms of one street leaving a junction under 25
   degrees apart (today's `pairShifts` partners, and halves with a
   median) are one arm for `solveTrims` and `cornerOf`: its curbs are the
   outer curbs of the two, clipped against the other arms once; no corner
   or `goreOf` between the partners; the median nose sits on the composite
   mouth (`sup`), 2 m back as now.
2. Gores only where two different roads part (a ramp, a fork of two
   names, a link); a split of one street gets no chevrons.
3. Offset crossings: `mergeClusters` does not join two junctions across an
   edge of a through street when their other arms leave on opposite sides
   and the node lines are over 6 m apart; the edge keeps a short curbed
   strip (`A.trim + B.trim` already scales to fit the room).
4. Lanes straight through a junction: when one-way edges of one name run
   straight through a junction, both mouths target the same divide line
   (the mean of the two), tapering back to each edge's own `off` away from
   the junction, as `pairEnds` does at bends.

Before and after: junctions where halves leave side by side, area p90
950 to 1353 m2 to at most 600; junctions over 800 m2 134 to at most 60,
over 1500 m2 38 to at most 10; gores between arms of one street 73 to 0;
one-way lane divide jumps added by the code 102 to at most 20;
street-align corner triangles on asphalt 363 junctions to at most 150,
mouth misses stay 0, stub arms stay at most 8; Washington Ave at 7th St
and 5th St at Alton Rd top views compact with curb returns.

Risks: the strip-overlap invariants of test/junctions.test.js (no two
strips overlap outside the rings) with composite arms; stop bars and
`stopDistance` move with the trims (traffic stops at the new bar); props
re-settle against new rings (props-offroad must stay 0; signaled
junctions keep a mast); `buildRoadGeo` time inside the 3 s whole-box
build (trims are a small part; measure). No render file changes. Size:
medium to large, about 400 to 600 lines.

### WP3: no slivers, round median ends (ground and meshes)

Files: `src/world/ground.js`, `src/render/citymesh.js`, new
`test/slivers.test.js`.

Algorithm:
1. In `geoSurface`, a strip of non-road under 2 m between a curb and road
   beyond it (any angle, not only facing strips within 25 degrees) is
   road when both sides are carriageways of one street name (pair halves,
   split legs) and raised sidewalk fill otherwise. Worked out per edge
   station once, in the existing `gapCache`/`fillCache` arrays (no new
   per-point scan: the 0.13.9 hitch work made `geoSurface` the hot path).
2. A median band under 2 m wide is paved (no planted strip, no curb) and
   its two yellow lines stay; a median 2 m or wider ends in one rounded,
   curbed nose (the 0.13.7 quarter discs per half joined into one), never a
   square cut.
3. Meshes follow the ground as now (`netRoads`, `cornerTri`, the median
   strips in `realEdgeJob`), so the `--png` audit stays clean.

Before and after: sliver curb meters 1904 to at most 300 (lawn 754 to at
most 50); green on road ground in the `--png` audit at most 0.3 % in the
eight squares (unchanged or better); Coral Way at SW 3rd Ave street view
with no green dashes; junctionaudit "grass" stays 0; props-offroad 0.

Risks: `geoSurface` cost (tile build slices and the start tiles: measure
`scripts/perf-phonecheck.mjs` frames over 33 ms, no worse than 0.13.9);
the net (`netAt`) and fills must agree, or raised net slots reappear;
lots and lot fringes (`lots.js spreadGround`) read the ground, so lot
fingerprints may move (re-pin with a note). Triangles: a few hundred a
tile at most. Size: medium, about 300 to 450 lines.

### WP4: curbs and lots that read right (props and lot render)

Files: `src/systems/parked.js`, `src/render/parkedfield.js`,
`src/render/lotmesh.js`, new `test/curblife.test.js`.

Algorithm:
1. Static curb cars: the parked field (today lot bays only) also fills the
   parking lanes of edges near the camera, from `curbsAt` stations every
   6.5 m at about 60 % by a position hash (no rng), skipping driveways,
   hydrant gaps and junction approaches (20 m), using the far car LOD past
   40 m. Live curb cars (`PARKED_CAP`) keep their spots; a static car never
   stands where a live one or a curb spot is. Do this only if WP1 item 4
   keeps 12 m streets, or for tertiary streets that keep both curbs.
2. Parking lots: carpark ground a lighter, warmer tone than road asphalt
   with bay lines visible from the street, and a curb plus a 1 m planting
   strip on its edge where it meets a sidewalk or road with no driveway.

Before and after: share of parking lane meters within 135 m of the start
that hold a car (live or static) from at most 14 to 22 % today to at least
55 %; `--png` road-gray area off the road in the Miami River square
21,800 m2 to at most 5,000 m2; Normal street view in all five regions at
most 210 calls and 295k triangles (Downtown first: it is at 292k).

Risks: the triangle budget (Downtown has 3k triangles of room: the curb
cars must come with a cap per tier and the far LOD, or wait for WP1's
narrower streets); no per-frame allocation in the field's refresh (pooled
records, as 0.13.8); collision world bay cars must match what is drawn
(curb statics need the same static colliders or must be outside the
lanes); hitches (load a few stations a step). Size: medium, about 300 to
400 lines.

### Order and acceptance

WP1 and WP2 overlap in effect (WP1 removes most pinched junctions, WP2
fixes the true divided roads that remain): measure each against this
tree, then together. Acceptance for milestone A (docs/PLAN.md 0.15):
every number in the "Numbers" table reported before and after; width
changes over 1 m, junctions over 800 m2, gores of one street, slivers and
code-made jogs at or under the targets above; the eight top views and
the street views in `docs/preview/roads-before-*.png` shot again as
`roads-after-*`.

## Not determined

- Whether coplanar layers near y = 0 (strips at 0, junction hulls at
  -0.007, the net at -0.008, lots at -0.035) flicker on the phone's GPU at
  distance: swiftshader shows no z-fighting, and strip over strip
  overlaps total only 260 m.
- How full the owner's curbs look in play: the parked system's live
  choice depends on traffic and the hour; only the upper bound (spots
  listed) was measured.
- Which OSM splits are real medians the owner would expect to keep (Coral
  Way's banyan median is real and wide; a 2 m refuge is not). The 3 m and
  80 m thresholds of WP1 are a first guess to check in the top views.
- "Blocks feel too long": the map is to scale; whether wide empty streets
  (item 4) make blocks feel longer was not measured.

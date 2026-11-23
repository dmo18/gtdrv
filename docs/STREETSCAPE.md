# Streetscape review (version 0.12.0)

Owner's verdict on 0.10.0 and before: "wasteland", "not a single street
familiar", "fucked up looking roads", "glitchy wastelands"
(docs/owner/r3-*.jpg). Version 0.11.0 rebuilt junctions and lots and
passed its tests; this file is the record of driving it with a critical
eye and of what was changed for 0.12.0.

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

Frame names below are `<region>-<tag>-<nn>[-top].png` and
`<region>-<tag>-spot-<name>-<view>.png`; tag `r0` is 0.11.0 as published,
`r4` the tree after this work. Five rounds were shot (r0 to r4), every
frame read.

## Defects, ranked by how much a player notices

| # | Place (frame) | What is wrong | Cause in code | Fix | State |
|---|---|---|---|---|---|
| 1 | Every lawn in every region (south-r0-05-top, west-r0-06, beach-r0-00-top) | Lawns end in 5 m stair steps with a band of pale paving between the steps and the sidewalk; beside a diagonal street it reads as a saw blade | `world/miami.js` keeps lots 4 m back from every curb on the 5 m lot raster; the band between was plain land (`render/citymesh.js realLand`, PAVE) | `world/lots.js spreadGround`: `lotGrid.ground`, the lot grounds spread two cells into the land in no lot; `render/lotmesh.js lotFringe` draws it at lot height, so the lawn runs under the real sidewalk and curb and ends on their straight edge. `lotEdges` judges neighbors by drawn ground (no edging through a lawn) | Fixed (south-r4-05-top, west-r4-06) |
| 2 | Lawns and yards everywhere (south-r0-05, west-r0-06, north-r0-13) | Beds and hedges are smooth green tubes lying on the grass, at right angles to nothing | `render/lotmesh.js softStrip` drew a bed as one extruded profile; `world/lots.js` laid every row along the raster axes whatever the street grid | Beds are rows of faceted shrub mounds of two sizes (`mound`, 15 triangles each, 5-sided, dark foot, light top, flowers on some); single shrubs use the same mound. Rows (hedge, fence, wall, bed) are turned to the street grid of the block (`gridSkew`, the length-weighted mean street direction per 60 m square) | Fixed (south-r4-05, north-r4-13). Clipped hedges are still straight extrusions: correct for a hedge, long ones still read heavy |
| 3 | S Miami Ave north of SW 6th St, x -1352 z 1100 to 1250 (downtown `--at=n1:-1352:1181:90:22`) | A raised concrete strip with white curbs down the middle of the avenue, between the two halves | The halves are bridge edges 3.5 m apart: no median (under 6 m), no gap asphalt (`gapStation` skips bridges against non-bridges, and the gap rule only looked at curbs), so the net filled it in physics and nothing drew it; the sliver fill of the next edge drew raised concrete at the ends | `render/citymesh.js realRoads`: where the halves of a divided road are under 6 m apart each half draws its share of the gap as asphalt (`pairGap`); `world/ground.js`: no raised fill beside a curb with no sidewalk | Fixed |
| 4 | All regions: 2 m gaps between two roadways | Flat road in physics (the narrow-gap net) but drawn as lot ground or bare land | `world/ground.js netAt` had no mesh | `ground.netQuads(x0, z0, x1, z1, out)`: the net cells (same 0.25 m lattice, same `netAt`) found from seeds on a 1 m lattice where two roads are in reach, flood filled and merged into rectangles; `render/citymesh.js netRoads` draws those between roadways as asphalt, in 60 m boxes per tile (`realcity.js NET_BOX`). Net ground between two sidewalks is left as the block's ground (flat there too) | Fixed between roadways. Test (d) untouched and at zero |
| 5 | 5th Street at Euclid and at every T on a divided road (beach-r0-20-top, beach-r0-27) | The planted median breaks at a junction nothing crosses it at; the gap showed pale paving, then lawn | `world/junctions.js` stopped every median 2 m short of every junction | `roadGeo.mthru[q]`: an arm whose median side no other arm leaves on keeps its median; the mesh carries it to the node. Where a street does cross, each half paves its share of the gap from the node to the nose | Fixed (beach `--at=med:4512:606:180:30`) |
| 6 | Biscayne Boulevard, 5th Street (downtown-r0-25-top, beach-r0-21) | A strip of paving slabs down the middle of a wide planted median | The middle of a median over 8 m is lot land (plaza or verge) | `spreadGround` makes the middle of a wide median lawn | Fixed (downtown-r4-25-top); a thin run of paving remains where a mapped footpath lot lies in the median (beach-r4-21) |
| 7 | Fan junctions, 32 in five regions (downtown `--at=fan1:-1187:953:90:35`) | Sidewalk wedges and curbs crossing the asphalt of the junction | A ring that crosses itself is drawn as a fan; its corner triangles lie on the fan | Fan junctions draw only the corner triangles off their asphalt and no curb through them; lot features never stand on a junction's asphalt (`dressLot put`, a palm stood in the middle of Alton Road at Sunset Drive) | Improved. The 32 fans remain fans: wide irregular asphalt (list: `roadGeo.junctions.filter((j) => j.fan)`) |
| 8 | Raised corner pads between two bare arms (downtown-r0-spot-miami-6th-top) | A concrete pad standing alone in the asphalt where a gore or a facing strip keeps both sidewalks off | Corner triangles were drawn whatever the arms beside them drew | A corner whose two sides are bare is asphalt (`bareEnd`) | Fixed for bare corners. The two pads at S Miami Ave and SW 6th St are the sidewalks of a slip lane (a real island); they stay |
| 9 | Lincoln Road at Washington Avenue (beach-r0-spot-lincoln-washington-chase) | A lawn with a picket fence runs onto the mall's paving | The setback band beside a pedestrian street took the lawn behind it | Land in no lot within 7 m of a pedestrian street is paving | Fixed |
| 10 | Parking lots (north-r0-00-top) | Bay lines barely show from the car | 0.16 m lines | 0.24 m, a little brighter | Fixed |
| 11 | Yards on the Beach and Downtown (beach-r0-spot-ocean-10th-top, downtown-r0-spot-sw1st-miami-chase) | Black shrubs and black dumpsters | `SHRUB_GREENS[(v + Math.round(x)) % n]` with a negative x gave no color | The index uses the magnitude | Fixed |
| 12 | Lot to lot boundaries (downtown `--at=x5`, west-r4-07) | A paved forecourt meets a lawn in 5 m steps | The lot raster itself | None yet: needs lot outlines as polygons | Open |
| 13 | Wide empty sidewalks and plazas downtown (downtown-r4-07, north-r4-26) | Large plain paving round towers and at wide junctions | Forecourt lots plus the 4 m setback, now drawn as the lot's own ground | The setback now takes the neighbor's ground, so it is no longer a second tone; no more dressing was added (plain reads better than clutter) | Open, lower |
| 14 | Lincoln Road junction ring (beach `--at=linc`) | The junction's asphalt has a diagonal wedge toward the mall | The pedestrian arm's mouth in the ring | None | Open, low |
| 15 | Far level | Lot fringe is near tiles only; the far land keeps the lot color of each coarse cell | `realLand` far pass reads `lotGrid.ground`, so the far color matches | Done with the fringe | Fixed |

Checked and found right, no change: double yellow on two-way streets,
yellow left edge and white right edge on one-ways, white dashed lane
lines, two-line crosswalks with a stop bar on signal and stop approaches
(downtown `--at=b1`), curb height read from the chase camera, asphalt
texture scale (8 m repeat, no visible tiling in a drive), sidewalk slab
size (1.2 m).

## Rules kept

Real street geometry and names; 11 and 12 ft lanes; no real business
names; original art. Every prop kind already has its solid in
`world/propsolid.js` (no new kind was added: the mounds draw the existing
`bed` and `shrub`).

## Data added

- `lotGrid.ground` (Uint8Array, one per land cell): the drawn ground type
  (lot type + 1) of the cell: its lot's, a neighbor's in the setback
  band, lawn in a wide median, paving beside a pedestrian street.
  `lotGrid.type` and `lotGrid.id` are unchanged.
- `roadGeo.mthru[q]` (Uint8Array per edge end): 1 where the median runs
  on through the junction at that end.
- `roadGeo.junctions[j].corners[k]`: `qa, sideA, qb, sideB`, the edge end
  and side on each side of the corner.
- `groundOf(city).baseAt(x, z)` (the surface without the net) and
  `netQuads(x0, z0, x1, z1, out)`. `groundAt`, `surfaceAt`, `gapAt`,
  `fillOf`, `gapOf` are unchanged in meaning; the one change in their
  answers: no raised fill beside a curb that has no sidewalk.

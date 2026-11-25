// One shader program for the city's lit surfaces (docs/PLAN_V4.md task 13).
// The far blocks' windows, the grass patches, the facade wear, the baked
// street lamp light and the wet asphalt used to be separate shader patches,
// each with its own program key, so every combination compiled its own
// program. Here they are one patch with every feature in it, each behind a
// per-material switch uniform: materials that differ only in which features
// are on (and that have the same maps) share one program. A feature that is
// off skips its code, so the picture is the same as with its own program.
//
// Every patched material carries the full uniform set (switches, lamp and
// wet values, the lamp map sampler): a program's uniform state is shared by
// the materials drawn with it, so each one must set all of them.
import * as THREE from 'three';

// Cars whose lamps light the ground (the player's and the nearest).
export const CARS = 6;

// Shared by every patched material (nightlights.js fills the lamp values,
// the weather sets uWet).
export const CITY_U = {
  uWet: { value: 0 },
  uLampMap: { value: null },
  uLampBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  uLampK: { value: 0 },
  uCarN: { value: 0 },
  uCarA: { value: Array.from({ length: CARS }, () => new THREE.Vector4()) },
  uCarB: { value: Array.from({ length: CARS }, () => new THREE.Vector4()) },
  uSpotA: { value: new THREE.Vector4() },
  uSpotB: { value: new THREE.Vector4(0, -1, 0, 0.06) },
};

// Switches: x far blocks' windows, y grass patches, z facade wear, w lamp
// light; uRwWetOn: puddles from the roughness map (asphalt).
const FX = { far: 'x', grass: 'y', facade: 'z', lamp: 'w' };
const patched = new WeakSet();

const VERT_HEAD = `
attribute float aWin;
varying vec3 vRwWp;
varying vec3 vRwN;
varying float vRwWin;
uniform vec4 uRwFx;`;

const VERT_BODY = `
	vRwWp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vRwN = normal;
	// Only the far blocks have the attribute; elsewhere it is not read.
	vRwWin = uRwFx.x > 0.5 ? aWin : 0.0;`;

const FRAG_HEAD = `
#define RW_CARS ${CARS}
varying vec3 vRwWp;
varying vec3 vRwN;
varying float vRwWin;
uniform vec4 uRwFx;
uniform float uRwWetOn;
uniform float uWet;
uniform sampler2D uLampMap;
uniform vec4 uLampBox;
uniform float uLampK;
uniform float uCarN;
uniform vec4 uCarA[ RW_CARS ];
uniform vec4 uCarB[ RW_CARS ];
uniform vec4 uSpotA;
uniform vec4 uSpotB;`;

// Far blocks: vertex colors, windows (darker glass by day, some lit at
// night) from the world position. aWin: 0 no windows, 1 a tower or block
// grid (3.1 by 3.4 m), 2 small house and shop windows (4 by 3 m).
const FAR_COLOR = `
	float rwFarLit = 0.0;
	if ( uRwFx.x > 0.5 ) {
		float rwWin = 0.0, rwLit = 0.0;
		if ( vRwWin > 0.5 && abs( vRwN.y ) < 0.5 ) {
			float rwAlong = abs( vRwN.x ) > 0.5 ? vRwWp.z : vRwWp.x;
			bool rwSmall = vRwWin > 1.5;
			vec2 rwC = rwSmall ? vec2( rwAlong / 4.0, ( vRwWp.y - 0.2 ) / 3.0 ) : vec2( rwAlong / 3.1, ( vRwWp.y - 0.8 ) / 3.4 );
			vec2 rwF = fract( rwC );
			rwWin = rwSmall
				? step( 0.3, rwF.x ) * step( rwF.x, 0.7 ) * step( 0.32, rwF.y ) * step( rwF.y, 0.78 )
				: step( 0.18, rwF.x ) * step( rwF.x, 0.82 ) * step( 0.28, rwF.y ) * step( rwF.y, 0.86 ) * step( 1.0, rwC.y );
			float rwH = fract( sin( dot( floor( rwC ) + floor( vRwWp.xz * 0.05 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
			// Far off the pattern turns into its average (no shimmer).
			float rwFade = smoothstep( 450.0, 1100.0, length( vRwWp - cameraPosition ) );
			rwLit = mix( rwWin * step( rwSmall ? 0.7 : 0.6, rwH ), 0.16, rwFade );
			rwWin = mix( rwWin, rwSmall ? 0.2 : 0.45, rwFade );
			// A darker shop or lobby band at street level.
			if ( !rwSmall ) diffuseColor.rgb *= mix( 0.78, 1.0, step( 4.0, vRwWp.y ) );
		}
		diffuseColor.rgb *= 1.0 - 0.3 * rwWin;
		rwFarLit = rwLit;
	}`;

// Grass and open land: slow patches of lusher and drier, yellower grass
// over tens of meters (the texture only varies within its 10 m repeat).
const GRASS_COLOR = `
	if ( uRwFx.y > 0.5 ) {
		vec2 rwG = vRwWp.xz;
		float rwA = sin( rwG.x * 0.043 + sin( rwG.y * 0.031 ) * 2.0 ) * sin( rwG.y * 0.037 - rwG.x * 0.011 );
		float rwB = sin( rwG.x * 0.13 + rwG.y * 0.09 ) * sin( rwG.y * 0.15 - 1.3 );
		float rwC = sin( rwG.x * 0.71 + sin( rwG.y * 0.53 ) * 1.6 ) * sin( rwG.y * 0.67 + sin( rwG.x * 0.47 ) * 1.3 );
		float rwDry = smoothstep( 0.15, 0.85, rwA * 0.7 + rwB * 0.3 );
		float rwLush = smoothstep( 0.25, 0.85, - rwA * 0.75 + rwC * 0.25 );
		diffuseColor.rgb *= ( 0.86 + 0.18 * rwB ) * ( 1.0 + 0.08 * rwC );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.14, 1.02, 0.66 ), rwDry * 0.65 );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.74, 0.87, 0.8 ), rwLush * 0.7 );
	}`;

// Facade wear: darker where walls meet the ground, a faint lift toward the
// top of tall buildings, a dirtier band near the sidewalk, rain streaks
// from each floor line in a few columns (fading out with distance) and a
// slow patchy tone change over the wall.
const FACADE_COLOR = `
	if ( uRwFx.z > 0.5 ) {
		float rwY = vRwWp.y;
		diffuseColor.rgb *= mix( 0.58, 1.0, smoothstep( 0.0, 1.8, rwY ) ) * mix( 0.93, 1.05, smoothstep( 3.0, 60.0, rwY ) );
		float rwAlong = vRwWp.x + vRwWp.z;
		float rwCol = fract( sin( floor( rwAlong * 1.35 ) * 91.17 ) * 4375.85 );
		float rwRun = 1.0 - fract( rwY / 3.4 + rwCol * 0.5 );
		float rwFar = 1.0 - smoothstep( 60.0, 150.0, length( vRwWp - cameraPosition ) );
		float rwStreak = step( 0.62, rwCol ) * rwRun * rwRun * 0.16 * rwFar;
		float rwPatch = sin( rwAlong * 0.21 + rwY * 0.13 ) * sin( rwAlong * 0.067 - rwY * 0.05 + 1.7 );
		diffuseColor.rgb *= ( 1.0 - rwStreak ) * ( 1.0 + 0.045 * rwPatch ) * mix( 0.86, 1.0, smoothstep( 0.4, 3.2, rwY ) );
	}`;

// Wet roads: in the rain the asphalt goes dark and glossy, with standing
// water where the puddle mask (the roughness map's green) says so. Other
// materials read their roughness map as three.js does.
const WET_ROUGHNESS = `
	float roughnessFactor = roughness;
	float rwPuddle = 0.0;
	#ifdef USE_ROUGHNESSMAP
	if ( uRwWetOn > 0.5 ) {
		rwPuddle = texture2D( roughnessMap, vRoughnessMapUv ).g;
		roughnessFactor *= mix( 1.0, mix( 0.62, 0.1, 1.0 - rwPuddle ), uWet );
		diffuseColor.rgb *= mix( 1.0, mix( 0.62, 0.4, 1.0 - rwPuddle ), uWet );
	} else {
		vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
		roughnessFactor *= texelRoughness.g;
	}
	#endif`;

const WET_NORMAL = `
	#include <normal_fragment_maps>
	#ifdef USE_ROUGHNESSMAP
	if ( uRwWetOn > 0.5 ) normal = normalize( mix( normal, nonPerturbedNormal, uWet * ( 1.0 - rwPuddle ) * 0.9 ) );
	#endif`;

// Street lamp light, baked into one map over the city (nightlights.js),
// car lamps and the police searchlight.
const LAMP_LIGHT = `
#include <lights_fragment_end>
if ( uRwFx.w > 0.5 ) {
	vec2 rwLu = ( vRwWp.xz - uLampBox.xy ) * uLampBox.zw;
	vec3 rwLl = texture2D( uLampMap, rwLu ).rgb;
	rwLl *= rwLl;
	// Strongest on the ground, fading up a wall.
	float rwHk = exp( - max( vRwWp.y, 0.0 ) * 0.3 );
	vec3 rwL = rwLl * ( uLampK * rwHk );
	// Car lamps: a widening cone ahead of each car, red glow behind.
	for ( int i = 0; i < RW_CARS; i ++ ) {
		if ( float( i ) >= uCarN ) break;
		vec4 a = uCarA[ i ], b = uCarB[ i ];
		vec2 d = vRwWp.xz - a.xy;
		float along = dot( d, a.zw ) - b.z;
		float across = abs( a.z * d.y - a.w * d.x );
		float up = max( vRwWp.y - 0.6, 0.0 );
		if ( along > 0.0 ) {
			float w = 0.7 + along * 0.36;
			float c = 1.0 - smoothstep( w * 0.55, w, across );
			float t = clamp( along / 42.0, 0.0, 1.0 );
			c *= smoothstep( 0.0, 1.5, along ) * ( 1.0 - t ) * ( 1.0 - t ) * 6.5 / ( 1.0 + along * 0.1 );
			rwL += vec3( 1.0, 0.94, 0.82 ) * ( c * b.x * exp( - up * 0.35 ) );
		} else {
			float r = length( vec2( along + 2.0 * b.z + 0.9, across * 0.8 ) );
			rwL += vec3( 1.0, 0.06, 0.03 ) * ( b.y * exp( - r * r * 0.4 ) * exp( - up * 1.5 ) );
		}
	}
	// Police searchlight: a narrow cone from the heli's lamp (apex
	// uSpotA.xyz, strength uSpotA.w; unit direction uSpotB.xyz, half-angle
	// tangent uSpotB.w). A bright core with a soft rim.
	if ( uSpotA.w > 0.0 ) {
		vec3 sd = vRwWp - uSpotA.xyz;
		float s = dot( sd, uSpotB.xyz );
		if ( s > 1.0 ) {
			float rr = length( sd - uSpotB.xyz * s );
			float R = 0.25 + s * uSpotB.w;
			float q = rr / R;
			// The cone widens with distance: the same light over more ground.
			float c = exp( - q * q * 3.0 ) * ( 1.0 - smoothstep( 0.8, 1.2, q ) ) / ( 1.0 + s * s / 4000.0 );
			rwL += vec3( 1.0, 0.95, 0.86 ) * ( c * uSpotA.w );
		}
	}
	// Dark asphalt still shows a pool (its sheen scatters some light back).
	reflectedLight.indirectDiffuse += max( material.diffuseColor, vec3( 0.07, 0.065, 0.06 ) ) * rwL;
}`;

// The patch itself; `extra(shader)` (optional) runs after it.
function compileCity(mat, shader) {
  const ud = mat.userData;
  Object.assign(shader.uniforms, CITY_U);
  shader.uniforms.uRwFx = ud.rwFx;
  shader.uniforms.uRwWetOn = ud.rwWetOn;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + VERT_HEAD)
    .replace('#include <project_vertex>', '#include <project_vertex>' + VERT_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + FRAG_HEAD)
    .replace('#include <color_fragment>', '#include <color_fragment>' + FAR_COLOR + GRASS_COLOR + FACADE_COLOR)
    .replace('#include <roughnessmap_fragment>', WET_ROUGHNESS)
    .replace('#include <normal_fragment_maps>', WET_NORMAL)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tif ( uRwFx.x > 0.5 ) totalEmissiveRadiance *= rwFarLit;')
    .replace('#include <lights_fragment_end>', LAMP_LIGHT);
  if (ud.rwCityExtra) ud.rwCityExtra(shader);
}

// Gives a MeshStandardMaterial the city patch (idempotent) and turns on the
// named features: { far, grass, facade, lamp, wet }. `key` adds to the
// program key for a material whose extra patch (cityExtra) changes the code.
export function cityPatch(mat, features = {}) {
  const ud = mat.userData;
  if (!patched.has(mat)) {
    // A clone copies userData as JSON (plain objects) but not the patch:
    // keep its switches, patch it again.
    patched.add(mat);
    const fx = ud.rwFx && ud.rwFx.value;
    ud.rwFx = { value: new THREE.Vector4(fx ? fx.x : 0, fx ? fx.y : 0, fx ? fx.z : 0, fx ? fx.w : 0) };
    ud.rwWetOn = { value: ud.rwWetOn ? ud.rwWetOn.value : 0 };
    ud.rwCityKey = ud.rwCityKey || 'rw-city';
    mat.onBeforeCompile = (shader) => compileCity(mat, shader);
    mat.customProgramCacheKey = () => ud.rwCityKey;
  }
  for (const k in features) cityFeature(mat, k, features[k]);
  return mat;
}

// Turns one feature on or off: a uniform, no recompile.
export function cityFeature(mat, name, on = true) {
  const ud = mat.userData;
  if (!patched.has(mat)) cityPatch(mat);
  if (name === 'wet') ud.rwWetOn.value = on ? 1 : 0;
  else if (FX[name]) ud.rwFx.value[FX[name]] = on ? 1 : 0;
}

export function cityPatched(mat) {
  return patched.has(mat);
}

export function cityHas(mat, name) {
  const ud = mat.userData;
  if (!patched.has(mat)) return false;
  return name === 'wet' ? ud.rwWetOn.value > 0.5 : ud.rwFx.value[FX[name]] > 0.5;
}

// An extra patch run after the city patch (lit windows): its own program
// key, `key` appended to the city's.
export function cityExtra(mat, key, fn) {
  cityPatch(mat);
  const ud = mat.userData;
  // A function in userData: kept out of JSON copies.
  Object.defineProperty(ud, 'rwCityExtra', { value: fn, configurable: true, writable: true, enumerable: false });
  ud.rwCityKey = 'rw-city|' + key;
  mat.needsUpdate = true;
}

// A white 1x1 roughness map: a material with it reads roughness * 1, as
// without one, but has the same maps as the asphalt (one program).
let white = null;
function whiteMap() {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.wrapS = white.wrapT = THREE.RepeatWrapping;
    white.needsUpdate = true;
  }
  return white;
}

// The street tiles' materials (citymesh.js makeMaterials, after the lot
// sand clone): the city patch on every lit one, with its features.
export function patchCityMaterials(M) {
  if (M.wet) CITY_U.uWet = M.wet;
  for (const k in M) {
    const m = M[k];
    if (m && m.isMeshStandardMaterial && m !== M.detailMat) cityPatch(m);
  }
  if (M.asphaltMat) cityFeature(M.asphaltMat, 'wet');
  for (const k of ['grassMat', 'landMat', 'landRimMat']) if (M[k]) cityFeature(M[k], 'grass');
  for (const k of ['glass', 'brick', 'office', 'stucco', 'havana', 'siding', 'corrugated', 'roofing', 'shopfront']) if (M[k]) cityFeature(M[k], 'facade');
  // Normal-mapped ground: the asphalt's maps.
  for (const k of ['sidewalkMat', 'woodMat', 'groundMat', 'sandMat', 'lotSandMat']) {
    const m = M[k];
    if (m && m.normalMap && !m.roughnessMap && M.asphaltMat && M.asphaltMat.roughnessMap) m.roughnessMap = whiteMap();
  }
  return M;
}

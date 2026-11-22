// Night lighting for the city, all of it faked cheaply (no extra lights):
// - lit windows: the facade shaders pick, per window, whether the room
//   behind is lit and what it looks like (warm room, blinds, cool office,
//   television blue, curtains...) from a seeded hash of the building,
//   the floor and the window, drawing the room from one small shared
//   atlas (makeWindowAtlas). Unlit glass goes dark at night.
// Call patchWindows(materials, atlas) once, before the first draw; then
// set the returned uniforms each frame (night level and game time).
import * as THREE from 'three';

// Per style: x = how many windows are lit (scale), y = 1 for offices
// (whole floors lit together, mostly cool light), 0 for homes and
// hotels (window by window, mostly warm), z = how often a television.
const STYLE = {
  glass: [1.05, 1, 0.02],
  office: [1.0, 1, 0.03],
  brick: [0.95, 0, 0.16],
  stucco: [1.0, 0, 0.14],
  havana: [0.95, 0, 0.16],
};

const HASH = `
float rwHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}`;

// Replaces the emissive map step of a facade shader. The facade UVs
// count 4 bays and 4 floors per unit; whole-number offsets carry the
// building (v / 64) and the wall (u / 16), see buildings.js.
const WINDOW_FRAG = `
#ifdef USE_EMISSIVEMAP
{
	float rwMask = texture2D( emissiveMap, vEmissiveMapUv ).r;
	vec2 rwG = vEmissiveMapUv * 4.0;
	vec2 rwCell = floor( rwG );
	vec2 rwLoc = rwG - rwCell;
	float rwBld = floor( vEmissiveMapUv.y / 64.0 );
	float rwB = rwHash( vec2( rwBld, 7.7 ) );
	float rwB2 = rwHash( vec2( rwBld, 19.3 ) );
	float rwF = rwHash( vec2( rwCell.y, 3.1 ) );
	float rwW = rwHash( rwCell );
	float rwW2 = rwHash( rwCell + vec2( 0.5, 91.0 ) );
	// Offices light most of a floor or almost none of it; homes window by window.
	float rwOcc = mix( 0.18, 0.62, rwB ) * uWinStyle.x;
	float rwOn = uWinStyle.y > 0.5
		? ( rwF < rwOcc * 1.25 ? step( rwW, 0.86 ) : step( rwW, 0.05 ) )
		: step( rwW, rwOcc * ( 0.55 + 0.9 * rwF ) );
	// Which room: offices mostly cool (a few warm-lit companies), homes warm.
	float rwV;
	if ( uWinStyle.y > 0.5 ) {
		float warmCo = step( rwB2, 0.3 );
		rwV = rwW2 < 0.55 ? mix( 2.0, 6.0, warmCo ) : rwW2 < 0.8 ? mix( 5.0, 1.0, warmCo ) : rwW2 < 0.92 ? 6.0 : 7.0;
	} else {
		rwV = rwW2 < uWinStyle.z ? 3.0 : rwW2 < 0.36 ? 0.0 : rwW2 < 0.54 ? 1.0 : rwW2 < 0.7 ? 4.0 : rwW2 < 0.8 ? 6.0 : rwW2 < 0.9 ? 7.0 : 5.0;
	}
	vec2 rwTile = vec2( mod( rwV, 4.0 ), floor( rwV / 4.0 ) );
	vec2 rwA = ( rwTile + 0.04 + rwLoc * 0.92 ) / vec2( 4.0, 2.0 );
	vec2 rwDx = dFdx( rwG ) * 0.23, rwDy = dFdy( rwG ) * 0.46;
	vec3 rwRoom = textureGrad( uWinAtlas, rwA, rwDx * vec2( 1.0, 0.5 ), rwDy * vec2( 1.0, 0.5 ) ).rgb;
	float rwK = 0.6 + 0.7 * rwHash( rwCell + vec2( 37.0, 5.0 ) );
	// A television flickers.
	if ( rwV == 3.0 ) rwK *= 0.75 + 0.35 * sin( uWinTime * 6.3 + rwW * 40.0 ) * sin( uWinTime * 2.9 + rwW2 * 23.0 );
	float rwLit = rwMask * rwOn;
	totalEmissiveRadiance *= rwRoom * rwK * rwLit * 1.1;
	// Unlit glass at night: dark, showing only the sky in it.
	diffuseColor.rgb *= 1.0 - uWinNight * rwMask * mix( 0.72, 0.9, rwOn );
}
#endif`;

export function patchWindows(mats, atlas) {
  const shared = {
    uWinAtlas: { value: atlas },
    uWinNight: { value: 0 },
    uWinTime: { value: 0 },
  };
  const done = [];
  for (const name of Object.keys(STYLE)) {
    const m = mats[name];
    if (!m || !m.emissiveMap || m.userData.rwWindows) continue;
    m.userData.rwWindows = true;
    const style = { value: new THREE.Vector3().fromArray(STYLE[name]) };
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev.call(m, shader, renderer);
      shader.uniforms.uWinAtlas = shared.uWinAtlas;
      shader.uniforms.uWinNight = shared.uWinNight;
      shader.uniforms.uWinTime = shared.uWinTime;
      shader.uniforms.uWinStyle = style;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uWinAtlas;\nuniform float uWinNight;\nuniform float uWinTime;\nuniform vec3 uWinStyle;' + HASH)
        .replace('#include <emissivemap_fragment>', WINDOW_FRAG);
    };
    // Its own program (the plain facades share 'rw-facade').
    m.customProgramCacheKey = () => 'rw-facade-win';
    m.needsUpdate = true;
    done.push(m);
  }
  return { uniforms: shared, materials: done };
}

// ---- street lamp light, baked ---------------------------------------------
// Every street lamp (and the big floodlights) painted once, seen from
// above, into one light map over the whole city. The ground, kerb,
// pavement and shopfront shaders read it by world position and add it
// as light on their own colour, so each lamp leaves a warm pool that
// takes the colour of the asphalt or paving under it, and walls next to
// a lamp catch it near the ground. One texture read per pixel; no
// lights, no extra draws.
export function bakeLampLight(lamps, glows = []) {
  if (typeof document === 'undefined' || !lamps.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const spots = [];
  for (const l of lamps) {
    const rot = l.rot || 0, h = l.h || 7;
    spots.push(l.x + Math.cos(rot) * 1.75, l.z + Math.sin(rot) * 1.75, 6 + h * 0.85, 1);
  }
  for (const e of glows) if (e.size >= 5 && e.y > 3) spots.push(e.x, e.z, 10 + e.size, 0.8);
  for (let i = 0; i < spots.length; i += 4) {
    x0 = Math.min(x0, spots[i]); x1 = Math.max(x1, spots[i]);
    z0 = Math.min(z0, spots[i + 1]); z1 = Math.max(z1, spots[i + 1]);
  }
  x0 -= 40; z0 -= 40; x1 += 40; z1 += 40;
  // A real map spans km: a finer map keeps the pools round there.
  const S = Math.max(x1 - x0, z1 - z0) > 4000 ? 2048 : 1024, sx = S / (x1 - x0), sz = S / (z1 - z0);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < spots.length; i += 4) {
    const px = (spots[i] - x0) * sx, pz = (spots[i + 1] - z0) * sz, r = spots[i + 2] * sx, k = spots[i + 3];
    const gr = g.createRadialGradient(px, pz, 0, px, pz, r);
    gr.addColorStop(0, `rgba(255,214,160,${k})`);
    gr.addColorStop(0.18, `rgba(255,196,130,${0.8 * k})`);
    gr.addColorStop(0.5, `rgba(240,160,96,${0.38 * k})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(px - r, pz - r, 2 * r, 2 * r);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false; // canvas row = +z
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return { texture: tex, box: new THREE.Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)) };
}

const LAMP_FRAG = `
#include <lights_fragment_end>
{
	vec2 rwLu = ( vRwLampW.xz - uLampBox.xy ) * uLampBox.zw;
	vec3 rwLl = texture2D( uLampMap, rwLu ).rgb;
	rwLl *= rwLl;
	// Strongest on the ground, fading up a wall.
	float rwHk = exp( - max( vRwLampW.y, 0.0 ) * 0.3 );
	vec3 rwL = rwLl * ( uLampK * rwHk );
	// Car lamps: a widening cone ahead of each car, red glow behind.
	for ( int i = 0; i < RW_CARS; i ++ ) {
		if ( float( i ) >= uCarN ) break;
		vec4 a = uCarA[ i ], b = uCarB[ i ];
		vec2 d = vRwLampW.xz - a.xy;
		float along = dot( d, a.zw ) - b.z;
		float across = abs( a.z * d.y - a.w * d.x );
		float up = max( vRwLampW.y - 0.6, 0.0 );
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
	// tangent uSpotB.w). A bright core with a soft rim, on the ground and
	// on any wall or roof inside the cone.
	if ( uSpotA.w > 0.0 ) {
		vec3 sd = vRwLampW - uSpotA.xyz;
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

// Cars whose lamps light the ground (the player's and the nearest).
export const CARS = 6;

// Police searchlight pool: the first lit beam among the craft (aircraft
// meshes keep their world cone in userData.spotW). `day` 0..1 dims it in
// sunlight. No allocation.
export function setSpotLight(U, crafts, day, tan) {
  const A = U.uSpotA.value, B = U.uSpotB.value;
  A.w = 0;
  for (let i = 0; i < crafts.length; i++) {
    const v = crafts[i];
    const sw = v.mesh && v.mesh.userData && v.mesh.userData.spotW;
    if (!sw || !sw.on || !v.mesh.visible) continue;
    A.set(sw.x, sw.y, sw.z, sw.k * (6.5 - 5.2 * day));
    B.set(sw.dx, sw.dy, sw.dz, tan);
    return true;
  }
  return false;
}

// Adds the baked lamp light and the car lamps to the given materials.
// Returns the shared uniforms: set uLampK (0 by day) every frame, the
// searchlight uSpotA / uSpotB (setSpotLight), and per car uCarA = (x, z,
// cos heading, sin heading), uCarB = (headlight, tail glow, half length,
// 0) for the first uCarN entries.
export function patchLampLight(mats, baked) {
  const U = {
    uLampMap: { value: baked.texture },
    uLampBox: { value: baked.box },
    uLampK: { value: 0 },
    uCarN: { value: 0 },
    uCarA: { value: Array.from({ length: CARS }, () => new THREE.Vector4()) },
    uCarB: { value: Array.from({ length: CARS }, () => new THREE.Vector4()) },
    uSpotA: { value: new THREE.Vector4() },
    uSpotB: { value: new THREE.Vector4(0, -1, 0, 0.06) },
  };
  for (const m of mats) {
    if (!m || m.userData.rwLamp) continue;
    m.userData.rwLamp = true;
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.call(m);
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev.call(m, shader, renderer);
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRwLampW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvRwLampW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n#define RW_CARS ${CARS}\nvarying vec3 vRwLampW;\nuniform sampler2D uLampMap;\nuniform vec4 uLampBox;\nuniform float uLampK;\nuniform float uCarN;\nuniform vec4 uCarA[ RW_CARS ];\nuniform vec4 uCarB[ RW_CARS ];\nuniform vec4 uSpotA;\nuniform vec4 uSpotB;`)
        .replace('#include <lights_fragment_end>', LAMP_FRAG);
    };
    m.customProgramCacheKey = () => prevKey + '|rw-lamp';
    m.needsUpdate = true;
  }
  return U;
}

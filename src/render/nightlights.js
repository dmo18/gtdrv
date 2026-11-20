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
	totalEmissiveRadiance *= rwRoom * rwK * rwLit * 1.6;
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

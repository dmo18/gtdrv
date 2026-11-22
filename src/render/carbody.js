// Procedural car bodies lofted from a few control curves per style.
// A body is a lower shell (plan-view superellipse, side profile curves,
// wheel arches cut into the sill line, a section with a tucked sill, a
// character line and a crisp shoulder, a flat crowned deck) and a
// greenhouse lofted on top of it (windscreen, roof, rear glass, side
// glass between pillars, with tumblehome). Panel details (lamps, grille,
// shut lines with depth, livery) are picked per face from the same grid,
// so nothing floats or cracks.
//
// Near model: body (paint, trim, cabin), glass (tinted, see-through, plus
// the contact shadow), lamps (head and tail in one mesh). Mid model: a
// light body with opaque glass, light lamps, the contact shadow. Far
// model: one light body with baked lamp blocks and tyres.
// All styles are invented; none copies a real vehicle.
import * as THREE from 'three';
import { Acc, emitGrid, curve, uniqSorted, lin, spow, lathe } from './loft.js';
import { CLS } from './vehiclemats.js';

const WHITE = 0xffffff;
const SEAM = 0x060607;
const TRIM = 0x141517;
const GRILLE = 0x0b0c0d;
const GLASS = 0x0b1116;
const TINT = 0x141c24;
const LINER = 0x262626;
const CHROME = 0xd8dade;
const ARCH = 0x0b0b0b;
// Cabin colours (dark but not black: they show through the tint).
const SEAT = 0x3c3935;
const DASH = 0x1e1f21;
const HEADLINER = 0x55514c;
const FLOOR = 0x242321;

// ---- styles -------------------------------------------------------------------
// Curves are over t = x / L (rear -0.5 .. front 0.5); heights are
// fractions of H. top: deck centre line; belt (optional): the shoulder
// line (else top minus drop). gh: greenhouse stations (t) xC rear base,
// xR0 roof rear, xR1 roof front, xA windscreen base; side: side-glass
// span; b: B-pillar span; base: glass base width share; tumble: inward
// lean of the glass (m per m of height). seams: door shut lines (t).
// q: deck superellipse exponent (higher is flatter with a tighter edge).
const SEDAN = {
  pF: 6, pR: 7, flare: 0.032, q: 3.4, lean: [0.13, 0.07, 0.07, 0.1], hoodCrease: [0.22, 0.44, 0.012],
  top: [[-0.5, 0.56], [-0.492, 0.64], [-0.475, 0.675], [-0.44, 0.682], [-0.36, 0.672], [-0.3, 0.665], [0.2, 0.615], [0.3, 0.59], [0.4, 0.56], [0.46, 0.535], [0.49, 0.5], [0.5, 0.44]],
  belt: [[-0.5, 0.52], [-0.49, 0.6], [-0.465, 0.635], [-0.4, 0.645], [-0.3, 0.64], [0, 0.605], [0.2, 0.575], [0.38, 0.535], [0.46, 0.505], [0.49, 0.47], [0.5, 0.42]],
  bottom: [[-0.5, 0.24], [-0.465, 0.135], [0.44, 0.125], [0.5, 0.2]],
  gh: { xC: -0.35, xR0: -0.205, xR1: -0.015, xA: 0.205, roof: 1, base: 0.885, tumble: 0.42, crown: 0.035, side: [-0.29, 0.168], b: [-0.088, -0.062], rear: true },
  seams: [0.205, -0.07, -0.215], hood: 0.235, boot: -0.37, lip: true, exhaust: { n: 2, z: 0.3 },
};
const STYLES = {
  sedan: SEDAN,
  // Four-door fastback: the roof runs long and low into a short tail.
  nightheron: {
    ...SEDAN, lean: [0.12, 0.07, 0.05, 0.1], flare: 0.04, face: 'sedan',
    top: [[-0.5, 0.55], [-0.49, 0.62], [-0.47, 0.645], [-0.44, 0.65], [-0.38, 0.648], [0.2, 0.6], [0.3, 0.575], [0.4, 0.545], [0.46, 0.52], [0.49, 0.49], [0.5, 0.43]],
    belt: [[-0.5, 0.51], [-0.49, 0.585], [-0.465, 0.615], [-0.4, 0.625], [-0.3, 0.62], [0, 0.6], [0.2, 0.565], [0.38, 0.525], [0.46, 0.495], [0.49, 0.46], [0.5, 0.41]],
    gh: { xC: -0.425, xR0: -0.13, xR1: -0.01, xA: 0.2, roof: 0.96, base: 0.86, tumble: 0.5, crown: 0.035, side: [-0.33, 0.165], b: [-0.088, -0.062], rear: true },
    boot: -0.45, wingLip: true,
  },
  // Classic cab: a squarer three-box body, upright glass, flat bonnet.
  taxi: {
    pF: 10, pR: 11, flare: 0.012, q: 4.6, lean: [0.05, 0.05, 0.03, 0.05],
    top: [[-0.5, 0.6], [-0.495, 0.645], [-0.48, 0.66], [-0.35, 0.665], [-0.3, 0.665], [0.2, 0.63], [0.42, 0.61], [0.48, 0.598], [0.5, 0.56]],
    belt: [[-0.5, 0.58], [-0.49, 0.625], [-0.47, 0.64], [-0.3, 0.64], [0.2, 0.61], [0.42, 0.592], [0.48, 0.58], [0.5, 0.54]],
    bottom: [[-0.5, 0.23], [-0.47, 0.15], [0.45, 0.14], [0.5, 0.21]],
    gh: { xC: -0.315, xR0: -0.215, xR1: 0.065, xA: 0.2, roof: 1, base: 0.9, tumble: 0.26, crown: 0.022, side: [-0.29, 0.168], b: [-0.075, -0.05], rear: true },
    seams: [0.195, -0.06, -0.21], hood: 0.22, boot: -0.335, exhaust: { n: 1, z: 0.3 },
  },
  // Patrol interceptor: the sedan stretched, flatter roof, push bar.
  police: {
    ...SEDAN, lean: [0.09, 0.06, 0.06, 0.08], flare: 0.028, pushBar: true, lip: false, face: 'police',
    top: [[-0.5, 0.58], [-0.492, 0.65], [-0.475, 0.672], [-0.44, 0.676], [-0.36, 0.668], [-0.3, 0.662], [0.2, 0.62], [0.3, 0.6], [0.4, 0.575], [0.46, 0.55], [0.49, 0.52], [0.5, 0.47]],
    belt: [[-0.5, 0.55], [-0.49, 0.61], [-0.465, 0.635], [-0.4, 0.64], [-0.3, 0.635], [0, 0.61], [0.2, 0.585], [0.38, 0.55], [0.46, 0.525], [0.49, 0.495], [0.5, 0.45]],
    gh: { xC: -0.34, xR0: -0.215, xR1: 0.0, xA: 0.205, roof: 0.985, base: 0.89, tumble: 0.36, crown: 0.025, side: [-0.29, 0.168], b: [-0.088, -0.062], rear: true },
  },
  compact: {
    pF: 5, pR: 9, flare: 0.03, q: 3.2, lean: [0.12, 0.06, 0.03, 0.08], hoodCrease: [0.26, 0.42, 0.01],
    top: [[-0.5, 0.62], [-0.49, 0.665], [-0.47, 0.68], [-0.42, 0.685], [0.2, 0.635], [0.3, 0.6], [0.4, 0.56], [0.46, 0.52], [0.49, 0.48], [0.5, 0.43]],
    belt: [[-0.5, 0.6], [-0.48, 0.65], [-0.44, 0.665], [-0.3, 0.66], [0, 0.625], [0.2, 0.59], [0.38, 0.54], [0.46, 0.5], [0.49, 0.46], [0.5, 0.41]],
    bottom: [[-0.5, 0.26], [-0.46, 0.14], [0.44, 0.13], [0.5, 0.2]],
    gh: { xC: -0.487, xR0: -0.445, xR1: 0.02, xA: 0.24, roof: 1, base: 0.885, tumble: 0.38, crown: 0.035, side: [-0.405, 0.19], b: [-0.075, -0.05], rear: true },
    seams: [0.215, -0.07, -0.3], hood: 0.25, boot: null, exhaust: { n: 1, z: 0.32 }, roofSpoiler: true,
  },
  // Low mid-engine wedge: the cabin sits forward, wide hips, a wing.
  sports: {
    pF: 4.5, pR: 6, flare: 0.06, q: 3.0, lean: [0.06, 0.04, 0.05, 0.1], valley: true,
    top: [[-0.5, 0.54], [-0.49, 0.6], [-0.46, 0.63], [-0.4, 0.64], [-0.3, 0.63], [-0.15, 0.6], [0.1, 0.52], [0.25, 0.48], [0.38, 0.45], [0.46, 0.42], [0.49, 0.38], [0.5, 0.34]],
    belt: [[-0.5, 0.5], [-0.49, 0.57], [-0.46, 0.6], [-0.4, 0.61], [-0.25, 0.6], [-0.1, 0.57], [0.1, 0.5], [0.3, 0.45], [0.45, 0.4], [0.49, 0.36], [0.5, 0.32]],
    bottom: [[-0.5, 0.2], [-0.46, 0.1], [0.44, 0.1], [0.5, 0.12]],
    gh: { xC: -0.33, xR0: -0.13, xR1: -0.02, xA: 0.2, roof: 1, base: 0.82, tumble: 0.55, crown: 0.03, side: [-0.27, 0.15], b: null, rear: true },
    seams: [0.15, -0.19], hood: 0.22, boot: -0.37, exhaust: { n: 2, z: 0.2 }, wing: true, skirt: true,
  },
  // Long hood, short deck, fastback, upright square nose.
  muscle: {
    pF: 8, pR: 7, flare: 0.045, q: 3.6, lean: [0.04, 0.05, 0.03, 0.06],
    top: [[-0.5, 0.56], [-0.49, 0.62], [-0.47, 0.655], [-0.42, 0.66], [-0.34, 0.655], [-0.1, 0.64], [0.1, 0.62], [0.3, 0.615], [0.44, 0.6], [0.48, 0.585], [0.5, 0.55]],
    belt: [[-0.5, 0.54], [-0.49, 0.6], [-0.46, 0.625], [-0.35, 0.63], [-0.1, 0.6], [0.1, 0.58], [0.3, 0.58], [0.44, 0.575], [0.48, 0.56], [0.5, 0.53]],
    bottom: [[-0.5, 0.22], [-0.46, 0.12], [0.44, 0.12], [0.5, 0.18]],
    gh: { xC: -0.36, xR0: -0.17, xR1: -0.06, xA: 0.09, roof: 1, base: 0.86, tumble: 0.42, crown: 0.025, side: [-0.27, 0.06], b: null, rear: true },
    seams: [0.085, -0.225], hood: 0.09, boot: -0.37, exhaust: { n: 2, z: 0.36 }, scoop: true, ducktail: true,
  },
  // Speedster: a long bonnet and a low chopped cabin set far back.
  sunchaser: {
    pF: 6, pR: 6, flare: 0.055, q: 3.2, lean: [0.08, 0.05, 0.06, 0.08], face: 'muscle',
    top: [[-0.5, 0.56], [-0.49, 0.62], [-0.47, 0.645], [-0.42, 0.65], [-0.3, 0.645], [-0.1, 0.63], [0.1, 0.6], [0.3, 0.58], [0.44, 0.55], [0.48, 0.52], [0.5, 0.47]],
    belt: [[-0.5, 0.53], [-0.49, 0.59], [-0.46, 0.615], [-0.35, 0.62], [-0.1, 0.6], [0.1, 0.57], [0.3, 0.555], [0.44, 0.53], [0.48, 0.5], [0.5, 0.45]],
    bottom: [[-0.5, 0.2], [-0.46, 0.11], [0.44, 0.11], [0.5, 0.16]],
    gh: { xC: -0.3, xR0: -0.24, xR1: -0.15, xA: -0.02, roof: 0.9, base: 0.84, tumble: 0.5, crown: 0.02, side: [-0.27, -0.04], b: null, rear: true },
    seams: [-0.02, -0.26], hood: -0.01, boot: -0.38, exhaust: { n: 2, z: 0.34 }, ducktail: true, humps: true,
  },
  // The secret car: a teardrop canopy far forward, a long tapering tail
  // with two fins.
  ghostwake: {
    pF: 3.8, pR: 3.4, flare: 0.07, q: 2.8, lean: [0.05, 0.03, 0.06, 0.05], valley: true,
    top: [[-0.5, 0.42], [-0.47, 0.5], [-0.4, 0.55], [-0.25, 0.58], [-0.1, 0.56], [0.1, 0.48], [0.3, 0.42], [0.45, 0.36], [0.5, 0.3]],
    belt: [[-0.5, 0.38], [-0.47, 0.46], [-0.4, 0.52], [-0.25, 0.55], [-0.1, 0.52], [0.1, 0.45], [0.3, 0.4], [0.45, 0.34], [0.5, 0.28]],
    bottom: [[-0.5, 0.18], [-0.45, 0.1], [0.44, 0.1], [0.5, 0.12]],
    gh: { xC: -0.31, xR0: -0.12, xR1: 0.0, xA: 0.24, roof: 0.98, base: 0.72, tumble: 0.7, crown: 0.06, side: [-0.23, 0.2], b: null, rear: true },
    seams: [0.2, -0.17], hood: 0.27, boot: null, exhaust: { n: 2, z: 0.14 }, skirt: true, fins: true,
  },
  pickup: {
    pF: 9, pR: 14, flare: 0.04, q: 4.5, lean: [0.06, 0.08, 0.0, 0.04],
    top: [[-0.5, 0.6], [-0.495, 0.615], [-0.48, 0.62], [-0.1, 0.62], [0.1, 0.612], [0.3, 0.6], [0.44, 0.585], [0.48, 0.57], [0.5, 0.54]],
    belt: [[-0.5, 0.58], [-0.495, 0.6], [-0.48, 0.605], [-0.1, 0.6], [0.1, 0.59], [0.3, 0.58], [0.44, 0.565], [0.48, 0.55], [0.5, 0.52]],
    bottom: [[-0.5, 0.26], [-0.47, 0.2], [0.44, 0.2], [0.5, 0.25]],
    bed: [-0.478, -0.2], floor: 0.45,
    gh: { xC: -0.194, xR0: -0.186, xR1: 0.07, xA: 0.2, roof: 1, base: 0.9, tumble: 0.2, crown: 0.02, side: [-0.18, 0.15], b: [-0.015, 0.005], rear: true },
    seams: [0.165, -0.005, -0.185], hood: 0.19, boot: null, exhaust: { n: 1, z: 0.5 }, skirt: true,
  },
  // Off-road wagon: the pickup's nose with a long closed roof, a roof
  // rack and a spare wheel on the tailgate.
  tidewinder: {
    pF: 9, pR: 12, flare: 0.05, q: 4.5, lean: [0.06, 0.08, 0.02, 0.05], face: 'pickup',
    top: [[-0.5, 0.6], [-0.495, 0.615], [-0.48, 0.62], [-0.1, 0.62], [0.1, 0.612], [0.3, 0.6], [0.44, 0.585], [0.48, 0.57], [0.5, 0.54]],
    belt: [[-0.5, 0.58], [-0.495, 0.6], [-0.48, 0.605], [-0.1, 0.6], [0.1, 0.59], [0.3, 0.58], [0.44, 0.565], [0.48, 0.55], [0.5, 0.52]],
    bottom: [[-0.5, 0.27], [-0.47, 0.21], [0.44, 0.21], [0.5, 0.26]],
    gh: { xC: -0.49, xR0: -0.482, xR1: 0.06, xA: 0.19, roof: 1, base: 0.92, tumble: 0.14, crown: 0.02, side: [-0.18, 0.14], b: [-0.02, 0.0], rear: true, rearSide: [-0.46, -0.2] },
    seams: [0.16, -0.01, -0.19], hood: 0.18, boot: null, exhaust: { n: 1, z: 0.5 }, skirt: true, rack: true, spare: true,
  },
  van: {
    pF: 5, pR: 14, flare: 0.015, q: 5, lean: [0.1, 0.05, 0.0, 0.03],
    top: [[-0.5, 0.47], [-0.495, 0.49], [0.25, 0.49], [0.32, 0.47], [0.4, 0.42], [0.46, 0.37], [0.49, 0.33], [0.5, 0.3]],
    belt: [[-0.5, 0.45], [-0.495, 0.47], [0.25, 0.47], [0.32, 0.45], [0.4, 0.4], [0.46, 0.35], [0.49, 0.31], [0.5, 0.28]],
    bottom: [[-0.5, 0.17], [-0.47, 0.14], [0.44, 0.13], [0.5, 0.18]],
    gh: { xC: -0.497, xR0: -0.49, xR1: 0.17, xA: 0.34, roof: 1, base: 0.94, tumble: 0.1, crown: 0.02, side: [0.12, 0.31], b: null, rear: true, rearSide: [-0.46, -0.3] },
    seams: [0.15, 0.1, -0.2], hood: 0.355, boot: null, exhaust: { n: 1, z: 0.5 }, cargo: true,
  },
  truck: {
    range: [0.2, 0.5], pF: 12, pR: 14, flare: 0.02, q: 5, lean: [0.06, 0.03, 0, 0],
    top: [[0.2, 0.47], [0.45, 0.47], [0.48, 0.455], [0.5, 0.42]],
    belt: [[0.2, 0.45], [0.45, 0.45], [0.48, 0.44], [0.5, 0.4]],
    bottom: [[0.2, 0.22], [0.5, 0.22]],
    gh: { xC: 0.207, xR0: 0.213, xR1: 0.44, xA: 0.487, roof: 0.88, base: 0.95, tumble: 0.06, crown: 0.02, side: [0.36, 0.445], b: null, rear: false },
    seams: [0.36, 0.265], hood: null, boot: null, exhaust: null,
  },
};
STYLES.hatch = STYLES.compact;
STYLES.coupe = STYLES.sports;

export function styleFor(spec) {
  return STYLES[spec.id] || STYLES[spec.body] || STYLES.sedan;
}
// Name of the style a spec resolves to (for tests and tools).
export function styleName(spec) {
  const S = styleFor(spec);
  for (const k in STYLES) if (STYLES[k] === S) return k;
  return 'sedan';
}

// Tyre width per spec.
export function tyreWidth(spec) {
  if (spec.body === 'truck') return 0.4;
  if (spec.id === 'sports' || spec.id === 'ghostwake' || spec.id === 'muscle') return 0.3;
  if (spec.body === 'pickup' || spec.body === 'van') return 0.28;
  return 0.25;
}

export function wheelLayout(spec) {
  const wr = spec.wheelRadius || 0.33;
  const tw = tyreWidth(spec);
  const ax = spec.wheelBase / 2;
  const az = spec.width / 2 - tw / 2 - 0.03;
  return { wr, tw, ax, az };
}

// Resolve a style against a spec into absolute functions of x.
function shape(spec) {
  const S = styleFor(spec);
  const L = spec.length, W = spec.width, H = spec.height;
  const hw = W / 2;
  const { wr, ax } = wheelLayout(spec);
  const range = S.range || [-0.5, 0.5];
  const x0 = range[0] * L, x1 = range[1] * L;
  const mid = (x0 + x1) / 2;
  const hf = x1 - mid, hr = mid - x0;
  const topC = curve(S.top), botC = curve(S.bottom);
  const beltC = S.belt ? curve(S.belt) : null;
  const R = wr * 1.04 + 0.025; // arch radius: hugs the tyre
  const wheels = [ax, -ax].filter((wx) => wx - R > x0 + 0.05 && wx + R < x1 - 0.05);
  const bed = S.bed ? [S.bed[0] * L, S.bed[1] * L] : null;
  const planW = (x) => {
    const t = x >= mid ? (x - mid) / hf : (mid - x) / hr;
    const p = x >= mid ? S.pF : S.pR;
    let w = hw * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, t), p)), 1 / p);
    for (const wx of wheels) {
      const u = (x - wx) / (R * 1.6);
      if (Math.abs(u) < 1) w += S.flare * W * (1 - u * u) * (1 - u * u) * (w / hw);
    }
    return w;
  };
  const drop = (S.drop || 0.07) * H;
  // Fenders rise over the wheels where the body is lower than the arch.
  const archTop = wr + R;
  const need = (x) => {
    let n = 0;
    for (const wx of wheels) {
      const u = Math.abs(x - wx) / (R * 1.7);
      if (u < 1) {
        const f = Math.max(0, (u - 0.3) / 0.7);
        const k = 1 - f * f * (3 - 2 * f);
        n = Math.max(n, (archTop + 0.05) * k);
      }
    }
    return n;
  };
  const ycBase = beltC ? (x) => beltC(x / L) * H
    : (x) => topC(x / L) * H - drop * Math.min(1, 0.4 + 0.6 * Math.min(1, planW(x) / (hw * 0.5)));
  const yc = (x) => Math.max(ycBase(x), need(x));
  // S.valley: the bonnet may sit below the fender peaks (a dip between
  // raised wheel arches) instead of being lifted with them.
  const top = beltC ? (S.valley ? (x) => Math.max(topC(x / L) * H, ycBase(x) + 0.012, yc(x) - 0.2) : (x) => Math.max(topC(x / L) * H, yc(x) + 0.012))
    : (x) => Math.max(topC(x / L) * H, yc(x) - 0.1);
  const bottom = (x) => {
    let y = botC(x / L) * H;
    for (const wx of wheels) {
      const d = x - wx;
      if (Math.abs(d) <= R) y = Math.max(y, wr + Math.sqrt(Math.max(0, R * R - d * d)));
    }
    return Math.min(y, yc(x) - 0.06);
  };
  // Inverse of the plan superellipse: x where w = f * hw (front/rear).
  const tipX = (f, front) => {
    const p = front ? S.pF : S.pR;
    const e = Math.pow(Math.max(0, 1 - Math.pow(f, p)), 1 / p);
    return front ? mid + hf * e : mid - hr * e;
  };
  const q = S.q || 2.6;
  const shoulder = S.belt ? 0.95 : 0.985;
  // Nose and tail lean (S.lean = [nose top, chin, tail top, tail chin],
  // metres): near the ends the upper and lower edges are pulled in toward
  // the middle, so the fascias round over in side view instead of
  // standing as vertical walls. Returns the x shift toward the centre.
  const ln = S.lean;
  const zone = 0.6;
  const ends = ln ? [[x1, bottom(x1 - 0.06), top(x1 - 0.08), ln[0], ln[1]], [x0, bottom(x0 + 0.06), top(x0 + 0.08), ln[2], ln[3]]] : [];
  const sstep = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const lean = ln ? (x, y) => {
    for (const [xe, yb, yt, rt, rb] of ends) {
      const k = sstep(zone, 0, Math.abs(xe - x));
      if (k <= 0) continue;
      const u = (y - yb) / Math.max(0.1, yt - yb);
      const d = rt * Math.pow(sstep(0.45, 1, u), 1.6) + rb * sstep(0.35, 0, u);
      return d * k;
    }
    return 0;
  } : () => 0;
  return { S, L, W, H, hw, wr, R, wheels, x0, x1, mid, planW, top, yc, bottom, tipX, bed, q, shoulder, lean, cache: new Map(), inBed: (x) => bed && x > bed[0] && x < bed[1] };
}

// Side sections (fraction of the sill-to-shoulder height, fraction of the
// plan half width). New-style bodies: tucked sill, full lower door, a
// crisp character line (a small step in), then the upper door leaning in
// to the shoulder. Old-style bodies keep their softer section.
const SIDE = {
  near: [[0, 0.905], [0.06, 0.952], [0.2, 0.986], [0.44, 1], [0.52, 1], [0.56, 0.988], [0.78, 0.972], [1, 0.95]],
  mid: [[0, 0.93], [0.15, 0.982], [0.5, 1], [0.56, 0.988], [1, 0.95]],
  far: [[0, 0.95], [0.48, 1], [1, 0.96]],
  oldNear: [[0, 0.92], [0.07, 0.96], [0.18, 0.985], [0.36, 0.997], [0.54, 1], [0.7, 0.998], [0.735, 0.986], [0.86, 0.988], [1, 0.972]],
  oldFar: [[0, 0.96], [1, 0.985]],
};
function sideOf(sh, lod) {
  if (sh.S.belt) return lod === 0 ? SIDE.near : lod === 1 ? SIDE.mid : SIDE.far;
  return lod === 0 ? SIDE.oldNear : lod === 1 ? SIDE.mid : SIDE.oldFar;
}
const LOD_NEAR = 0, LOD_MID = 1, LOD_FAR = 2;

// Half ring of the lower body at x: [[z, y], ...] bottom to top centre.
// cut: 1 dents the side (door shut line), 2 the deck (bonnet / boot line).
function lowerHalf(sh, x, lod, cut = 0) {
  const w = sh.planW(x);
  const top = sh.top(x);
  const c = sh.yc(x);
  const y0 = sh.bottom(x);
  const out = [];
  const side = sideOf(sh, lod);
  const dz = cut === 1 ? 0.006 : 0;
  for (const [f, k] of side) out.push([w * k - (f > 0.03 && f < 0.99 ? dz : 0), y0 + (c - y0) * f]);
  const ws = w * sh.shoulder;
  const K = lod === LOD_NEAR ? (sh.S.belt ? 6 : 8) : lod === LOD_MID ? 3 : 2;
  if (sh.inBed(x)) {
    const floor = sh.S.floor * sh.H;
    const ww = Math.max(0.01, ws - 0.07);
    if (lod === LOD_NEAR) {
      const fw = Math.max(0.005, ws - 0.1);
      out.push([ws * 0.975, top], [ww, top], [ww, (top + floor) / 2], [ww, floor + 0.04], [fw, floor], [fw * 0.6, floor], [fw * 0.25, floor], [0, floor]);
    } else {
      out.push([ws * 0.975, top], [ws * 0.5, top - 0.05], [0, top - 0.06]);
    }
    return out;
  }
  const Q = sh.q;
  const dy = cut === 2 ? 0.006 : 0;
  // Two raised creases along the bonnet (near model, new styles).
  const hc = lod === LOD_NEAR && sh.S.hoodCrease && x > sh.S.hoodCrease[0] * sh.L && x < sh.S.hoodCrease[1] * sh.L ? sh.S.hoodCrease[2] : 0;
  for (let k = 1; k <= K; k++) {
    const a = (k / K) * Math.PI / 2;
    out.push([ws * spow(Math.cos(a), 2 / Q), c + (top - c) * spow(Math.sin(a), 2 / Q) - (k > 1 ? dy : 0) + (k === K - 2 ? hc : 0)]);
  }
  out[out.length - 1][0] = 0;
  return out;
}

// Height of the lower body's top surface at (x, z).
function surfY(sh, x, z) {
  const ws = sh.planW(x) * sh.shoulder;
  const top = sh.top(x), c = sh.yc(x);
  const u = Math.min(1, Math.abs(z) / Math.max(ws, 1e-4));
  return c + (top - c) * Math.pow(Math.max(0, 1 - Math.pow(u, sh.q)), 1 / sh.q);
}

function mirror(half, x) {
  const J = half.length;
  const ring = [];
  for (let r = 0; r <= 2 * (J - 1); r++) {
    if (r <= J - 1) ring.push([x, half[r][1], half[r][0]]);
    else {
      const h = half[2 * (J - 1) - r];
      ring.push([x, h[1], -h[0]]);
    }
  }
  return ring;
}
// Half-ring band of face r in a mirrored ring of J half points.
function bandOf(r, J) {
  return r < J - 1 ? r : 2 * (J - 1) - r - 1;
}

// Station list of the lower shell; `cuts` collects the x of shut-line
// stations (side or deck dents).
function lowerStations(sh, lod, cuts) {
  const xs = [];
  const near = lod === LOD_NEAR;
  const tips = near ? [0, 0.22, 0.42, 0.6, 0.74, 0.85, 0.93, 0.975, 0.995] : lod === LOD_MID ? [0, 0.5, 0.8, 0.95] : [0, 0.45, 0.75, 0.93];
  for (const f of tips) xs.push(sh.tipX(f, true), sh.tipX(f, false));
  const fill = near ? 0.3 : 0.6;
  const n = Math.max(2, Math.ceil((sh.x1 - sh.x0) / fill));
  for (let i = 1; i < n; i++) xs.push(sh.x0 + ((sh.x1 - sh.x0) * i) / n);
  const ka = near ? 8 : 4;
  for (const wx of sh.wheels) {
    if (near) xs.push(wx + sh.R + 0.004, wx + sh.R - 0.002, wx - sh.R + 0.002, wx - sh.R - 0.004);
    for (let k = near ? 1 : 0; k < (near ? ka : ka + 1); k++) xs.push(wx + sh.R * Math.cos((k / ka) * Math.PI));
  }
  if (near) {
    const S = sh.S, L = sh.L;
    for (const s of S.seams || []) {
      xs.push(s * L, s * L + 0.012);
      if (cuts) {
        cuts.set(Math.round((s * L + 0.006) * 1e4), 1);
        xs.push(s * L + 0.006);
      }
    }
    for (const s of [S.hood, S.boot]) {
      if (s == null) continue;
      const a = s === S.boot ? s * L - 0.012 : s * L;
      xs.push(a, a + 0.012);
      if (cuts && S.belt) {
        cuts.set(Math.round((a + 0.006) * 1e4), 2);
        xs.push(a + 0.006);
      }
    }
    if (sh.bed) xs.push(sh.bed[0], sh.bed[0] - 0.006, sh.bed[1], sh.bed[1] + 0.006);
  }
  const inside = xs.filter((x) => x >= sh.x0 - 1e-6 && x <= sh.x1 + 1e-6);
  return uniqSorted(inside, 0.0012);
}

// ---- greenhouse --------------------------------------------------------------
function ghShape(sh) {
  const g = sh.S.gh;
  const L = sh.L;
  const xC = g.xC * L, xR0 = g.xR0 * L, xR1 = g.xR1 * L, xA = g.xA * L;
  const crown = g.crown * sh.H;
  const roofY = g.roof * sh.H - crown;
  const baseW = (x) => sh.planW(x) * sh.shoulder * g.base;
  // On a valley bonnet the deck dips toward the middle: the glass starts
  // at the lower of the two so no gap opens under the windscreen.
  const baseY = (x) => Math.min(surfY(sh, x, baseW(x)), sh.top(x)) - 0.03;
  const yA = baseY(xA), yC = baseY(xC);
  const roofC = curve([
    [xC, yC], [xC + (xR0 - xC) * 0.5, yC + (roofY - yC) * 0.62], [xR0, roofY - 0.012],
    [(xR0 + xR1) / 2, roofY], [xR1, roofY - 0.01], [xR1 + (xA - xR1) * 0.5, yA + (roofY - yA) * 0.55], [xA, yA],
  ]);
  return { g, xC, xR0, xR1, xA, crown, roofY, baseW, baseY, roof: roofC };
}

// Greenhouse half section. Bands (near): 0 seal, 1..3 side glass, 4 roof
// rail, 5.. roof (windscreen / rear glass). Mid and far: 0 side glass,
// 1 rail, 2.. roof.
function ghHalf(sh, gs, x, lod) {
  const wb = gs.baseW(x);
  const gb = gs.baseY(x);
  const R = Math.max(gb, gs.roof(x));
  const h = R - gb;
  const hmax = gs.roofY - gb;
  const lean = gs.g.tumble * Math.max(0, Math.min(1, h / Math.max(0.05, hmax))) * hmax;
  const wt = wb - (sh.S.belt ? lean * Math.min(1, h / Math.max(0.05, hmax)) * 1.0 : lean);
  const rail = Math.min(h * 0.18, 0.06);
  const crown = gs.crown * Math.min(1, h / Math.max(0.05, hmax));
  const bul = sh.S.belt ? Math.min(0.018, h * 0.04) : 0;
  const at = (v) => [wb + (wt - wb) * v + bul * Math.sin(Math.PI * v), gb + v * (h - rail)];
  const out = [];
  out.push([wb, gb]);
  if (lod === LOD_NEAR) {
    const seal = Math.min(h, 0.05) / Math.max(h - rail, 1e-4);
    const s0 = Math.min(1, seal);
    out.push(at(s0), at(s0 + (1 - s0) * 0.45), at(1));
  } else {
    out.push(at(1));
  }
  out.push([wt * 0.985 + bul * 0.3, R - rail * 0.25]);
  const K = lod === LOD_NEAR ? 4 : 2;
  for (let k = 1; k <= K; k++) {
    const a = (k / K) * Math.PI / 2;
    out.push([wt * 0.97 * spow(Math.cos(a), 0.55), R + crown * spow(Math.sin(a), 0.8)]);
  }
  out[out.length - 1][0] = 0;
  return out;
}

function ghStations(sh, gs, lod) {
  const g = gs.g, L = sh.L;
  const xs = [gs.xC, gs.xR0, gs.xR1, gs.xA];
  const near = lod === LOD_NEAR;
  const n = near ? 14 : 4;
  for (let i = 1; i < n; i++) xs.push(gs.xC + ((gs.xA - gs.xC) * i) / n);
  for (const v of g.side) xs.push(v * L);
  if (near) {
    if (g.b) xs.push(g.b[0] * L, g.b[1] * L);
    if (g.rearSide) xs.push(g.rearSide[0] * L, g.rearSide[1] * L);
    // Extra stations on the windscreen and rear glass curves.
    for (const f of [0.25, 0.5, 0.75]) xs.push(gs.xR1 + (gs.xA - gs.xR1) * f, gs.xC + (gs.xR0 - gs.xC) * f);
  } else if (lod === LOD_MID) {
    xs.push(gs.xR1 + (gs.xA - gs.xR1) * 0.5, gs.xC + (gs.xR0 - gs.xC) * 0.5);
  }
  return uniqSorted(xs.filter((x) => x >= gs.xC && x <= gs.xA), 0.002);
}

// ---- parts -----------------------------------------------------------------------
const M = new THREE.Matrix4();
const E = new THREE.Euler();
const Qn = new THREE.Quaternion();
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
function place(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz);
  Qn.setFromEuler(E);
  V1.set(x, y, z);
  V2.set(sx, sy, sz);
  return M.compose(V1, Qn, V2);
}
function box(acc, hex, cls, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  acc.geo(new THREE.BoxGeometry(sx, sy, sz), hex, cls, place(x, y, z, rx, ry, rz));
}
// Rounded little blob (mirror housings, lamps).
function blob(acc, hex, cls, sx, sy, sz, x, y, z, seg = 8) {
  acc.geo(new THREE.SphereGeometry(0.5, seg, Math.max(4, seg - 2)), hex, cls, place(x, y, z, 0, 0, 0, sx, sy, sz));
}
function cylX(acc, hex, cls, r, len, x, y, z, seg = 10, open = false) {
  acc.geo(new THREE.CylinderGeometry(r, r, len, seg, 1, open), hex, cls, place(x, y, z, 0, 0, -Math.PI / 2));
}

// Wheel-well liners: an upside-down U tube inside each arch plus an
// inner wall, so you never see through the body.
function archLiners(acc, sh, N = 10) {
  const R = sh.R + 0.01;
  const col = lin(ARCH);
  for (const wx of sh.wheels) {
    for (const s of [1, -1]) {
      const zi = (sh.hw - 0.42) * s;
      const yb = Math.min(sh.wr * 0.5, sh.bottom(wx + R + 0.02));
      // Profile around the arch, rear foot -> over the top -> front foot.
      const prof = [[wx - R, yb]];
      for (let k = 0; k <= N; k++) {
        const a = Math.PI - (k / N) * Math.PI;
        prof.push([wx + Math.cos(a) * R, sh.wr + Math.sin(a) * R]);
      }
      prof.push([wx + R, yb]);
      // Inner tube faces point toward the wheel (down / inward).
      for (let k = 0; k < prof.length - 1; k++) {
        const [ax_, ay] = prof[k], [bx, by] = prof[k + 1];
        let nx = -(by - ay), ny = bx - ax_; // left normal of the path (points to arch centre)
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const za = s * (sh.planW(ax_) * 0.965), zb = s * (sh.planW(bx) * 0.965);
        const a = acc.vert(ax_, ay, za, nx, ny, 0, col, CLS.TRIM);
        const b = acc.vert(bx, by, zb, nx, ny, 0, col, CLS.TRIM);
        const c = acc.vert(bx, by, zi, nx, ny, 0, col, CLS.TRIM);
        const d = acc.vert(ax_, ay, zi, nx, ny, 0, col, CLS.TRIM);
        if (s > 0) { acc.tri(a, c, b); acc.tri(a, d, c); } else { acc.tri(a, b, c); acc.tri(a, c, d); }
      }
      // Inner wall facing outward (fan from the axle point).
      const cIdx = acc.vert(wx, sh.wr, zi, 0, 0, s, col, CLS.TRIM);
      const ids = prof.map(([px, py]) => acc.vert(px, py, zi, 0, 0, s, col, CLS.TRIM));
      for (let k = 0; k < ids.length - 1; k++) {
        if (s > 0) acc.tri(cIdx, ids[k], ids[k + 1]);
        else acc.tri(cIdx, ids[k + 1], ids[k]);
      }
    }
  }
}

// Flat dark underside.
function underside(acc, sh, xs) {
  const col = lin(ARCH);
  const y = sh.S.bottom ? curve(sh.S.bottom)(0) * sh.H + 0.02 : 0.2;
  const ids = [];
  for (const x of [xs[1], xs[xs.length - 2]]) {
    const w = sh.planW(x) * 0.9;
    ids.push(acc.vert(x, y, -w, 0, -1, 0, col, CLS.TRIM), acc.vert(x, y, w, 0, -1, 0, col, CLS.TRIM));
  }
  acc.tri(ids[0], ids[2], ids[3]);
  acc.tri(ids[0], ids[3], ids[1]);
}

// ---- conformal patches -----------------------------------------------------------
// Lamps, grilles, intakes and plates are thin shells laid on the body by
// casting plan-view rays from inside the nose or tail, so their outlines
// are smooth curves instead of steps of the body grid.

// Half width of the lower body at (x, y), or -1 outside its height span.
// Sections are cached per millimetre while one car is built.
function halfWidthAt(sh, x, y) {
  if (x < sh.x0 || x > sh.x1) return -1;
  const d = sh.lean(x, y);
  if (d) {
    x += x > sh.mid ? d : -d;
    if (x < sh.x0 || x > sh.x1) return -1;
  }
  const key = Math.round(x * 1000);
  let h = sh.cache.get(key);
  if (!h) {
    h = lowerHalf(sh, key / 1000, LOD_NEAR);
    sh.cache.set(key, h);
  }
  if (y < h[0][1] || y > h[h.length - 1][1]) return -1;
  for (let k = 1; k < h.length; k++) {
    if (y <= h[k][1]) {
      const p = h[k - 1], q = h[k];
      const t = (y - p[1]) / Math.max(1e-6, q[1] - p[1]);
      return p[0] + (q[0] - p[0]) * t;
    }
  }
  return -1;
}

// Distance along a level ray from (ox, y, oz) to where it leaves the body.
function castBody(sh, ox, y, oz, ux, uz) {
  let lo = 0, hi = 4;
  for (let k = 0; k < 22; k++) {
    const t = (lo + hi) / 2;
    const w = halfWidthAt(sh, ox + ux * t, y);
    if (w >= 0 && Math.abs(oz + uz * t) <= w) lo = t;
    else hi = t;
  }
  return lo;
}

// Ray origin and reference heights for the nose (front) or tail.
function faceFrame(sh, front) {
  let archF = sh.mid, archR = sh.mid;
  for (const wx of sh.wheels) {
    archF = Math.max(archF, wx + sh.R);
    archR = Math.min(archR, wx - sh.R);
  }
  if (front) {
    const od = Math.max(0.12, Math.min(0.6, sh.x1 - archF - 0.05));
    return { front, ox: sh.x1 - od, sx: 1, yb: sh.bottom(sh.x1 - 0.06), yt: sh.yc(sh.x1 - 0.22) };
  }
  let od = Math.max(0.12, Math.min(0.6, archR - sh.x0 - 0.05));
  if (sh.bed) od = Math.min(od, Math.max(0.03, sh.bed[0] - sh.x0 - 0.03));
  return { front, ox: sh.x0 + od, sx: -1, yb: sh.bottom(sh.x0 + 0.06), yt: sh.yc(sh.x0 + 0.22) };
}

// Grid of a lens-shaped patch: outline index (closed loop) by rings from
// the outline (`levels[0]`) inward. o.q: lateral span as signed fractions of
// the half width, o.f: height span as fractions between the frame's bottom
// and shoulder, o.e: superellipse exponent (2 oval .. 8 nearly square),
// o.slant: height change across the span, o.taper: taller at the outer end.
export function patchGrid(sh, fr, o, side, levels, N = 24) {
  const e = o.e || 3;
  const qc = (o.q[0] + o.q[1]) / 2, qa = (o.q[1] - o.q[0]) / 2;
  const fc = (o.f[0] + o.f[1]) / 2, fa = (o.f[1] - o.f[0]) / 2;
  const P = [];
  for (let k = 0; k <= N; k++) {
    const ph = ((k % N) / N) * Math.PI * 2;
    const ca = spow(Math.cos(ph), 2 / e), sb = spow(Math.sin(ph), 2 / e);
    const row = [];
    for (const s of levels) {
      const a = ca * s, b = sb * s;
      const q = qc + qa * a;
      const f = fc + fa * b * (1 + (o.taper || 0) * a) + (o.slant || 0) * a;
      const y = fr.yb + f * (fr.yt - fr.yb);
      // Aim at the plan outline, but never behind the origin (that would
      // run the ray back into the wheel well).
      const tx = sh.tipX(Math.min(0.995, Math.abs(q)), fr.front);
      const px = fr.front ? Math.max(tx, fr.ox + 0.14) : Math.min(tx, fr.ox - 0.14);
      const dx = px - fr.ox, dz = q * sh.hw * side;
      const l = Math.hypot(dx, dz) || 1;
      const ux = dx / l, uz = dz / l;
      const t = castBody(sh, fr.ox, y, 0, ux, uz);
      const lift = (o.lift || 0.004) + (o.bulge || 0) * Math.max(0, 1 - s * s);
      row.push([fr.ox + ux * (t + lift), y, uz * (t + lift)]);
    }
    P.push(row);
  }
  return P;
}

// Emit a grid with its faces turned toward `out(c)` (a rough outward
// direction at a face centre).
function emitOut(acc, P, fn, out, opts = {}) {
  let flip = false;
  search: for (let i = 0; i < P.length - 1; i++) {
    for (let r = 0; r < P[0].length - 1; r++) {
      const a = P[i][r], b = P[i + 1][r], c = P[i + 1][r + 1], d = P[i][r + 1];
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
      const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const o = out(a);
      const dot = nx * o[0] + ny * o[1] + nz * o[2];
      if (Math.abs(dot) > 1e-9) {
        flip = dot < 0;
        break search;
      }
    }
  }
  emitGrid(acc, P, fn, { ...opts, flip });
}

const FACE_DEF = {
  head: { q: [0.5, 0.97], f: [0.6, 0.86], e: 3, slant: 0.05, taper: 0.25, bulge: 0.012, lift: 0.006, ind: 0.9 },
  grille: { q: [-0.44, 0.44], f: [0.27, 0.5], e: 5, lift: 0.004, bezel: CHROME },
  intake: { q: [-0.62, 0.62], f: [0.07, 0.3], e: 5, lift: 0.003 },
  tail: { q: [0.52, 0.98], f: [0.62, 0.84], e: 3.4, slant: 0.04, taper: 0.2, bulge: 0.008, lift: 0.006, rev: 0.66, bar: true },
  plateF: 0.24, plateR: 0.4,
};
// Per style overrides of the nose and tail graphics.
const FACES = {
  sedan: {
    head: { q: [0.38, 0.975], f: [0.62, 0.92], e: 3.2, slant: 0.1, taper: 0.55, bulge: 0.008, lift: 0.006, ind: 0.9, drl: 'L' },
    grille: { q: [-0.48, 0.48], f: [0.34, 0.68], e: 5, lift: 0.004, bezel: CHROME, slats: 3, slatHex: 0x2a2c30 },
    intake: { q: [-0.6, 0.6], f: [0.08, 0.26], e: 7, lift: 0.003 },
    fog: { q: [0.75, 0.87], f: [0.13, 0.22], e: 2.6 },
    tail: { q: [0.36, 0.985], f: [0.7, 0.9], e: 4, slant: 0.04, taper: 0.35, bulge: 0.006, lift: 0.006, rev: 0.5, bar: true },
    plateF: 0.24, plateR: 0.45,
  },
  compact: {
    head: { q: [0.44, 0.97], f: [0.6, 0.88], e: 3.4, slant: 0.06, taper: 0.25, bulge: 0.01, lift: 0.006, ind: 0.9 },
    grille: { q: [-0.4, 0.4], f: [0.46, 0.64], e: 6, lift: 0.004, slats: 2, slatHex: 0x2a2c30 },
    intake: { q: [-0.64, 0.64], f: [0.08, 0.32], e: 6, lift: 0.003 },
    tail: { q: [0.5, 0.985], f: [0.62, 0.9], e: 3.5, taper: 0.2, bulge: 0.008, lift: 0.006, rev: 0.66, bar: false },
    plateR: 0.4,
  },
  taxi: {
    head: { q: [0.52, 0.95], f: [0.5, 0.84], e: 7, bulge: 0.006, lift: 0.006, ind: 0.9 },
    grille: { q: [-0.48, 0.48], f: [0.34, 0.76], e: 8, lift: 0.005, bezel: CHROME, slats: 4 },
    intake: null,
    tail: { q: [0.58, 0.985], f: [0.5, 0.86], e: 7, bulge: 0.004, lift: 0.006, rev: 0.7, bar: false },
    plateF: 0.2, plateR: 0.3,
  },
  ghostwake: {
    head: { q: [0.45, 0.96], f: [0.55, 0.8], e: 2.4, slant: 0.12, taper: 0.5, bulge: 0.01, lift: 0.006, ind: 0.9, drl: 'L' },
    grille: null, intake: { q: [-0.7, 0.7], f: [0.1, 0.36], e: 4, lift: 0.004 },
    tail: { q: [0.3, 0.985], f: [0.6, 0.76], e: 6, slant: 0.03, bulge: 0.004, lift: 0.006, rev: 0.4, bar: true },
    plateF: 0.2,
  },
  sports: { head: { q: [0.48, 0.97], f: [0.62, 0.8], e: 2.6, slant: 0.1, taper: 0.4, bulge: 0.01, lift: 0.006, ind: 0.9 }, grille: null, intake: { q: [-0.62, 0.62], f: [0.12, 0.38], e: 4, lift: 0.004 }, tail: { q: [0.4, 0.98], f: [0.62, 0.8], e: 4, slant: 0.05, bulge: 0.006, lift: 0.006, rev: 0.5, bar: true }, plateF: 0.2 },
  muscle: { head: { q: [0.52, 0.94], f: [0.5, 0.82], e: 6, lift: 0.006, bulge: 0.008, ind: 2 }, grille: { q: [-0.5, 0.5], f: [0.4, 0.82], e: 6, lift: 0.004, bezel: CHROME }, intake: { q: [-0.5, 0.5], f: [0.08, 0.26], e: 6, lift: 0.003 }, tail: { q: [0.3, 0.97], f: [0.56, 0.84], e: 6, bulge: 0.006, lift: 0.006, rev: 0.4, bar: true } },
  pickup: { head: { q: [0.56, 0.96], f: [0.55, 0.88], e: 5, bulge: 0.01, lift: 0.006, ind: 0.9 }, grille: { q: [-0.54, 0.54], f: [0.36, 0.86], e: 7, lift: 0.005, bezel: CHROME }, intake: { q: [-0.6, 0.6], f: [0.08, 0.24], e: 6, lift: 0.003 }, tail: { q: [0.76, 0.99], f: [0.55, 0.92], e: 6, bulge: 0.004, lift: 0.006, rev: 0.84, bar: false }, plateR: 0.3 },
  van: { head: { q: [0.5, 0.96], f: [0.62, 0.92], e: 3, slant: 0.04, taper: 0.2, bulge: 0.012, lift: 0.006, ind: 0.88, drl: 'L' }, grille: { q: [-0.42, 0.42], f: [0.42, 0.7], e: 5, lift: 0.004, slats: 2, slatHex: 0x2a2c30 }, intake: { q: [-0.6, 0.6], f: [0.08, 0.3], e: 6, lift: 0.003 }, tail: { q: [0.8, 0.95], f: [0.45, 0.92], e: 5, bulge: 0.004, lift: 0.006, rev: 0.86, bar: false }, plateR: 0.3 },
  truck: { head: { q: [0.6, 0.94], f: [0.1, 0.25], e: 5, bulge: 0.01, lift: 0.008, ind: 0.88 }, grille: { q: [-0.5, 0.5], f: [0.32, 0.7], e: 8, lift: 0.006, bezel: CHROME }, intake: null, tail: null, plateF: 0.06 },
};
FACES.police = { ...FACES.sedan, fog: null, grille: { ...FACES.sedan.grille, bezel: 0x1a1c1f } };
function faceFor(spec) {
  const n = styleName(spec);
  return { ...FACE_DEF, ...(FACES[n] || FACES[styleFor(spec).face] || {}) };
}

function lens(acc, sh, fr, o, side, cellFn, hex, cls, N = 24) {
  // Domed lenses get a few rings; flat ones are a fan.
  const P = patchGrid(sh, fr, o, side, o.bulge && N > 12 ? [1, 0.72, 0.38, 0] : [1, 0], N);
  const res = { col: lin(hex), cls, u: 0, v: 0 };
  emitOut(acc, P, (i, r, c) => {
    if (cellFn) {
      res.u = (cellFn(c) + 0.5) / 8;
      res.v = 0.5;
    }
    return res;
  }, (c) => [c[0] - fr.ox, 0, c[2]], { crease: 0.3 });
}
// A ring around a patch outline (bezel, housing).
function bezel(acc, sh, fr, o, side, width, hex, cls, N = 24) {
  const P = patchGrid(sh, fr, { ...o, lift: (o.lift || 0.004) * 0.5, bulge: 0 }, side, [1 + width, 1], N);
  const res = { col: lin(hex), cls };
  emitOut(acc, P, () => res, (c) => [c[0] - fr.ox, 0, c[2]], { crease: 0.3 });
}

// Flat plate with invented text from the lamp atlas (u 0.625..1).
function plateQuad(acc, sh, fr, f, hw2, hh) {
  const y = fr.yb + f * (fr.yt - fr.yb);
  let x = fr.front ? -1e9 : 1e9;
  for (const z of [-hw2, 0, hw2]) {
    for (const dy of [-hh, hh]) {
      const t = castBody(sh, fr.ox, y + dy, z, fr.sx, 0);
      const px = fr.ox + fr.sx * t;
      x = fr.front ? Math.max(x, px) : Math.min(x, px);
    }
  }
  x += fr.sx * 0.008;
  const col = lin(WHITE);
  const s = fr.sx;
  const ids = [];
  for (const [zz, yy, u, v] of [[-hw2, -hh, 0, 0], [hw2, -hh, 1, 0], [hw2, hh, 1, 1], [-hw2, hh, 0, 1]]) {
    const uu = 1 - u; // reads left to right from outside, front and rear
    ids.push(acc.vert(x, y + yy, zz * s, s, 0, 0, col, 0, 0.625 + uu * 0.375, 0.25 + v * 0.5));
  }
  acc.tri(ids[0], ids[2], ids[1]);
  acc.tri(ids[0], ids[3], ids[2]);
  return { x, y };
}

// Nose and tail: lamps with lens shapes, DRL strips, grille, intakes,
// light bar and plates. lod LOD_MID: lenses and plates only.
function fascia(acc, headAcc, tailAcc, sh, spec, lod) {
  const F = faceFor(spec);
  const hw = sh.hw;
  const ff = faceFrame(sh, true);
  const S = sh.S;
  const near = lod === LOD_NEAR;
  const dark = spec.id === 'sports' || spec.id === 'ghostwake' || spec.id === 'police';
  const N = near ? 18 : 10;
  if (F.head) {
    const h = F.head;
    const fr = h.f[1] - h.f[0], qr = h.q[1] - h.q[0];
    const top = h.lift + (h.bulge || 0) + 0.003;
    for (const side of [1, -1]) {
      if (near) bezel(acc, sh, ff, h, side, 0.1, 0x16181b, CLS.CHROME);
      // Smoked housing (cell 4: never lit), round projectors (cells 0 / 1)
      // and an LED strip along the top edge (cell 2).
      const cell = side < 0 ? 0 : 1;
      if (!near) {
        lens(headAcc, sh, ff, { ...h, bulge: 0 }, side, () => cell, WHITE, 0, N);
        continue;
      }
      lens(headAcc, sh, ff, h, side, () => 4, WHITE, 0, N);
      const rq = 0.042 / sh.hw, rf = 0.042 / Math.max(0.1, ff.yt - ff.yb);
      for (const t of [0.3, 0.6]) {
        const qc = h.q[0] + qr * t;
        const fc = h.f[0] + fr * 0.4 + (h.slant || 0) * (t * 2 - 1) * 0.9;
        lens(headAcc, sh, ff, { q: [qc - rq, qc + rq], f: [fc - rf, fc + rf], e: 2, bulge: 0.006, lift: top }, side, () => cell, WHITE, 0, 10);
      }
      if (h.drl === 'L') {
        // An L-shaped light guide: along the top edge and down the outer end.
        lens(headAcc, sh, ff, { q: [h.q[0] + qr * 0.06, h.q[1] - qr * 0.04], f: [h.f[1] - fr * 0.2, h.f[1] - fr * 0.06], e: 8, slant: h.slant, taper: h.taper * 0.3, lift: top }, side, () => 2, WHITE, 0, 16);
        lens(headAcc, sh, ff, { q: [h.q[1] - qr * 0.12, h.q[1] - qr * 0.04], f: [h.f[0] + fr * 0.25, h.f[1] - fr * 0.1], e: 8, lift: top }, side, () => 2, WHITE, 0, 12);
      } else {
        const drl = { q: [h.q[0] + qr * 0.04, h.q[1] - qr * 0.05], f: [h.f[1] - fr * 0.24, h.f[1] - fr * 0.1], e: 6, slant: h.slant, lift: top };
        lens(headAcc, sh, ff, drl, side, () => 2, WHITE, 0, 16);
      }
    }
  }
  if (F.grille && near) {
    const g = F.grille;
    bezel(acc, sh, ff, g, 1, 0.06, dark ? 0x1a1c1f : g.bezel || 0x1a1c1f, dark ? CLS.TRIM : CLS.CHROME);
    lens(acc, sh, ff, g, 1, null, GRILLE, CLS.TRIM);
    // Horizontal slats.
    const n = g.slats || 3;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.8) / (n + 0.6);
      const fy = g.f[0] + (g.f[1] - g.f[0]) * t;
      const sl = { q: [g.q[0] * 0.92, g.q[1] * 0.92], f: [fy - 0.011, fy + 0.011], e: 8, lift: (g.lift || 0.004) + 0.006 };
      lens(acc, sh, ff, sl, 1, null, dark || g.slatHex ? g.slatHex || 0x2a2c30 : 0x9a9ea4, dark || g.slatHex ? CLS.TRIM : CLS.CHROME, 12);
    }
  }
  if (F.intake && near) {
    lens(acc, sh, ff, F.intake, 1, null, GRILLE, CLS.TRIM);
    if (spec.id === 'sports' || spec.id === 'ghostwake' || spec.id === 'muscle' || spec.id === 'police') {
      for (const side of [1, -1]) lens(acc, sh, ff, { q: [0.7, 0.93], f: [0.14, 0.32], e: 4, lift: 0.004 }, side, null, GRILLE, CLS.TRIM, 12);
    }
  }
  if (F.fog && near) {
    for (const side of [1, -1]) {
      const fo = { ...F.fog, lift: 0.005 };
      bezel(acc, sh, ff, fo, side, 0.25, GRILLE, CLS.TRIM, 12);
      lens(headAcc, sh, ff, { ...fo, lift: 0.007 }, side, () => (side < 0 ? 0 : 1), WHITE, 0, 12);
    }
  }
  if (F.plateF != null) plateQuad(headAcc, sh, ff, F.plateF, S.range ? 0.26 : 0.24, S.range ? 0.06 : 0.058);
  if (F.tail) {
    const fr = faceFrame(sh, false);
    const t = F.tail;
    for (const side of [1, -1]) {
      if (near) bezel(acc, sh, fr, t, side, 0.06, 0x18090a, CLS.CHROME);
      // Cells: 0 red (left), 3 red (right), 1 reverse, 2 indicator.
      lens(tailAcc, sh, fr, near ? t : { ...t, bulge: 0 }, side, (c) => {
        const az = Math.abs(c[2]);
        if (az < t.rev * hw + 0.02 * hw && az > t.rev * hw - 0.1 * hw) return 1;
        if (az > 0.95 * hw) return 2;
        return c[2] > 0 ? 3 : 0;
      }, WHITE, 0, N);
    }
    if (t.bar) {
      const fy = t.f[0] + (t.f[1] - t.f[0]) * 0.55;
      lens(tailAcc, sh, fr, { q: [-t.q[0] - 0.02, t.q[0] + 0.02], f: [fy - 0.022, fy + 0.022], e: 8, lift: 0.006 }, 1, (c) => (c[2] > 0 ? 3 : 0), WHITE, 0, near ? 16 : 8);
    }
    plateQuad(tailAcc, sh, fr, F.plateR, 0.24, 0.058);
    // Dark diffuser under the bumper.
    if (near) lens(acc, sh, fr, { q: [-0.62, 0.62], f: [0.06, 0.22], e: 6, lift: 0.004 }, 1, null, TRIM, CLS.TRIM);
  }
}

// Fender lips: a rolled edge around each wheel arch, so the fenders read
// as pressed panels that hug the tyres.
function archLips(acc, sh) {
  const col = lin(WHITE);
  const res = { col, cls: CLS.PAINT };
  for (const wx of sh.wheels) {
    for (const s of [1, -1]) {
      const P = [];
      const N = 10;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI;
        const ca = Math.cos(a), sa = Math.sin(a);
        const row = [];
        for (const [dr, dz] of [[-0.01, -0.03], [0.02, 0.016], [0.065, 0.001]]) {
          const r = sh.R + dr;
          const x = wx + ca * r, y = sh.wr + sa * r;
          let w = halfWidthAt(sh, x, Math.min(y, sh.yc(x) - 0.01));
          if (w < 0) w = sh.planW(x) * 0.99;
          row.push([x, y, s * (w + dz)]);
        }
        P.push(row);
      }
      emitOut(acc, P, () => res, (c) => [c[0] - wx, c[1] - sh.wr, s * 2], { crease: 0.2 });
    }
  }
}

// ---- cabin -------------------------------------------------------------------------
// Seats, dashboard, steering wheel and a headliner: seen dimly through the
// tinted glass. The lower shell's top inside the greenhouse is the floor.
function cabin(acc, sh, gs, spec) {
  const g = gs.g;
  const xA = gs.xA, xR1 = gs.xR1, xR0 = gs.xR0, xC = gs.xC;
  const len = xA - xC;
  if (len < 0.6) return;
  const xm = (xA + xC) / 2;
  const belt = gs.baseY(xm);
  const zw = gs.baseW(xm) - 0.06;
  // Dashboard under the windscreen with a dark top.
  const dx = Math.min(0.42, len * 0.25);
  box(acc, DASH, CLS.CABIN, dx, 0.16, zw * 2, xA - dx * 0.5 - 0.02, gs.baseY(xA - dx * 0.5) + 0.02, 0, 0, 0, 0.12);
  // Front seats sit a little behind the roof's front edge; a rear bench
  // under the rear glass when the cabin is long enough.
  const fx = Math.min(xR1 - (xR1 - xR0) * 0.45, xA - 0.95);
  // Seat backs and headrests fit under the roof line (chopped roofs).
  const room = (x) => Math.max(0.2, gs.roof(x) - belt - 0.08);
  const seat = (x, z, w) => {
    const k = Math.min(1, room(x) / 0.62);
    const yb = belt - 0.12;
    box(acc, SEAT, CLS.CABIN, 0.13, 0.5 * k, w, x, yb + 0.25 * k, z, 0, 0, 0.2);
    box(acc, SEAT, CLS.CABIN, 0.1, 0.16 * k, Math.min(w, 0.26) * 0.95, x - 0.07, yb + 0.58 * k, z, 0, 0, 0.12);
  };
  const two = len > 2.0 && g.rear && !sh.S.cargo;
  if (spec.body !== 'truck') {
    for (const s of [1, -1]) seat(fx, s * zw * 0.47, Math.min(0.5, zw * 0.8));
  } else {
    for (const s of [1, -1]) seat(fx, s * zw * 0.5, 0.5);
  }
  if (sh.S.cargo) {
    // Bulkhead behind the front seats; the load space stays dark.
    const bx = fx - 0.3, top = gs.roof(bx) - 0.06;
    const lean = g.tumble * (top - belt);
    box(acc, DASH, CLS.CABIN, 0.05, top - belt + 0.12, (zw - lean) * 2, bx, (top + belt) / 2 - 0.06, 0);
  }
  if (two) {
    const rx = Math.max(xC + 0.35, fx - 0.85);
    const k = Math.min(1, room(rx) / 0.56);
    box(acc, SEAT, CLS.CABIN, 0.14, 0.42 * k, zw * 1.8, rx, belt - 0.12 + 0.21 * k, 0, 0, 0, 0.26);
    for (const s of [1, -1]) box(acc, SEAT, CLS.CABIN, 0.1, 0.14 * k, 0.24, rx - 0.08, belt - 0.12 + 0.48 * k, s * zw * 0.5, 0, 0, 0.2);
  }
  // Steering wheel (driver on the left: -z) on a short column.
  const sx = xA - dx - 0.1;
  const sy = gs.baseY(sx) + 0.08;
  const sz = -zw * 0.47;
  // Ring axis along x, tilted so the rim leans back toward the driver.
  M.makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationZ(-0.45)).setPosition(sx, sy, sz);
  acc.geo(new THREE.TorusGeometry(0.17, 0.02, 4, 10), 0x121314, CLS.CABIN, M);
  box(acc, 0x121314, CLS.CABIN, 0.24, 0.05, 0.05, sx + 0.1, sy - 0.03, sz, 0, 0, 0.5);
}

// Inside of the roof and pillars (the outer shell is one-sided): the
// greenhouse grid again, faces turned inward and pulled in a little,
// without the glass.
function headliner(acc, G, isGlass, GJ) {
  const P = G.map((ring) => ring.map((p) => [p[0], p[1] - 0.012, p[2] * 0.985]));
  const res = { col: lin(HEADLINER), cls: CLS.CABIN };
  emitGrid(acc, P, (i, r, c) => {
    const jj = bandOf(r, GJ);
    if (isGlass(c[0], jj)) return null;
    return res;
  }, { flip: true, crease: 0.4 });
}

// ---- contact shadow ---------------------------------------------------------------
// Rounded-rectangle rings under the car: darkest just inside the sills,
// lighter in the middle, fading to nothing 0.3 m outside the body; and a
// darker patch under each tyre. Drawn by the glass material (class SHADOW,
// u = opacity), pressed onto the ground there.
function contactShadow(acc, sh, spec, near) {
  const hl = spec.length / 2 + 0.02, hw = spec.width / 2 + 0.01;
  const N = near ? 20 : 12;
  const rings = [[0.55, 0.62], [0.93, 0.8], [1.0, 0.56], [1.0, 0]];
  const pad = [0, 0, 0, 0.32];
  const col = lin(0);
  const e = 6;
  const P = [];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const ca = spow(Math.cos(a), 2 / e), sa = spow(Math.sin(a), 2 / e);
    const row = [];
    for (let r = 0; r < rings.length; r++) {
      const s = rings[r][0];
      row.push([ca * (hl * s + pad[r]), sa * (hw * s + pad[r]), rings[r][1]]);
    }
    P.push(row);
  }
  const ids = [];
  for (let k = 0; k <= N; k++) ids.push(P[k].map(([x, z, a]) => acc.vert(x, 0.02, z, 0, 1, 0, col, CLS.SHADOW, a, 0)));
  const c = acc.vert(0, 0.02, 0, 0, 1, 0, col, CLS.SHADOW, 0.6, 0);
  for (let k = 0; k < N; k++) {
    acc.tri(c, ids[k + 1][0], ids[k][0]);
    for (let r = 0; r < rings.length - 1; r++) {
      acc.tri(ids[k][r], ids[k + 1][r], ids[k + 1][r + 1]);
      acc.tri(ids[k][r], ids[k + 1][r + 1], ids[k][r + 1]);
    }
  }
  // Tyre contact patches.
  if (!near) return;
  const { wr, tw, ax, az } = wheelLayout(spec);
  for (const wx of [ax, -ax]) {
    for (const s of [1, -1]) {
      const z = s * az, lx = wr * 0.9, lz = tw * 0.5 + 0.1;
      const m = acc.vert(wx, 0.02, z, 0, 1, 0, col, CLS.SHADOW, 0.7, 0);
      const o = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        o.push(acc.vert(wx + Math.cos(a) * lx, 0.02, z + Math.sin(a) * lz, 0, 1, 0, col, CLS.SHADOW, 0, 0));
      }
      for (let k = 0; k < 6; k++) acc.tri(m, o[(k + 1) % 6], o[k]);
    }
  }
}

// Join the head and tail lamp builders into one lamp geometry: the front
// half of the atlas and strip for the head lamps, the rear half for the
// tail (u halved / offset), and two relative morph targets that push the
// head lamps back and the tail lamps forward with front / rear crumple.
function joinLamps(head, tail) {
  const acc = new Acc();
  const add = (src, off) => {
    const base = acc.count;
    for (let i = 0; i < src.count; i++) {
      acc.vert(src.p[i * 3], src.p[i * 3 + 1], src.p[i * 3 + 2], src.n[i * 3], src.n[i * 3 + 1], src.n[i * 3 + 2],
        [src.c[i * 3], src.c[i * 3 + 1], src.c[i * 3 + 2]], src.k[i], off + src.uv[i * 2] * 0.5, src.uv[i * 2 + 1]);
    }
    for (const j of src.i) acc.i.push(base + j);
    return acc.count - base;
  };
  const nh = head ? add(head, 0) : 0;
  const nt = tail ? add(tail, 0.5) : 0;
  if (!acc.count) return null;
  const g = acc.build();
  const n = acc.count;
  const dF = new Float32Array(n * 3), dR = new Float32Array(n * 3);
  for (let i = 0; i < nh; i++) dF[i * 3] = -0.9;
  for (let i = nh; i < nh + nt; i++) dR[i * 3] = 0.9;
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(dF, 3), new THREE.Float32BufferAttribute(dR, 3)];
  g.morphTargetsRelative = true;
  return g;
}

// ---- main builder ------------------------------------------------------------
// buildCar(spec, near, lite):
//   near (default): { body, glass, lamps } of the near model;
//   lite (mid distance): { body (opaque glass), glass (contact shadow
//   only), lamps (light) };
//   near = false (far): { body } with baked lamp blocks and tyres.
export function buildCar(spec, near = true, lite = false) {
  const lod = !near ? LOD_FAR : lite ? LOD_MID : LOD_NEAR;
  const sh = shape(spec);
  const S = sh.S;
  const L = sh.L, hw = sh.hw;
  const acc = new Acc();
  const glassAcc = lod !== LOD_FAR ? new Acc() : null;
  const headAcc = lod !== LOD_FAR ? new Acc() : null;
  const tailAcc = lod !== LOD_FAR ? new Acc() : null;
  const id = spec.id;
  const paint = lin(WHITE);
  const nearM = lod === LOD_NEAR;

  // Contact shadow first, so the glass draws over it.
  if (glassAcc) contactShadow(glassAcc, sh, spec, nearM);

  const gs = ghShape(sh);
  // Lower shell.
  const cuts = nearM && S.belt ? new Map() : null;
  const xs = lowerStations(sh, lod, cuts);
  const P = xs.map((x) => mirror(lowerHalf(sh, x, lod, cuts ? cuts.get(Math.round(x * 1e4)) || 0 : 0), x));
  if (S.lean) {
    for (const ring of P) {
      for (const p of ring) {
        const d = sh.lean(p[0], p[1]);
        p[0] += p[0] > sh.mid ? -d : d;
      }
    }
  }
  const J = (P[0].length + 1) / 2;
  const nSide = sideOf(sh, lod).length - 1; // bands 0..nSide-1 are the side
  const seamAt = (x) => {
    for (const s of S.seams || []) if (x > s * L && x < s * L + 0.012) return true;
    return false;
  };
  const hoodSeam = (x) => (S.hood != null && x > S.hood * L && x < S.hood * L + 0.012) || (S.boot != null && x < S.boot * L && x > S.boot * L - 0.012);
  const bedGap = (x) => sh.bed && ((x > sh.bed[0] - 0.007 && x < sh.bed[0] + 0.001) || (x > sh.bed[1] - 0.001 && x < sh.bed[1] + 0.007));
  const out = { col: paint, cls: CLS.PAINT };
  const pick = (col, cls) => {
    out.col = lin(col);
    out.cls = cls;
    return out;
  };
  const front = (n, x) => n[0] > 0.55 && x > sh.mid;
  const rear = (n, x) => n[0] < -0.55 && x < sh.mid;
  const inCabin = (x, az) => x > gs.xC + 0.02 && x < gs.xA - 0.02 && az < gs.baseW(x) - 0.015;
  emitGrid(acc, P, (i, r, c, n) => {
    const jj = bandOf(r, J);
    const x = c[0], az = Math.abs(c[2]);
    out.col = paint;
    out.cls = CLS.PAINT;
    if (lod === LOD_FAR) {
      if (jj === 0 && Math.abs(n[1]) < 0.7 && c[1] < sh.bottom(x) + 0.08) return pick(TRIM, CLS.TRIM);
      if (front(n, x) && jj === 1 && az < hw * 0.55) return pick(GRILLE, CLS.TRIM);
      if (front(n, x) && jj === 2 && az > hw * 0.45) return pick(0xdfe6ee, CLS.GLOW);
      if (rear(n, x) && jj === 2 && az > hw * 0.4) return pick(0xc01414, CLS.GLOW);
      return out;
    }
    if (lod === LOD_MID) {
      if (jj === 0) return pick(TRIM, CLS.TRIM);
      if (front(n, x) && jj <= 2 && az < hw * 0.5 && c[1] < sh.yc(x) - 0.05) return pick(GRILLE, CLS.TRIM);
      if (S.skirt && jj === 1 && Math.abs(n[2]) > 0.3) return pick(TRIM, CLS.TRIM);
      if (id === 'police' && jj >= 1 && jj <= 2 && Math.abs(n[2]) > 0.3 && x > -0.205 * L && x < 0.205 * L) return pick(0xf4f4f2, CLS.LIVERY);
      return out;
    }
    if (sh.inBed(x) || bedGap(x)) {
      if (jj >= nSide + 2) return pick(LINER, CLS.TRIM);
    }
    if (jj < nSide + 1 && seamAt(x) && c[1] > sh.bottom(x) + 0.02) return pick(SEAM, CLS.TRIM);
    if (jj >= nSide + 1 && hoodSeam(x)) return pick(SEAM, CLS.TRIM);
    // The floor of the cabin (the shell's top inside the greenhouse).
    if (S.belt && jj >= nSide + 1 && n[1] > 0.3 && inCabin(x, az)) return pick(FLOOR, CLS.CABIN);
    // Dark lower sill and bumper lip all round.
    if (jj === 0) return pick(TRIM, CLS.TRIM);
    // The end walls of each wheel arch read as dark wheel-well liner.
    if (jj < nSide && Math.abs(n[0]) > 0.5 && c[1] < sh.wr + 0.12) {
      for (const wx of sh.wheels) if (Math.abs(Math.abs(x - wx) - sh.R) < 0.012) return pick(ARCH, CLS.TRIM);
    }
    if (S.skirt && jj === 1 && Math.abs(n[2]) > 0.3) return pick(TRIM, CLS.TRIM);
    if (id === 'police' && jj >= 2 && jj <= 5 && Math.abs(n[2]) > 0.3 && x > -0.205 * L && x < 0.205 * L) return pick(0xf4f4f2, CLS.LIVERY);
    if (id === 'taxi' && jj === 3 && Math.abs(n[2]) > 0.3 && x > -0.205 * L && x < 0.205 * L) return pick(0x161616, CLS.LIVERY);
    return out;
  });
  out.u = 0;
  out.v = 0;
  const T = globalThis.__rwT;
  if (T) T.lower = acc.triangles;

  // Greenhouse.
  const gx = ghStations(sh, gs, lod);
  const G = gx.map((x) => mirror(ghHalf(sh, gs, x, lod), x));
  const GJ = (G[0].length + 1) / 2;
  const g = S.gh;
  const inSpan = (x, s) => s && x > s[0] * L && x < s[1] * L;
  const sideLo = nearM ? 1 : 0, sideHi = nearM ? 2 : 0, railB = nearM ? 3 : 1;
  const isGlass = (x, jj) => {
    if (jj >= sideLo && jj <= sideHi) return !inSpan(x, g.b) && (inSpan(x, g.side) || inSpan(x, g.rearSide));
    if (jj > railB) return x > gs.xR1 + 0.005 || (x < gs.xR0 - 0.005 && g.rear);
    return false;
  };
  const tint = { col: lin(TINT), cls: CLS.GLASS };
  emitGrid(acc, G, (i, r, c) => {
    const jj = bandOf(r, GJ);
    const x = c[0];
    out.col = paint;
    out.cls = CLS.PAINT;
    if (nearM && jj === 0) return pick(TRIM, CLS.TRIM);
    if (isGlass(x, jj)) return glassAcc && nearM ? null : pick(GLASS, CLS.GLASS);
    if (jj >= sideLo && jj <= sideHi && inSpan(x, g.b)) return pick(TRIM, CLS.TRIM);
    return out;
  });
  if (T) T.gh = acc.triangles;
  if (nearM) {
    emitGrid(glassAcc, G, (i, r, c) => (isGlass(c[0], bandOf(r, GJ)) ? tint : null));
    if (S.belt) {
      // The headliner uses the mid-distance greenhouse grid (it is only
      // seen dimly through the glass).
      const Gm = ghStations(sh, gs, LOD_MID).map((x) => mirror(ghHalf(sh, gs, x, LOD_MID), x));
      const GmJ = (Gm[0].length + 1) / 2;
      headliner(acc, Gm, (x, jj) => (jj === 0 ? !inSpan(x, g.b) && (inSpan(x, g.side) || inSpan(x, g.rearSide)) : jj > 1 && (x > gs.xR1 + 0.005 || (x < gs.xR0 - 0.005 && g.rear))), GmJ);
      cabin(acc, sh, gs, spec);
    }
  }

  if (T) T.cabin = acc.triangles;
  if (lod !== LOD_FAR) {
    archLiners(acc, sh, nearM ? 8 : 4);
    if (nearM) archLips(acc, sh);
    if (T) T.arch = acc.triangles;
    underside(acc, sh, xs);
    fascia(acc, headAcc, tailAcc, sh, spec, lod);
    if (T) T.fascia = acc.triangles;
    details(acc, headAcc, tailAcc, sh, gs, spec, lod);
    if (T) T.details = acc.triangles;
  } else {
    farDetails(acc, sh, spec);
  }

  const res = { body: acc.build(), shape: sh, gh: gs };
  if (lod !== LOD_FAR) {
    res.glass = glassAcc.build();
    res.lamps = joinLamps(headAcc.count ? headAcc : null, tailAcc.count ? tailAcc : null);
  }
  return res;
}

function details(acc, headAcc, tailAcc, sh, gs, spec, lod) {
  const S = sh.S;
  const L = sh.L;
  const id = spec.id;
  const near = lod === LOD_NEAR;
  // Brake calipers at the top of each disc, seen through the spokes. They
  // live in the body so they do not spin; at the top of the disc they
  // stay put when the front wheels steer.
  if (near) {
    const { wr, tw, ax, az } = wheelLayout(spec);
    const rimR = wr * RIM;
    const hex = id === 'ghostwake' ? 0x17e0cb : id === 'sports' ? 0xc81e28 : id === 'muscle' ? 0xd88a18 : id === 'police' ? 0x2a2c30 : id === 'sedan' ? 0x9a1c22 : 0x55585e;
    for (const wx of [ax, -ax]) {
      for (const s of [1, -1]) {
        const a = Math.PI * 0.62;
        const r = rimR * 0.68;
        box(acc, hex, CLS.TRIM, rimR * 0.42, rimR * 0.22, tw * 0.2, wx + Math.cos(a) * r, wr + Math.sin(a) * r, s * (az + tw * 0.08), 0, 0, a - Math.PI / 2);
      }
    }
  }
  // Mirrors at the base of the A pillar.
  if (!S.range) {
    const mx = gs.xA - 0.16;
    for (const s of [1, -1]) {
      const w = gs.baseW(mx) + 0.04;
      const y = gs.baseY(mx) + 0.1;
      if (near) {
        box(acc, TRIM, CLS.TRIM, 0.08, 0.04, 0.12, mx + 0.03, y - 0.03, (w + 0.02) * s);
        blob(acc, WHITE, CLS.PAINT, 0.15, 0.1, 0.21, mx, y, (w + 0.11) * s, 7);
        box(acc, CHROME, CLS.CHROME, 0.01, 0.075, 0.16, mx - 0.075, y, (w + 0.115) * s);
      } else {
        box(acc, WHITE, CLS.PAINT, 0.12, 0.1, 0.2, mx, y, (w + 0.1) * s);
      }
    }
  }
  if (!near) {
    // Mid distance: only what changes the outline.
    if (id === 'taxi') box(acc, 0xf2e8b0, CLS.GLOW, 0.5, 0.17, 0.26, -0.08 * L, gs.roofY + gs.crown + 0.12, 0);
    if (S.wing) {
      const x = sh.x0 + 0.2, y = sh.top(x) + 0.17;
      box(acc, TRIM, CLS.TRIM, 0.3, 0.035, sh.W * 0.92, x, y, 0, 0, 0, 0.12);
      for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 0.08, 0.17, 0.03, x + 0.04, y - 0.085, s * sh.hw * 0.62);
    }
    if (S.pushBar) box(acc, TRIM, CLS.TRIM, 0.06, 0.4, 0.86, sh.x1 + 0.1, 0.5, 0);
    if (S.fins) {
      for (const s of [1, -1]) {
        const x = sh.x0 + 0.45;
        acc.geo(new THREE.CylinderGeometry(0.02, 0.09, 0.5, 3, 1), WHITE, CLS.PAINT, place(x, sh.top(x) + 0.1, s * sh.planW(x) * 0.62, 0, Math.PI / 4, 1.15, 1, 1, 0.35));
      }
    }
    if (S.humps) box(acc, WHITE, CLS.PAINT, 0.8, 0.14, 0.9, gs.xC - 0.35, sh.top(gs.xC - 0.35) + 0.02, 0);
    if (S.rack) box(acc, TRIM, CLS.TRIM, gs.xR1 - gs.xR0 - 0.2, 0.06, gs.baseW(0) * 1.6, (gs.xR0 + gs.xR1) / 2, gs.roofY + gs.crown + 0.07, 0);
    if (S.spare) {
      const { wr, tw } = wheelLayout(spec);
      acc.geo(new THREE.CylinderGeometry(wr * 0.95, wr * 0.95, tw * 0.9, 8, 1), 0x161617, CLS.RUBBER, place(sh.x0 + sh.lean(sh.x0 + 0.05, 1.0) - tw * 0.5, sh.yc(sh.x0 + 0.2) - 0.05, 0, 0, 0, Math.PI / 2));
    }
    if (id === 'van') box(acc, TRIM, CLS.TRIM, 2.6, 0.08, sh.hw * 1.45, -0.12 * L, gs.roofY + gs.crown + 0.07, 0);
    if (id === 'truck') truckParts(acc, tailAcc, sh, spec, false);
    return;
  }
  // Door handles: flush dark pulls with a chrome top.
  for (const s of S.seams || []) {
    const x = s * L - 0.12;
    if (x < sh.x0 + 0.4 || x > sh.x1 - 0.6) continue;
    for (const side of [1, -1]) {
      const y = sh.yc(x) - 0.07;
      const w = halfWidthAt(sh, x, y);
      box(acc, CHROME, CLS.CHROME, 0.14, 0.022, 0.016, x, y, ((w > 0 ? w : sh.planW(x)) + 0.002) * side);
    }
  }
  // Wipers at the windscreen base.
  if (!S.range || id === 'truck') {
    const wx = gs.xA - 0.06;
    const y = gs.baseY(wx) + 0.05;
    for (const s of [0.18, -0.32]) box(acc, SEAM, CLS.TRIM, 0.02, 0.015, sh.hw * 0.55, wx, y, s * sh.hw * 0.9, 0, 0.12, 0);
  }
  // Exhaust tips.
  if (S.exhaust) {
    const y = sh.bottom(sh.x0 + 0.3) + (S.belt ? 0.07 : 0.04);
    const x = sh.x0 + sh.lean(sh.x0 + 0.05, y) + (S.belt ? 0.06 : 0.02);
    const zs = S.exhaust.n === 2 ? [S.exhaust.z, -S.exhaust.z] : [-S.exhaust.z];
    for (const zf of zs) {
      const z = zf * sh.hw * 2;
      for (const dz of id === 'sports' || id === 'ghostwake' ? [-0.055, 0.055] : [0]) {
        cylX(acc, CHROME, CLS.CHROME, 0.04, 0.14, x, y, z + dz, 10, true);
        cylX(acc, 0x050505, CLS.TRIM, 0.033, 0.02, x + 0.02, y, z + dz, 10);
      }
    }
  }
  // Style extras.
  if (S.wing) {
    const x = sh.x0 + 0.2;
    const y = sh.top(x) + 0.17;
    box(acc, TRIM, CLS.TRIM, 0.3, 0.035, sh.W * 0.92, x, y, 0, 0, 0, 0.12);
    for (const s of [1, -1]) {
      box(acc, TRIM, CLS.TRIM, 0.08, 0.17, 0.03, x + 0.04, y - 0.085, s * sh.hw * 0.62);
      box(acc, TRIM, CLS.TRIM, 0.32, 0.12, 0.012, x, y + 0.02, s * sh.W * 0.46);
    }
  }
  if (S.ducktail) {
    const x = sh.x0 + 0.1;
    box(acc, WHITE, CLS.PAINT, 0.12, 0.045, sh.W * 0.86, x, sh.top(x) + 0.015, 0, 0, 0, 0.25);
  }
  if (id === 'ghostwake') {
    // The black half of the teal-and-black livery: two stripes down the
    // bonnet and the boot, a black roof, in short flat pieces that follow the curve.
    const stripe = (xa, xb, top) => {
      for (let x = xa; x < xb; x += 0.28) {
        const y = top(x + 0.14) + 0.004;
        const dy = top(x + 0.28) - top(x);
        for (const s of [1, -1]) box(acc, 0x0b0d0e, CLS.TRIM, 0.3, 0.012, 0.15, x + 0.14, y, s * 0.11, 0, 0, Math.atan2(dy, 0.28));
      }
    };
    stripe(gs.xA + 0.05, sh.x1 - 0.3, sh.top);
    stripe(sh.x0 + 0.1, gs.xR0 - 0.15, sh.top);
    box(acc, 0x0b0d0e, CLS.TRIM, Math.max(0.4, gs.xR1 - gs.xR0), 0.012, gs.baseW(gs.xR0) * 1.5, (gs.xR0 + gs.xR1) / 2, gs.roofY + gs.crown * 0.8 + 0.006, 0);
  }
  if (S.roofSpoiler) {
    const x = gs.xR0 - 0.02;
    const rw = gs.baseW(x) - S.gh.tumble * (gs.roofY - gs.baseY(x));
    box(acc, WHITE, CLS.PAINT, 0.24, 0.035, rw * 1.9, x - 0.04, gs.roofY + gs.crown * 0.5, 0, 0, 0, 0.1);
  }
  if (S.scoop) {
    const x = 0.27 * L;
    const y = sh.top(x);
    acc.geo(new THREE.BoxGeometry(0.7, 0.09, 0.62), WHITE, CLS.PAINT, place(x, y + 0.02, 0, 0, 0, -0.03));
    box(acc, GRILLE, CLS.TRIM, 0.02, 0.06, 0.5, x + 0.352, y + 0.03, 0);
  }
  if (S.lip || S.wingLip) {
    // A thin lip spoiler on the boot edge and a shark-fin aerial.
    const x0 = sh.x0 + 0.09;
    const x = x0 + sh.lean(x0, sh.top(x0));
    box(acc, WHITE, CLS.PAINT, 0.1, 0.022, sh.planW(x0) * 1.5, x, sh.top(x0) + 0.008, 0, 0, 0, 0.18);
  }
  if (S.belt) {
    const x = gs.xR0 + 0.06;
    acc.geo(new THREE.ConeGeometry(0.035, 0.07, 4, 1), TRIM, CLS.TRIM, place(x, gs.roofY + gs.crown + 0.03, 0, 0, Math.PI / 4, 0.45, 1.6, 1, 0.5));
  }
  if (S.pushBar) {
    // Push bar ahead of the nose: two uprights, two rails, rubber pads.
    const x = sh.x1 + 0.1;
    for (const zz of [0.32, -0.32]) box(acc, TRIM, CLS.TRIM, 0.06, 0.5, 0.07, x, 0.5, zz);
    for (const yy of [0.34, 0.66]) box(acc, TRIM, CLS.TRIM, 0.05, 0.07, 0.86, x + 0.01, yy, 0);
    for (const zz of [0.32, -0.32]) box(acc, TRIM, CLS.TRIM, 0.16, 0.05, 0.05, x - 0.09, 0.42, zz);
    // A spotlight at the driver's A pillar.
    blob(acc, CHROME, CLS.CHROME, 0.12, 0.1, 0.1, gs.xA - 0.1, gs.baseY(gs.xA - 0.1) + 0.14, -(gs.baseW(gs.xA - 0.1) + 0.08), 6);
  }
  if (S.fins) {
    // Two tail fins rising from the rear haunches.
    for (const s of [1, -1]) {
      const x = sh.x0 + 0.45;
      const z = s * sh.planW(x) * 0.62;
      acc.geo(new THREE.CylinderGeometry(0.02, 0.09, 0.5, 4, 1), WHITE, CLS.PAINT, place(x, sh.top(x) + 0.1, z, 0, Math.PI / 4, 1.15, 1, 1, 0.35));
    }
  }
  if (S.humps) {
    // Speedster humps behind the seats, faired into the deck.
    for (const s of [1, -1]) {
      const x = gs.xC - 0.35;
      blob(acc, WHITE, CLS.PAINT, 0.9, 0.22, 0.42, x, sh.top(x) - 0.03, s * 0.38, 8);
    }
  }
  if (S.rack) {
    // Roof rack rails and bars.
    const y = gs.roofY + gs.crown + 0.06;
    const x0 = gs.xR0 + 0.1, x1 = gs.xR1 - 0.1;
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, x1 - x0, 0.04, 0.05, (x0 + x1) / 2, y, s * gs.baseW(0) * 0.78);
    for (let k = 0; k < 4; k++) box(acc, TRIM, CLS.TRIM, 0.05, 0.035, gs.baseW(0) * 1.6, x0 + ((x1 - x0) * (k + 0.5)) / 4, y + 0.02, 0);
  }
  if (S.spare) {
    // Spare wheel on the tailgate.
    const { wr, tw } = wheelLayout(spec);
    const x = sh.x0 + sh.lean(sh.x0 + 0.05, 1.0) - tw * 0.5;
    acc.geo(new THREE.CylinderGeometry(wr * 0.95, wr * 0.95, tw * 0.9, 12, 1), 0x161617, CLS.RUBBER, place(x, sh.yc(sh.x0 + 0.2) - 0.05, 0, 0, 0, Math.PI / 2));
    acc.geo(new THREE.CircleGeometry(wr * 0.6, 10), 0x4a4d52, CLS.ALLOY, place(x - tw * 0.46, sh.yc(sh.x0 + 0.2) - 0.05, 0, 0, -Math.PI / 2, 0));
  }
  if (id === 'pickup') {
    // Roll bar behind the cab and a tailgate handle.
    const bx = sh.bed[1] - 0.12;
    const top = sh.top(bx);
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 0.07, 0.36, 0.07, bx, top + 0.18, s * (sh.hw - 0.12));
    box(acc, TRIM, CLS.TRIM, 0.07, 0.07, sh.W - 0.2, bx, top + 0.36, 0);
    box(acc, TRIM, CLS.TRIM, 0.015, 0.05, 0.26, sh.x0 - 0.002, sh.top(sh.x0) - 0.12, 0);
    // Step bars.
    for (const s of [1, -1]) box(acc, CHROME, CLS.CHROME, 1.3, 0.05, 0.1, 0.02 * L, sh.bottom(0) - 0.05, s * (sh.hw - 0.02));
  }
  if (id === 'van') {
    // Sliding-door rail and a roof rack.
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 2.0, 0.03, 0.02, -0.06 * L, gs.baseY(-0.06 * L) + 0.02, (gs.baseW(-0.06 * L) + 0.01) * s);
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 2.6, 0.04, 0.05, -0.12 * L, gs.roofY + gs.crown + 0.05, s * sh.hw * 0.7);
    for (const xx of [-0.35, -0.12, 0.1]) box(acc, TRIM, CLS.TRIM, 0.05, 0.04, sh.hw * 1.45, xx * L, gs.roofY + gs.crown + 0.08, 0);
  }
  if (id === 'taxi') {
    const x = -0.08 * L;
    const y = gs.roofY + gs.crown;
    box(acc, TRIM, CLS.TRIM, 0.56, 0.04, 0.3, x, y + 0.02, 0);
    // The lit sign itself lives in the head-lamp mesh (cell 2) so it glows.
    headAcc.geo(new THREE.BoxGeometry(0.5, 0.17, 0.26), WHITE, 0, place(x, y + 0.12, 0), (2 + 0.5) / 8, 0.5);
  }
  if (id === 'truck') truckParts(acc, tailAcc, sh, spec, true);
}

function truckParts(acc, tailAcc, sh, spec, near) {
  const L = sh.L, W = sh.W, H = sh.H;
  const xb0 = -L / 2, xb1 = sh.x0 - 0.12;
  const y0 = 1.08, y1 = H;
  const len = xb1 - xb0;
  const bw = W * 0.995;
  // Cargo box: slightly bevelled panels, corner posts, rib seams, doors.
  box(acc, 0xe9e8e2, CLS.LIVERY, len, y1 - y0, bw, xb0 + len / 2, (y0 + y1) / 2, 0);
  // Chassis rails, rear bumper, mudguards over the rear wheels.
  for (const s of [1, -1]) box(acc, 0x1a1a1a, CLS.TRIM, L * 0.9, 0.26, 0.12, -0.02 * L, 0.78, s * 0.45);
  box(acc, 0x1a1a1a, CLS.TRIM, 0.14, 0.18, W * 0.96, xb0 + 0.12, 0.55, 0);
  const ax = spec.wheelBase / 2;
  const { wr, tw, az } = wheelLayout(spec);
  for (const s of [1, -1]) box(acc, 0x141414, CLS.TRIM, wr * 2.6, 0.05, tw + 0.16, -ax, wr * 2 + 0.08, s * az);
  // Cab roof deflector.
  const cx = sh.x0 + 0.5;
  acc.geo(new THREE.BoxGeometry(1.0, 0.3, W * 0.86), WHITE, CLS.PAINT, place(cx + 0.2, H * 0.88 + 0.12, 0, 0, 0, 0.18));
  if (!near) return;
  for (const s of [1, -1]) {
    for (let i = 0; i <= 8; i++) {
      const x = xb0 + 0.05 + (len - 0.1) * (i / 8);
      box(acc, 0xbdbcb6, CLS.TRIM, 0.05, y1 - y0 - 0.04, 0.012, x, (y0 + y1) / 2, s * (bw / 2 + 0.004));
    }
    box(acc, 0x9a9a96, CLS.CHROME, len, 0.08, 0.02, xb0 + len / 2, y0 + 0.04, s * (bw / 2 + 0.006));
    box(acc, 0x9a9a96, CLS.CHROME, len, 0.06, 0.02, xb0 + len / 2, y1 - 0.03, s * (bw / 2 + 0.006));
  }
  // Rear doors with hinges and a lamp bar.
  box(acc, 0xd5d4ce, CLS.LIVERY, 0.02, y1 - y0 - 0.1, bw - 0.12, xb0 - 0.01, (y0 + y1) / 2, 0);
  box(acc, SEAM, CLS.TRIM, 0.025, y1 - y0 - 0.1, 0.02, xb0 - 0.012, (y0 + y1) / 2, 0);
  for (const s of [1, -1]) {
    box(acc, CHROME, CLS.CHROME, 0.03, 1.5, 0.04, xb0 - 0.03, (y0 + y1) / 2, s * 0.18);
    for (const yy of [y0 + 0.35, y1 - 0.35]) box(acc, TRIM, CLS.TRIM, 0.03, 0.06, 0.14, xb0 - 0.02, yy, s * (bw / 2 - 0.1));
  }
  for (const s of [1, -1]) {
    box(acc, 0x141414, CLS.TRIM, 0.03, 0.4, tw + 0.1, -ax - wr * 1.25, wr * 1.6, s * az);
    // Fuel tank and side guard.
    cylX(acc, 0xb8bcc2, CLS.CHROME, 0.26, 1.1, 0.4, 0.62, s * (W / 2 - 0.42), 12);
    box(acc, 0x2a2a2a, CLS.TRIM, 1.8, 0.06, 0.04, -0.8, 0.55, s * (W / 2 - 0.08));
  }
  // Sun visor.
  box(acc, TRIM, CLS.TRIM, 0.22, 0.05, W * 0.84, sh.x1 - 0.1, H * 0.88 - 0.04, 0, 0, 0, -0.15);
  for (const s of [1, -1]) {
    // Big truck mirrors on arms.
    const mx = sh.x1 - 0.35, my = 2.1;
    box(acc, TRIM, CLS.TRIM, 0.04, 0.04, 0.32, mx, my, s * (W / 2 + 0.12));
    box(acc, TRIM, CLS.TRIM, 0.07, 0.42, 0.18, mx - 0.02, my - 0.05, s * (W / 2 + 0.3));
    box(acc, CHROME, CLS.CHROME, 0.01, 0.38, 0.15, mx - 0.06, my - 0.05, s * (W / 2 + 0.3));
    // Step below the door.
    box(acc, 0x2a2a2a, CLS.TRIM, 0.5, 0.04, 0.22, sh.x1 - 0.85, 0.62, s * (W / 2 - 0.08));
  }
  // Rear lamps on the bumper ends (tail mesh: red, reverse, indicator).
  for (const s of [1, -1]) {
    const z = s * (W / 2 - 0.22);
    tailAcc.geo(new THREE.BoxGeometry(0.04, 0.12, 0.2), WHITE, 0, place(xb0 + 0.04, 0.55, z), (s > 0 ? 3.5 : 0.5) / 8, 0.5);
    tailAcc.geo(new THREE.BoxGeometry(0.04, 0.1, 0.1), WHITE, 0, place(xb0 + 0.04, 0.55, z - s * 0.17), 1.5 / 8, 0.5);
    tailAcc.geo(new THREE.BoxGeometry(0.04, 0.1, 0.1), WHITE, 0, place(xb0 + 0.04, 0.55, z + s * 0.16), 2.5 / 8, 0.5);
    // Clearance lamps on the box top corners.
    tailAcc.geo(new THREE.BoxGeometry(0.03, 0.06, 0.08), WHITE, 0, place(xb0 - 0.02, H - 0.08, s * (W / 2 - 0.08)), 0.5 / 8, 0.5);
  }
}

function farDetails(acc, sh, spec) {
  const { wr, tw, ax, az } = wheelLayout(spec);
  // Simple tyres with a grey rim face.
  for (const wx of [ax, -ax]) {
    for (const s of [1, -1]) {
      acc.geo(new THREE.CylinderGeometry(wr, wr, tw, 10, 1, false), 0x151516, CLS.RUBBER, place(wx, wr, s * az, Math.PI / 2, 0, 0));
      acc.geo(new THREE.CircleGeometry(wr * RIM, 8), 0x9a9ea4, CLS.ALLOY, place(wx, wr, s * (az + tw / 2 + 0.003), 0, s > 0 ? 0 : Math.PI, 0));
    }
  }
  // Tail lamp blocks (glow at night through the shared lamp uniform).
  if (spec.body !== 'truck') {
    const x = sh.x0 + 0.03;
    const y = sh.yc(sh.x0 + 0.1) - 0.06;
    for (const s of [1, -1]) box(acc, 0xd01818, CLS.GLOW, 0.06, 0.1, sh.W * 0.22, x, y, s * sh.hw * 0.66);
  } else {
    box(acc, 0xe9e8e2, CLS.LIVERY, sh.L / 2 + sh.x0 - 0.12, sh.H - 1.08, sh.W, (-sh.L / 2 + sh.x0 - 0.12) / 2, (sh.H + 1.08) / 2, 0);
  }
  if (spec.id === 'taxi') box(acc, 0xf2e8b0, CLS.GLOW, 0.5, 0.17, 0.26, -0.08 * sh.L, sh.H + 0.1, 0);
}

// ---- wheels -----------------------------------------------------------------------
const RIM = 0.72; // rim radius / tyre radius

// Wheel look per spec: spoke count, spoke style and rim colour.
export function wheelStyle(spec) {
  const id = spec.id;
  if (spec.body === 'truck') return { spokes: 10, kind: 'steel', rim: 0xb4b8be };
  if (id === 'sports') return { spokes: 10, kind: 'thin', rim: 0x34373c };
  if (id === 'ghostwake') return { spokes: 10, kind: 'thin', rim: 0x1b2a2c };
  if (id === 'muscle') return { spokes: 5, kind: 'wide', rim: 0xd6d8dc };
  if (id === 'compact') return { spokes: 8, kind: 'thin', rim: 0xc6cad0 };
  if (id === 'pickup') return { spokes: 6, kind: 'wide', rim: 0x4a4d52 };
  if (id === 'van') return { spokes: 7, kind: 'plain', rim: 0xa9adb2 };
  if (id === 'police') return { spokes: 7, kind: 'plain', rim: 0x8e9298 };
  if (id === 'taxi') return { spokes: 6, kind: 'plain', rim: 0xb9bdc3 };
  return { spokes: 5, kind: 'twin', rim: 0xc9cdd2 };
}

// Tyre half profile [[radius, z], ...] from the inner bead round the
// tread to the outer bead: bulging sidewalls and rounded shoulders.
export function tyreProfile(wr, tw) {
  const h = tw / 2, rb = wr * RIM;
  return [[rb * 0.99, -h * 0.86], [wr * 0.9, -h * 1.0], [wr * 0.985, -h * 0.74], [wr, -h * 0.32],
    [wr, h * 0.32], [wr * 0.985, h * 0.74], [wr * 0.9, h * 1.0], [rb * 0.99, h * 0.86]];
}

// Tyre (tread blocks alternate shade so spin is visible), alloy rim with
// concave spokes over a brake disc that shows through them. Axle along
// local z; the outer face looks toward +z. lite: a plain tyre and rim
// face for the mid distance.
export function buildWheel(wr, tw, spokes = 5, rimHex = 0xc9cdd2, kind = 'plain', lite = false) {
  const acc = new Acc();
  const rimR = wr * RIM;
  const h = tw / 2;
  const rimC = lin(rimHex);
  if (lite) {
    const o = { col: lin(0x161617), cls: CLS.RUBBER };
    lathe(acc, [[rimR, -h * 0.9], [wr, -h * 0.7], [wr, h * 0.7], [rimR * 1.02, h * 0.96]], 8, () => o, { crease: 0.5 });
    // Rim face: a dished disc with a darker centre.
    const rc = { col: rimC, cls: CLS.ALLOY };
    lathe(acc, [[rimR * 1.02, h * 0.96], [rimR * 0.55, h * 0.8], [0.001, h * 0.9]], 8, (i, r) => (r === 1 && i % 2 ? { col: lin(0x2a2b2e), cls: CLS.ALLOY } : rc), { crease: 0.2 });
    return acc.build();
  }
  const seg = 16;
  const tread = [lin(0x1e1e1f), lin(0x0d0d0e)];
  const wall = lin(0x1b1b1d), wallHi = lin(0x2c2c2e);
  const o = { col: wall, cls: CLS.RUBBER };
  lathe(acc, tyreProfile(wr, tw), seg, (i, r) => {
    if (r === 3) o.col = tread[i % 2];
    else if (r === 2 || r === 4) o.col = tread[(i + 1) % 2];
    else o.col = r === 5 && i % 6 < 3 ? wallHi : wall;
    return o;
  }, { crease: 0.5 });
  const dark = lin(0x1a1b1d), disc = lin(0x8a8d92), hat = lin(0x4a4c50);
  const rc = { col: rimC, cls: CLS.ALLOY };
  // Polished outer lip, then the dark barrel and back wall.
  lathe(acc, [[rimR * 1.03, h * 0.84], [rimR * 1.0, h * 0.97], [rimR * 0.92, h * 0.93]], seg, () => rc, { crease: 0.4 });
  lathe(acc, [[rimR * 0.92, h * 0.93], [rimR * 0.9, -h * 0.7], [rimR * 0.3, -h * 0.7]], 10, () => ({ col: dark, cls: CLS.ALLOY }), { crease: 0.4 });
  // Brake disc set well back from the spoke face, with a darker hat.
  lathe(acc, [[rimR * 0.8, -h * 0.25], [rimR * 0.8, h * 0.02], [rimR * 0.42, h * 0.02], [rimR * 0.3, h * 0.12]], 10, (i, r) => ({ col: r === 2 ? hat : disc, cls: CLS.ALLOY }), { crease: 0.4 });
  // Spokes: tapered bars, concave from the lip down to a recessed hub.
  const rh = rimR * 0.22;
  const wide = kind === 'wide' ? 0.3 : kind === 'thin' ? 0.12 : kind === 'steel' ? 0.2 : 0.17;
  const arms = kind === 'twin' ? 2 : 1;
  const sidesC = lin(0x8d9096);
  const sc = { col: sidesC, cls: CLS.ALLOY };
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2;
    for (let m = 0; m < arms; m++) {
      const off = arms === 2 ? (m ? 1 : -1) * 0.12 : 0;
      const P = [];
      for (const u of [0, 0.5, 1]) {
        const r = rh + (rimR * 0.93 - rh) * u;
        const a = a0 + off * u;
        const ca = Math.cos(a), sa = Math.sin(a);
        const half = rimR * wide * (1 - 0.3 * u) * (arms === 2 ? 0.55 : 1) * 0.5;
        const dish = kind === 'steel' ? 0.1 : 0.26;
        const zf = h * (0.95 - dish * (1 - u) * (1 - u * 0.4));
        const zb = zf - h * 0.24;
        const tx = -sa, ty = ca; // tangential
        const ring = [[half, zf], [-half, zf], [-half, zb], [half, zb], [half, zf]].map(([t, z]) => [ca * r + tx * t, sa * r + ty * t, z]);
        P.push(ring);
      }
      // Face (ring band 0) bright, sides a shade darker.
      emitOut(acc, P, (i, r) => (r === 0 ? rc : sc), (c) => [c[0] * 0.2, c[1] * 0.2, 1], { crease: 0.6 });
    }
  }
  if (kind === 'steel') {
    lathe(acc, [[rimR * 0.92, h * 0.78], [rimR * 0.5, h * 0.7]], 12, () => rc, { crease: 0.4 });
  }
  // Recessed hub with a dark cap and a bright ring.
  const hubZ = kind === 'steel' ? h * 0.9 : h * 0.72;
  lathe(acc, [[rh * 1.2, hubZ - 0.01], [rh * 1.05, hubZ + 0.012], [rh * 0.6, hubZ + 0.018], [0.001, hubZ + 0.02]], 8, (i, r) => (r === 2 ? { col: lin(0x2a2b2e), cls: CLS.CHROME } : rc), { crease: 0.5 });
  return acc.build();
}

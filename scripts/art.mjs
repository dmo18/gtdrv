// Original artwork for the app icon, feature graphic and splash, drawn as
// SVG strings. Used by scripts/make-icons.mjs. No external assets.

const SKY = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1226"/><stop offset="0.55" stop-color="#8a3a2c"/><stop offset="1" stop-color="#e2733a"/></linearGradient>`;
const SEA = `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a7c9e"/><stop offset="1" stop-color="#0f2f3f"/></linearGradient>`;

// The picture, drawn in a 512 x 512 box.
function scene({ mono = false } = {}) {
  if (mono) {
    return `<g fill="#fff">
  <path d="M156 248a100 100 0 0 1 200 0z"/>
  <path fill-rule="evenodd" transform="translate(0 6)" d="M120 372c-4-30 4-48 24-56l56-20c14-5 30-8 44-8h40c20 0 36 8 50 20l30 26c14 4 22 14 22 30v8H120z M214 296h40v38h-94z M274 296c10 0 20 5 28 12l22 26h-50z"/>
  <rect x="40" y="392" width="432" height="16" rx="8"/>
  </g>`;
  }
  return `
  <rect width="512" height="512" fill="url(#sky)"/>
  <circle cx="256" cy="300" r="128" fill="#f6b04a"/>
  <circle cx="256" cy="300" r="96" fill="#fbd27a"/>
  <rect y="300" width="512" height="212" fill="url(#sea)"/>
  <g fill="#f6b04a" opacity="0.75">
    <rect x="176" y="312" width="160" height="8" rx="4"/>
    <rect x="200" y="332" width="112" height="7" rx="3.5"/>
    <rect x="224" y="350" width="64" height="6" rx="3"/>
  </g>
  <path d="M0 392c60-26 120-26 180 0s120 26 180 0 100-18 152 0v120H0z" fill="#14110f"/>
  <g transform="translate(0 6)">
    <path d="M120 372c-4-30 4-48 24-56l56-20c14-5 30-8 44-8h40c20 0 36 8 50 20l30 26c14 4 22 14 22 30v8H120z" fill="#e2733a"/>
    <path d="M214 296h40v38h-94zM274 296c10 0 20 5 28 12l22 26h-50z" fill="#14110f" opacity="0.9"/>
    <rect x="120" y="360" width="296" height="10" fill="#14110f" opacity="0.35"/>
    <circle cx="184" cy="376" r="30" fill="#14110f"/><circle cx="184" cy="376" r="14" fill="#6b5a4c"/>
    <circle cx="360" cy="376" r="30" fill="#14110f"/><circle cx="360" cy="376" r="14" fill="#6b5a4c"/>
    <path d="M418 346l60-14v40l-60-8z" fill="#fbd27a" opacity="0.55"/>
  </g>`;
}

// Square icon. kind: 'any' (rounded, transparent corners), 'maskable'
// (full bleed, art kept inside the central safe zone), 'store' (full bleed
// square, art fills the frame) or 'mono' (white shape on transparent).
export function iconSvg(kind = 'any', size = 512) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><defs>${SKY}${SEA}<clipPath id="r"><rect width="512" height="512" rx="104"/></clipPath></defs>`;
  // Android adaptive icon layers: the system masks the central 72 of 108 dp.
  if (kind === 'adaptive') return `${head}<g transform="translate(256 256) scale(0.7) translate(-256 -256)">${scene()}</g></svg>`;
  if (kind === 'adaptive-mono') return `${head}<g transform="translate(256 256) scale(0.62) translate(-256 -270)">${scene({ mono: true })}</g></svg>`;
  if (kind === 'round') return `${head}<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#c)">${scene()}</g></svg>`;
  if (kind === 'mono') return `${head}<g transform="translate(256 256) scale(0.8) translate(-256 -270)">${scene({ mono: true })}</g></svg>`;
  if (kind === 'maskable') {
    // Safe zone is the inner 80 percent circle: shrink the art to 70 percent over a flat dusk fill.
    return `${head}<rect width="512" height="512" fill="#1b1226"/><g transform="translate(256 256) scale(0.7) translate(-256 -256)" clip-path="url(#r)">${scene()}</g></svg>`;
  }
  if (kind === 'store') return `${head}${scene()}</svg>`;
  return `${head}<g clip-path="url(#r)">${scene()}</g></svg>`;
}

// 1024 x 500 Play Store feature graphic.
export function featureSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500"><defs>${SKY}${SEA}</defs>
  <rect width="1024" height="500" fill="url(#sky)"/>
  <circle cx="760" cy="320" r="170" fill="#f6b04a"/><circle cx="760" cy="320" r="128" fill="#fbd27a"/>
  <rect y="320" width="1024" height="180" fill="url(#sea)"/>
  <g fill="#f6b04a" opacity="0.7"><rect x="640" y="334" width="240" height="9" rx="4.5"/><rect x="672" y="356" width="176" height="8" rx="4"/><rect x="704" y="378" width="112" height="7" rx="3.5"/></g>
  <path d="M0 420c120-40 240-40 360 0s240 40 360 0 220-30 304 0v80H0z" fill="#14110f"/>
  <g transform="translate(560 168) scale(0.8)">
    <path d="M120 372c-4-30 4-48 24-56l56-20c14-5 30-8 44-8h40c20 0 36 8 50 20l30 26c14 4 22 14 22 30v8H120z" fill="#e2733a"/>
    <path d="M214 296h40v38h-94zM274 296c10 0 20 5 28 12l22 26h-50z" fill="#14110f" opacity="0.9"/>
    <circle cx="184" cy="376" r="30" fill="#14110f"/><circle cx="184" cy="376" r="14" fill="#6b5a4c"/>
    <circle cx="360" cy="376" r="30" fill="#14110f"/><circle cx="360" cy="376" r="14" fill="#6b5a4c"/>
  </g>
  <text x="56" y="214" font-family="Impact, 'Arial Black', 'DejaVu Sans', sans-serif" font-weight="900" font-size="104" letter-spacing="6" fill="#f4efe6">RUSTWATER</text>
  <text x="60" y="270" font-family="'DejaVu Sans', Arial, sans-serif" font-size="30" fill="#fbd27a">An island of rust, salt and bad ideas.</text>
  <text x="60" y="318" font-family="'DejaVu Sans', Arial, sans-serif" font-size="22" fill="#f4efe6" opacity="0.9">Drive, sail and fly. Mature sandbox.</text>
</svg>`;
}

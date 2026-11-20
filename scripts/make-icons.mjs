// Draws the app icons and the feature graphic as PNG files.
// usage: node scripts/make-icons.mjs
// Outputs: public/icons/*.png, public/apple-touch-icon.png, store/icon-512.png,
// store/feature-graphic-1024x500.png. Uses headless Chromium (playwright)
// only as a rasteriser; nothing is fetched from the network.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { featureSvg, iconSvg } from './art.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await mkdir('public/icons', { recursive: true });
await mkdir('store', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();

async function png(svg, w, h, path) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
  await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

for (const s of [48, 72, 96, 144, 192, 256, 384, 512]) await png(iconSvg('any', s), s, s, `public/icons/icon-${s}.png`);
for (const s of [192, 512]) await png(iconSvg('maskable', s), s, s, `public/icons/maskable-${s}.png`);
await png(iconSvg('mono', 512), 512, 512, 'public/icons/monochrome-512.png');
await png(iconSvg('store', 180), 180, 180, 'public/apple-touch-icon.png');
await png(iconSvg('store', 512), 512, 512, 'store/icon-512.png');
await png(featureSvg(), 1024, 500, 'store/feature-graphic-1024x500.png');

// Android launcher icons for the Capacitor project (android/native).
const res = 'android/native/app/src/main/res';
const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, s] of Object.entries(legacy)) {
  await mkdir(`${res}/mipmap-${d}`, { recursive: true });
  await png(iconSvg('any', s), s, s, `${res}/mipmap-${d}/ic_launcher.png`);
  await png(iconSvg('round', s), s, s, `${res}/mipmap-${d}/ic_launcher_round.png`);
  const f = s * 2.25; // adaptive layers are 108 dp: 1.5 times the legacy 72 dp icon
  await png(iconSvg('adaptive', f), f, f, `${res}/mipmap-${d}/ic_launcher_foreground.png`);
  await png(iconSvg('adaptive-mono', f), f, f, `${res}/mipmap-${d}/ic_launcher_monochrome.png`);
}
await browser.close();
console.log('icons written');

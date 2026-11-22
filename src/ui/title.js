// The title screen (docs/REVAMP.md 6.8). The markup and CSS live in
// src/index.html so the screen shows as soon as the page does; this module
// is the small controller main.js calls once the game exists.
//
//   const title = createTitle(document);
//   title.setReady(true);                       // Start enables ("Loading" becomes "Start")
//   title.setCanContinue(game.session.canContinue());
//   title.onStart(() => {...});                 // Start tapped
//   title.onContinue(() => {...});              // Continue tapped
//   title.showView(true);                       // the designed view fades in (0.4 s) behind it
//   title.hide();                               // Play begins
//
// All text goes through textContent; no network, no wall-clock time.
//
// The About page (docs/UI.md): `fillAbout(doc, parent, { version })` writes the
// content; the title shows it in its own panel (the About button, top right),
// the pause menu shows the same content on its About screen.
export const MAP_CREDIT = 'Map data (c) OpenStreetMap contributors, ODbL';
export const PRIVACY_PAGE = 'privacy.html';

export function fillAbout(doc, parent, opts = {}) {
  const add = (tag, cls, text, role) => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (role) e.dataset.role = role;
    parent.appendChild(e);
    return e;
  };
  add('div', 'rw-about-h', 'Rustwater');
  add('p', 'rw-about-p', 'Version ' + (opts.version || 'dev'), 'about-version');
  add('div', 'rw-about-h', 'Credits');
  add('p', 'rw-about-p', 'Rustwater is an original game: its names, characters and art are its own. It is drawn with three.js (MIT licence).', 'about-credits');
  add('div', 'rw-about-h', 'Map');
  add('p', 'rw-about-p', MAP_CREDIT, 'about-map');
  add('p', 'rw-about-p rw-about-dim', 'The map is built from OpenStreetMap data, used under the Open Database Licence (ODbL).');
  add('div', 'rw-about-h', 'Names');
  add('p', 'rw-about-p', 'Venue, shop and business names in the game are invented. Any likeness to a real place is chance.', 'about-names');
  add('div', 'rw-about-h', 'Privacy');
  add('p', 'rw-about-p', 'Rustwater makes no network requests while you play. Your progress and settings are saved on this phone only.', 'about-privacy');
  const a = add('a', 'rw-about-link', 'Privacy page', 'about-privacy-link');
  a.href = PRIVACY_PAGE;
  a.target = '_blank';
  a.rel = 'noopener';
}

const ABOUT_CSS = `
#boot .rw-aboutwrap { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center;
  padding: calc(8px + var(--st)) calc(12px + var(--sr)) calc(8px + var(--sb)) calc(12px + var(--sl)); background: rgba(12,9,8,0.85); }
#boot .rw-aboutbox { box-sizing: border-box; width: min(640px, 100%); max-height: 100%; display: flex; flex-direction: column;
  border-radius: 16px; background: rgba(24,18,15,0.95); box-shadow: inset 0 0 0 1px rgba(246,239,230,0.22); color: #f6efe6; font-size: 14px; line-height: 1.3; }
#boot .rw-abouttop { flex: 0 0 56px; display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 4px 16px; }
#boot .rw-abouttop b { font-size: 20px; }
#boot .rw-aboutbody { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 16px 10px; -webkit-user-select: text; user-select: text; touch-action: pan-y; overscroll-behavior: contain; }
#boot .rw-aboutbody p { margin: 0 0 6px; }
#boot .rw-about-h { margin: 8px 0 3px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #e2733a; font-weight: 700; }
#boot .rw-about-dim { opacity: 0.75; }
#boot .rw-about-link, .rw-about-link { display: inline-flex; align-items: center; min-height: 48px; padding: 0 4px; color: #ffd08a; font-weight: 700; }
#boot .rw-aboutclose { min-width: 96px; height: 48px; font: inherit; font-size: 16px; font-weight: 700; border-radius: 12px; border: 2px solid #e2733a; background: #e2733a; color: #14110f; cursor: pointer; touch-action: manipulation; }
`;
export function createTitle(doc) {
  const boot = doc.getElementById('boot');
  const play = doc.getElementById('play');
  const cont = doc.getElementById('continue');
  const msg = doc.getElementById('bootmsg');
  let startFn = null, contFn = null;
  const aboutBtn = doc.getElementById('aboutbtn');
  const verEl = doc.getElementById('bootver');
  let aboutBox = null;
  function openAbout() {
    if (!boot || aboutBox) return;
    if (!doc.getElementById('rw-about-style')) {
      const st = doc.createElement('style');
      st.id = 'rw-about-style';
      st.textContent = ABOUT_CSS;
      doc.head.appendChild(st);
    }
    aboutBox = doc.createElement('div');
    aboutBox.className = 'rw-aboutwrap';
    const box = doc.createElement('div');
    box.className = 'rw-aboutbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'About Rustwater');
    const top = doc.createElement('div');
    top.className = 'rw-abouttop';
    const t = doc.createElement('b');
    t.textContent = 'About';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'rw-aboutclose';
    close.textContent = 'Close';
    close.addEventListener('click', closeAbout);
    top.append(t, close);
    const body = doc.createElement('div');
    body.className = 'rw-aboutbody';
    fillAbout(doc, body, { version: verEl ? verEl.textContent : '' });
    box.append(top, body);
    aboutBox.appendChild(box);
    boot.appendChild(aboutBox);
    close.focus({ preventScroll: true });
  }
  function closeAbout() {
    if (aboutBox) aboutBox.remove();
    aboutBox = null;
    if (aboutBtn) aboutBtn.focus({ preventScroll: true });
  }
  if (aboutBtn) aboutBtn.addEventListener('click', openAbout);
  if (play) play.addEventListener('click', () => { if (startFn && !play.disabled) startFn(); });
  if (cont) cont.addEventListener('click', () => { if (contFn && !cont.disabled) contFn(); });
  return {
    onStart(fn) { startFn = fn; },
    onContinue(fn) { contFn = fn; },
    setReady(on) { if (play) play.disabled = !on; },
    // Continue is only offered when a saved place can be restored.
    setCanContinue(on) { if (cont) cont.hidden = !on; },
    setMessage(text) { if (msg) msg.textContent = text; },
    // true: the page background goes clear so the 3D view shows through.
    showView(on) { if (boot) boot.classList.toggle('rw-clear', !!on); },
    hide() { if (boot) boot.style.display = 'none'; },
    isAboutOpen: () => !!aboutBox,
    isShown() { return !!boot && boot.style.display !== 'none'; },
  };
}

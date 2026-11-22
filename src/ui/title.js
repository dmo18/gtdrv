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
export function createTitle(doc) {
  const boot = doc.getElementById('boot');
  const play = doc.getElementById('play');
  const cont = doc.getElementById('continue');
  const msg = doc.getElementById('bootmsg');
  let startFn = null, contFn = null;
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
    isShown() { return !!boot && boot.style.display !== 'none'; },
  };
}

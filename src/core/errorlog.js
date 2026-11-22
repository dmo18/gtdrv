// Errors caught at the frame loop's boundaries (src/core/loop.js) and
// around each system's update and render (src/game.js). A thrown error in
// one system must not freeze the game on the player's phone: it is caught,
// reported once per distinct message (so a fault that repeats every frame
// does not flood the console) and the frame carries on.
//
// createErrorLog({ max, log }):
//   report(where, err) -> true the first time this (where, message) is
//                         seen; `log(where, err)` is called only then.
//   count   every error reported (repeats included)
//   list    the distinct ones, oldest first: { where, message, stack, n }
//           (at most `max`; later new ones are counted but not kept)
export function createErrorLog({ max = 32, log = null } = {}) {
  const byKey = new Map();
  const out = {
    count: 0,
    list: [],
    report(where, err) {
      out.count++;
      const message = err && err.message !== undefined ? String(err.message) : String(err);
      const key = where + '\u0000' + message;
      const seen = byKey.get(key);
      if (seen) {
        seen.n++;
        return false;
      }
      const e = { where, message, stack: err && err.stack ? String(err.stack) : '', n: 1 };
      byKey.set(key, e);
      if (out.list.length < max) out.list.push(e);
      if (log) log(where, err);
      return true;
    },
  };
  return out;
}

// The default reporter: console.error, once per distinct message.
export const consoleLog = (where, err) => {
  if (typeof console !== 'undefined') console.error('Rustwater: ' + where + ' threw (shown once):', err);
};

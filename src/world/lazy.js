// Fields made on first use (0.15 build time). lazyField(obj, key, make)
// turns obj[key] into an accessor: the first read calls make() once and
// keeps its result; a write before any read keeps the written value and
// never calls make. Either way obj[key] is a plain data property after
// that (enumerable, writable), so spreads, Object.keys and JSON see it as
// before. Only for values whose make() reads nothing that can change
// after it is set up, so the value is the same whenever the first read
// comes. Pure: no three.js, no DOM.
export function ownField(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  return value;
}
export function lazyField(obj, key, make) {
  let busy = false;
  Object.defineProperty(obj, key, {
    get() {
      if (busy) throw new Error(`lazy field ${key} read while it is made`);
      busy = true;
      let v;
      try {
        v = make();
      } finally {
        busy = false;
      }
      return ownField(obj, key, v);
    },
    set(v) { ownField(obj, key, v); },
    enumerable: true,
    configurable: true,
  });
}

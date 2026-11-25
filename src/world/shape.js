// One constructor for every collision shape, so the shapes share one object
// layout (V8 keeps property reads fast and stops boxing numbers). The group
// field `grp` is hidden: shapes are compared and printed as JSON.
export function mkShape(kind, x0, z0, x1, z1, x, z, r, h, tag) {
  const s = { kind, x0, z0, x1, z1, x, z, r, h, tag, stamp: 0, off: false, brk: null, ptype: '' };
  Object.defineProperty(s, 'grp', { value: null, enumerable: false, writable: true, configurable: true });
  return s;
}

// Minimal publish/subscribe so systems can react to each other
// (for example: audio hears 'vehicleImpact') without direct links.
export function createEvents() {
  const map = new Map();
  return {
    on(name, fn) {
      let list = map.get(name);
      if (!list) map.set(name, (list = []));
      list.push(fn);
      return () => list.splice(list.indexOf(fn), 1);
    },
    emit(name, a, b, c) {
      const list = map.get(name);
      if (!list) return;
      for (let i = 0; i < list.length; i++) list[i](a, b, c);
    },
  };
}

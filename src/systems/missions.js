// Mission engine (task 28 fills this): start zones, briefing cards,
// objectives, fail / retry / skip, results. Content lives in
// src/world/missiondata.js. See docs/MISSIONS.md.
//
// Stub: registered by game.js, no missions yet.
export function createMissions(game, uiRoot) {
  return {
    name: 'missions',
    game,
    root: uiRoot || null,
    active: null,
    start() {
      return false;
    },
    fixedUpdate() {},
    render() {},
  };
}

// Combat HUD (task 26 fills this): crosshair, weapon name and icon,
// magazine count, slim health bar; hidden in craft except during
// drive-by. See docs/COMBAT.md "Touch controls".
//
// Stub: registered by game.js, draws nothing yet.
export function createCombatHud(game, uiRoot) {
  return {
    name: 'combathud',
    game,
    root: uiRoot || null,
    render() {},
  };
}

// User-configurable model surfaces, not official venue geometry.
export const STAGE_WALL_SIDES = Object.freeze(['back', 'left', 'right']);
export function normalizeStageWallSides(sides) {
  return Object.fromEntries(STAGE_WALL_SIDES.map(side => [side, sides?.[side] !== false]));
}
export function defaultStageWallSides(venueId) {
  return { back: true, left: true, right: true };
}
export function resolveStageWallSettings(venueId, settings = {}) {
  const explicit = settings.stageWallSides;
  const complete = explicit && STAGE_WALL_SIDES.every(side => typeof explicit[side] === 'boolean');
  const sides = complete ? normalizeStageWallSides(explicit)
    : typeof settings.stageWallsEnabled === 'boolean'
      ? { back: settings.stageWallsEnabled, left: settings.stageWallsEnabled, right: settings.stageWallsEnabled }
      : defaultStageWallSides(venueId);
  return { stageWallSides: sides, stageWallsEnabled: Object.values(sides).some(Boolean) };
}

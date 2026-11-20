// American units for everything the player reads. The game keeps metric
// internally (metres, km/h); these helpers only change what is shown.
export const KMH_TO_MPH = 0.621371;
const FEET_PER_METRE = 3.28084;
const METRES_PER_MILE = 1609.344;

// Speed in miles per hour from km/h.
export function speedMph(kmh) {
  return Number.isFinite(kmh) ? kmh * KMH_TO_MPH : 0;
}

// A distance in feet below a thousand feet, then miles to one decimal.
export function formatDistance(metres) {
  if (!Number.isFinite(metres) || metres < 0) return '-';
  const ft = metres * FEET_PER_METRE;
  if (ft < 1000) return Math.round(ft) + ' ft';
  return (metres / METRES_PER_MILE).toFixed(1) + ' mi';
}

// Always miles, one decimal (distance travelled).
export function formatMiles(metres) {
  if (!Number.isFinite(metres) || metres < 0) return '-';
  return (metres / METRES_PER_MILE).toFixed(1) + ' mi';
}

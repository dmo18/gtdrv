// American units for everything the player reads. The game keeps metric
// internally (meters, km/h); these helpers only change what is shown.
export const KMH_TO_MPH = 0.621371;
const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

// Speed in miles per hour from km/h.
export function speedMph(kmh) {
  return Number.isFinite(kmh) ? kmh * KMH_TO_MPH : 0;
}

// A distance in feet below a thousand feet, then miles to one decimal.
export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '-';
  const ft = meters * FEET_PER_METER;
  if (ft < 1000) return Math.round(ft) + ' ft';
  return (meters / METERS_PER_MILE).toFixed(1) + ' mi';
}

// Always miles, one decimal (distance traveled).
export function formatMiles(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '-';
  return (meters / METERS_PER_MILE).toFixed(1) + ' mi';
}

// 12-hour clock text such as "1:30 PM" from minutes since midnight.
export function formatClock12(minutes) {
  const m = Number.isFinite(minutes) ? ((Math.floor(minutes) % 1440) + 1440) % 1440 : 0;
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return h12 + ':' + (mm < 10 ? '0' : '') + mm + (h24 < 12 ? ' AM' : ' PM');
}

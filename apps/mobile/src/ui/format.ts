/** Turning numbers into the few characters a rider has time to read. */

/** "850 m", "1.2 km", "12 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** Kilometres with one decimal, no unit: for stat tiles that label it. */
export const km = (meters: number): string => (meters / 1000).toFixed(meters < 100_000 ? 1 : 0);

/** "42 min", "1 h 05". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** "1:05:09" / "5:09" for a running clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** m/s -> whole km/h. */
export const kmh = (metersPerSecond: number): number =>
  Number.isFinite(metersPerSecond) ? Math.round(metersPerSecond * 3.6) : 0;

/** Round a corner-speed estimate down to the nearest 5 km/h: never flatter it. */
export const roundedSpeed = (metersPerSecond: number): number =>
  Math.max(10, Math.floor((metersPerSecond * 3.6) / 5) * 5);

/** The distance on the ride screen: coarse far away, fine up close. */
export function countdown(meters: number): string {
  if (meters <= 15) return "NOW";
  if (meters < 300) return String(Math.round(meters / 10) * 10);
  if (meters < 1000) return String(Math.round(meters / 50) * 50);
  return (meters / 1000).toFixed(1);
}

export const countdownUnit = (meters: number): string =>
  meters <= 15 ? "" : meters < 1000 ? "m" : "km";

/** "Mon 3 Nov, 7:42 am" without relying on a locale the phone may lack. */
export function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}, ${h12}:${String(
    d.getMinutes(),
  ).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
}

/** Corners per km -> a 1-5 "how twisty" score. */
export function twistiness(cornersPerKm: number, hairpinsPerKm: number): number {
  const score = cornersPerKm + hairpinsPerKm * 4;
  if (score >= 9) return 5;
  if (score >= 6) return 4;
  if (score >= 3.5) return 3;
  if (score >= 1.5) return 2;
  return 1;
}

export const TWISTINESS_WORDS = ["", "Relaxed", "Easy", "Lively", "Twisty", "Relentless"];

/**
 * How the crawl shows a temperature (v2.120.0): one scale, or both with the
 * chosen one first — 'F', 'C', 'CF' or 'FC'. Anything else is 'F', which is
 * what the crawl always showed.
 *
 * The server sends `tempC` converted from the unrounded reading. A reading
 * cached before it did is converted here from the rounded °F instead.
 */
export function formatTemperature(weather, units = 'F') {
  const f = `${weather.temp}°F`;
  const c = `${weather.tempC ?? Math.round((weather.temp - 32) * 5 / 9)}°C`;
  switch (units) {
    case 'C': return c;
    case 'CF': return `${c} / ${f}`;
    case 'FC': return `${f} / ${c}`;
    default: return f;
  }
}

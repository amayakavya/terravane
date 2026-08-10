// Minimal geohash codec. Positions are stored on-chain as geohashes because a
// short ASCII string is far cheaper than two signed fixed-point coordinates, and
// truncating one is a natural way to publish a farm's region without its gate.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat, lon, precision = 7) {
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let hash = "";
  let bits = 0;
  let bit = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (lon >= mid) {
        bits = (bits << 1) | 1;
        lonRange[0] = mid;
      } else {
        bits <<= 1;
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latRange[0] = mid;
      } else {
        bits <<= 1;
        latRange[1] = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[bits];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

export function decodeGeohash(hash) {
  if (!hash) return null;
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let even = true;

  for (const char of hash.toLowerCase()) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) return null;
    for (let n = 4; n >= 0; n--) {
      const bit = (idx >> n) & 1;
      const range = even ? lonRange : latRange;
      const mid = (range[0] + range[1]) / 2;
      if (bit === 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return {
    lat: (latRange[0] + latRange[1]) / 2,
    lon: (lonRange[0] + lonRange[1]) / 2,
    latError: (latRange[1] - latRange[0]) / 2,
    lonError: (lonRange[1] - lonRange[0]) / 2
  };
}

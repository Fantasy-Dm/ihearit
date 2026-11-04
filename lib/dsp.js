'use strict';
function normalized(values) { let sum = 0; for (const n of values) sum += n * n; const scale = Math.sqrt(sum) + 1e-12; return Float32Array.from(values, n => n / scale); }
function energy(samples) { const result = new Float32Array(Math.floor(samples.length / 80)); for (let i = 0; i < result.length; i++) { let sum = 0; for (let j = 0; j < 80; j++) sum += samples[i * 80 + j] ** 2; result[i] = Math.sqrt(sum / 80); } return result; }
function quantile(values, q) { const sorted = Array.from(values).sort((a, b) => a - b), at = (sorted.length - 1) * q, first = Math.floor(at); return sorted[first] + (sorted[Math.ceil(at)] - sorted[first]) * (at - first); }
function spectrum(samples, size = 2048) {
  const real = new Float64Array(size), imag = new Float64Array(size); real.set(samples);
  for (let i = 1, j = 0; i < size; i++) { let bit = size >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j ^= bit; if (i < j) [real[i], real[j]] = [real[j], real[i]]; }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let first = 0; first < size; first += length) { let xr = 1, xi = 0; for (let j = 0; j < length / 2; j++) { const a = first + j, b = a + length / 2, tr = real[b] * xr - imag[b] * xi, ti = real[b] * xi + imag[b] * xr; real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti; const next = xr * wr - xi * wi; xi = xr * wi + xi * wr; xr = next; } }
  }
  return Float64Array.from(real.subarray(0, size / 2 + 1), (v, i) => v * v + imag[i] * imag[i]);
}
function mouthCandidates(e) {
  const peaks = [];
  for (let i = 1; i < e.length - 1; i++) if (e[i] >= .005 && e[i] > e[i - 1]) {
    let end = i; while (end + 1 < e.length && e[end + 1] === e[i]) end++;
    if (end < e.length - 1 && e[end] > e[end + 1]) peaks.push(Math.floor((i + end) / 2)); i = end;
  }
  const kept = [];
  for (const k of peaks.sort((a, b) => e[b] - e[a] || b - a)) if (!kept.some(p => Math.abs(k - p) < 16)) kept.push(k);
  const result = [];
  for (const k of kept.sort((a, b) => a - b)) {
    let left = k, right = k, minL = e[k], minR = e[k];
    while (left > 0 && e[left - 1] <= e[k]) minL = Math.min(minL, e[--left]);
    while (right < e.length - 1 && e[right + 1] <= e[k]) minR = Math.min(minR, e[++right]);
    const prominence = e[k] - Math.max(minL, minR); if (prominence < .004) continue;
    const level = e[k] - prominence * .8; left = k; right = k;
    while (left > 0 && e[left] > level) left--; while (right < e.length - 1 && e[right] > level) right++;
    const a = e[left] < level ? left + (level - e[left]) / (e[left + 1] - e[left]) : left, b = e[right] < level ? right - (level - e[right]) / (e[right - 1] - e[right]) : right, width = (b - a) * .005;
    if (width < .005 || width > .13) continue;
    const before = e.subarray(Math.max(0, k - 30), Math.max(1, k - 8)), after = e.subarray(Math.min(e.length - 1, k + 8), Math.min(e.length, k + 30));
    if (before.length < 3 || after.length < 3 || Math.max(quantile(before, .25), quantile(after, .25)) / (e[k] + 1e-8) > .15) continue;
    result.push(k);
  }
  return result;
}
function similarity(a, b, mode) { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i] * (mode !== 'mouth' ? 1 : i < 60 ? .25 : i < 100 ? .3 : .45); return sum; }
function lowerBound(values, at) { let a = 0, b = values.length; while (a < b) { const m = (a + b) >>> 1; if (values[m] < at) a = m + 1; else b = m; } return a; }
module.exports = {normalized, energy, quantile, spectrum, mouthCandidates, similarity, lowerBound};

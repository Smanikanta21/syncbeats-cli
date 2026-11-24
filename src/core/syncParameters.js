// Ported from SyncBeats web useAdaptiveSync PARAM_TABLE and syncClock helpers.
export const PARAM_TABLE = {
  excellent: { samples: 7, rttGate: 150, pingGap: 20, resync: 10000, driftInterval: 250, hardSeek: 20 },
  good: { samples: 7, rttGate: 250, pingGap: 40, resync: 12000, driftInterval: 350, hardSeek: 25 },
  fair: { samples: 5, rttGate: 400, pingGap: 60, resync: 15000, driftInterval: 600, hardSeek: 35 },
  poor: { samples: 4, rttGate: 600, pingGap: 100, resync: 20000, driftInterval: 1000, hardSeek: 50 },
};
export function median(values) { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
export function selectClockOffset(samples, gate, bootstrap = false) {
  const valid = samples.filter(s => Number.isFinite(s.offset) && Number.isFinite(s.rtt) && s.rtt >= 0);
  const gated = valid.filter(s => s.rtt <= gate);
  const candidates = gated.length ? gated : bootstrap ? valid : [];
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => a.rtt - b.rtt);
  const q1 = sorted[Math.floor(sorted.length * .25)].rtt, q3 = sorted[Math.floor(sorted.length * .75)].rtt;
  const clean = sorted.filter(s => s.rtt <= q3 + 1.5 * (q3 - q1));
  return median(clean.slice(0, Math.max(1, Math.ceil(clean.length * .35))).map(s => s.offset));
}
export function adaptiveParameters(samples, current) {
  if (!samples.length) return { quality: 'good', params: current, latency: null, jitter: null };
  const values = samples.map(s => s.rtt).sort((a, b) => a - b);
  const latency = median(values), jitter = values[Math.floor(values.length * .75)] - values[Math.floor(values.length * .25)];
  const quality = latency < 30 && jitter < 5 ? 'excellent' : latency < 80 && jitter < 15 ? 'good' : latency < 200 && jitter < 40 ? 'fair' : 'poor';
  const params = Object.fromEntries(Object.entries(PARAM_TABLE[quality]).map(([key, value]) => [key, Math.round(current[key] * .65 + value * .35)]));
  return { quality, params, latency, jitter };
}

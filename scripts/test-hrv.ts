/**
 * Checks the rule against the client's own worked example.
 *
 *   npx tsx scripts/test-hrv.ts
 */
 
import {
  createHrvState,
  getSnapshot,
  parseHeartRateMeasurement,
  pushBeat,
  type Beat,
} from '../src/lib/hrv-live/hrv-engine'
 
let failures = 0;
 
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!condition) failures += 1;
}
 
function heading(text: string) {
  console.log(`\n${'='.repeat(76)}\n${text}\n${'='.repeat(76)}`);
}
 
/** Feed a list of intervals in, one second apart, and return every beat. */
function run(intervals: number[]): { beats: Beat[]; state: ReturnType<typeof createHrvState> } {
  const state = createHrvState();
  const beats: Beat[] = [];
  let clock = Date.now();
 
  for (const rr of intervals) {
    beats.push(pushBeat(state, rr, clock));
    clock += rr;
  }
 
  return { beats, state };
}
 
/* ================================================================== */
 
heading('TEST 1 — the client\'s worked example');
 
const EXAMPLE = [878, 953, 899, 925, 1200, 400, 895, 965, 899];
const { beats, state } = run(EXAMPLE);
 
const flagged = beats.filter((b) => b.bad).map((b) => b.rr);
const scored = beats.filter((b) => !b.bad).map((b) => b.rr);
 
for (const b of beats) {
  console.log(`   ${b.bad ? '*' : ' '} ${String(b.rr).padStart(5)}  ${b.reason}`);
}
console.log('');
 
check(
  'flags exactly 1200, 400, 895',
  JSON.stringify(flagged) === JSON.stringify([1200, 400, 895]),
  `got ${JSON.stringify(flagged)}`,
);
 
check(
  'scores 878, 953, 899, 925, 965, 899',
  JSON.stringify(scored) === JSON.stringify([878, 953, 899, 925, 965, 899]),
  `got ${JSON.stringify(scored)}`,
);
 
check('965 is counted, not dropped', !beats[7].bad);
 
/* ------------------------------------------------------------------ */
 
heading('TEST 2 — the score is built from that list');
 
// 878, 953, 899, 925, 965, 899  ->  +75, -54, +26, +40, -66
const expectedDiffs = [75, -54, 26, 40, -66];
const expectedRmssd = Math.sqrt(
  expectedDiffs.reduce((sum, d) => sum + d * d, 0) / expectedDiffs.length,
);
 
const snapshot = getSnapshot(state);
 
console.log(`   differences  ${expectedDiffs.join(', ')}`);
console.log(`   RMSSD        ${snapshot.rmssd?.toFixed(1)} ms`);
console.log('');
 
check(
  'RMSSD is built from the 5 differences of the good beats',
  Math.abs((snapshot.rmssd ?? 0) - expectedRmssd) < 0.05,
  `${snapshot.rmssd?.toFixed(1)} ms`,
);
 
check('925 -> 965 counts as +40', expectedDiffs.includes(40));
 
/* ------------------------------------------------------------------ */
 
heading('TEST 3 — each rule on its own');
 
check(
  'rule 1 fires: 925 -> 1200 is +29.7% and +275ms',
  run([925, 1200]).beats[1].bad,
);
 
check(
  'rule 1 does NOT fire on a big % that is small in ms: 400 -> 480',
  !run([400, 480]).beats[1].bad,
  '+20% but only +80ms',
);
 
check(
  'rule 1 does NOT fire on a big ms that is small in %: 1500 -> 1660',
  !run([1500, 1660]).beats[1].bad,
  '+160ms but only 10.7%',
);
 
check(
  'rule 2 fires on a big absolute jump at any %: 1500 -> 1810',
  run([1500, 1810]).beats[1].bad,
  '+310ms',
);
 
check('the very first beat is always good', !run([4000]).beats[0].bad);
 
check(
  'each beat is judged against the previous RAW beat',
  run([925, 1200, 1150]).beats[2].bad === false,
  '1150 is judged against 1200 (-4%), not against 925',
);
 
/* ------------------------------------------------------------------ */
 
heading('TEST 4 — clean data is never touched');
 
function clean(base: number, swing: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(base + Math.sin(i / 3) * swing));
}
 
for (const [label, rrs] of [
  ['low HRV ', clean(900, 12, 20)],
  ['mid HRV ', clean(900, 35, 20)],
  ['high HRV', clean(900, 80, 20)],
] as const) {
  const result = run(rrs);
  const bad = result.beats.filter((b) => b.bad).length;
  const snap = getSnapshot(result.state);
  check(`${label}: nothing flagged`, bad === 0, `RMSSD ${snap.rmssd?.toFixed(1)} ms`);
}
 
/* ------------------------------------------------------------------ */
 
heading('TEST 5 — the 18 beat window');
 
const wState = createHrvState();
const start = Date.now();
 
for (let i = 0; i < 30; i++) pushBeat(wState, 900, start + i * 900);
 
const wSnap = getSnapshot(wState, start + 29 * 900);
 
console.log(`   beats seen ${wSnap.beatsSeen}, beats still in the window ${wSnap.windowSize}`);
console.log('');
 
check('the window holds exactly 18 beats', wSnap.windowSize === 18, `${wSnap.windowSize}`);
check('the session total still counts all 30', wSnap.beatsSeen === 30);
 
/* ------------------------------------------------------------------ */
 
heading('TEST 6 — Bluetooth parsing still correct');
 
function frame(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}
 
const oneRr = parseHeartRateMeasurement(frame([0x10, 60, 0x00, 0x04]));
check('8-bit HR + one RR', oneRr.bpm === 60 && Math.round(oneRr.rrIntervals[0]) === 1000);
 
const twoRr = parseHeartRateMeasurement(frame([0x10, 60, 0x00, 0x04, 0x80, 0x03]));
check('two RR in one packet', twoRr.rrIntervals.length === 2);
 
// Energy Expended (bit 3) pushes the RR array two bytes later.
const withEnergy = parseHeartRateMeasurement(frame([0x18, 60, 0xff, 0x00, 0x00, 0x04]));
check(
  'energy-expended flag handled',
  withEnergy.rrIntervals.length === 1 && Math.round(withEnergy.rrIntervals[0]) === 1000,
);
 
/* ================================================================== */
 
heading(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
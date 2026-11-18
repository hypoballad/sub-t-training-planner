import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, clock, environmentalPace, paceInputs, parseClock, session, tablePaces, trainingPlan, weeklyPlan } from '../src/engine.mjs';
import { estimateCorosFiveK } from '../src/coros.mjs';

const cfg = (settings) => ({ ...DEFAULTS, ...settings });
const date = '2026-11-16';

test('Table 1.4 exact rows, including the row omitted in the OCR', () => {
  assert.deepEqual(tablePaces(900), [193, 198, 205]);
  assert.deepEqual(tablePaces(1180), [250, 256, 264]);
  assert.deepEqual(tablePaces(1200), [254, 260, 269]);
  assert.deepEqual(tablePaces(1800), [373, 382, 394]);
});

test('interpolate unrounded seconds and avoid extrapolation', () => {
  assert.deepEqual(tablePaces(1190), [252, 258, 266.5]);
  for (const value of [null, NaN, 899, 1801]) assert.equal(tablePaces(value), null);
});

test('COROS validates the selected input and identifies missing values', () => {
  assert.equal(parseClock('４：２０'), 260);
  assert.match(paceInputs(cfg({ paceMode: 'coros', coros: '4:65' })).issue, /分:秒/);
  assert.match(paceInputs(cfg({ paceMode: 'coros', coros: '1:20' })).issue, /2:00/);
  assert.match(paceInputs(cfg({ paceMode: 'coros', five: '20:00' })).issue, /COROS 閾値ペースを入力/);
  assert.match(paceInputs(DEFAULTS).issue, /5 km タイムを入力/);
});

test('COROS 4:50 uses full precision before table interpolation and display rounding', () => {
  const result = paceInputs(cfg({ paceMode: 'coros', coros: '4:50' }));
  assert.equal(result.issue, '');
  assert.equal(result.coros, 290);
  assert.ok(Math.abs(result.estimate - 1373.0044105016764) < 1e-9);
  assert.equal(clock(result.estimate), '22:53');
  assert.ok(result.paces[0].base > 288.6 && result.paces[0].base < 288.61);
  assert.deepEqual(result.paces.map(({ base }) => clock(base)), ['4:49', '4:56', '5:06']);
});

test('Riegel duration and exponent are independent settings', () => {
  assert.ok(estimateCorosFiveK(290, 45) > estimateCorosFiveK(290));
  assert.equal(Math.round(estimateCorosFiveK(290, 60, 1)), 1450);
  const settings = cfg({ paceMode: 'coros', coros: '4:50', riegelMinutes: 45, riegelExponent: 1.1 });
  assert.equal(paceInputs(settings).estimate, estimateCorosFiveK(290, 45, 1.1));
  assert.throws(() => estimateCorosFiveK(290, 0), /持続時間/);
  assert.throws(() => estimateCorosFiveK(290, 60, Infinity), /指数/);
});

test('only the selected mode feeds the plan; comparison values never override it', () => {
  const settings = cfg({ five: '20:00', coros: '4:50', pace3: '5:00', pace6: '5:10', pace10: '5:30' });
  const actual = paceInputs(settings);
  assert.equal(actual.five, 1200);
  assert.equal(actual.coros, 290);
  assert.equal(actual.estimate, null);
  assert.deepEqual(actual.paces.map(({ base }) => base), [254, 260, 269]);
  const threshold = paceInputs({ ...settings, paceMode: 'coros' });
  assert.equal(clock(threshold.paces[0].base), '4:49');
  const manual = paceInputs({ ...settings, paceMode: 'manual' });
  assert.deepEqual(manual.paces.map(({ base }) => base), [300, 310, 330]);
  assert.equal(paceInputs({ ...settings, paceMode: 'manual', pace6: '' }).paces[0].base, null);
  const badComparison = paceInputs({ ...settings, coros: '5:70' });
  assert.equal(badComparison.issue, '');
  assert.equal(badComparison.comparisonWarnings.length, 1);
  assert.equal(badComparison.paces[0].base, 254);
});

test('5 km mode accepts a race prediction through the normal time input', () => {
  const result = paceInputs(cfg({ paceMode: 'five', five: '22:40', coros: '4:50' }));
  assert.equal(result.reference, 1360);
  assert.equal(result.estimate, null);
  assert.deepEqual(result.paces.map(({ base }) => base), [286, 293, 303]);
});

test('COROS mode estimates from the threshold even when old prediction settings are present', () => {
  const result = paceInputs(cfg({ paceMode: 'coros', corosSource: 'prediction', corosPrediction: '22:40', five: '20:00', coros: '4:50' }));
  assert.equal(result.source, 'threshold');
  assert.equal(clock(result.reference), '22:53');
  assert.deepEqual(result.paces.map(({ base }) => clock(base)), ['4:49', '4:56', '5:06']);
});

test('all tabulated sources decline times outside Table 1.4 without substituting comparison data', () => {
  for (const settings of [
    cfg({ five: '30:01', coros: '4:50' }),
    cfg({ paceMode: 'coros', coros: '7:30', five: '20:00' }),
    cfg({ five: '14:59', coros: '4:50' }),
  ]) {
    const result = paceInputs(settings);
    assert.equal(result.outOfRange, true);
    assert.match(result.issue, /15:00〜30:00/);
    assert.ok(result.paces.every(({ base }) => base === null));
  }
});

test('COROS-derived paces reach all planned workout types and dated race tapers', () => {
  for (const race of ['general', 'half', 'full']) {
    const settings = cfg({ race, ends: '2027-02-14', paceMode: 'coros', coros: '4:50' });
    const paces = paceInputs(settings).paces.map((pace) => ({ ...pace, ...environmentalPace(pace.base, settings) }));
    const plan = trainingPlan({ ...settings, paces }, date);
    assert.equal(plan.weeks[0].calendar.filter((day) => day.kind === 'sub').length, 3);
    for (const week of plan.weeks) {
      for (const day of week.calendar.filter((day) => day.kind === 'sub')) {
        assert.equal(day.pace, paces.find(({ rep }) => rep === day.rep).base);
        assert.equal(day.workDistance, day.sub / day.pace);
      }
    }
  }
});

test('session adds only between-rep rests and handles one repetition', () => {
  const result = session({ reps: 5, rep: 6, rest: 75, warmup: 10, cooldown: 10 });
  assert.equal(result.sub, 1800);
  assert.equal(result.recovery, 300);
  assert.equal(result.total, 3300);
  assert.equal(session({ reps: 1, rep: 6, rest: 75, warmup: 8, cooldown: 6 }).total, 1200);
});

test('calculate distance using separate paces for the workout portions', () => {
  const args = { reps: 2, rep: 3, rest: 60, warmup: 5, cooldown: 5, pace: 240 };
  assert.equal(session(args).workDistance, 1.5);
  assert.equal(session(args).distance, null);
  assert.equal(session({ ...args, easyPace: 300, jogPace: 360 }).distance, 3.5 + 1 / 6);
});

test('measure one rep in metres using the unrounded internal pace', () => {
  const { paces } = paceInputs(cfg({ paceMode: 'coros', coros: '4:50' }));
  const intervals = paces.map(({ rep, base }) => session({ rep, pace: base, reps: 3, rest: 60, warmup: 10, cooldown: 10 }));
  assert.deepEqual(intervals.map(({ repDistanceMeters }) => repDistanceMeters), [624, 1218, 1963]);
  assert.equal(intervals[0].workDistance, 540 / paces[0].base);
  assert.equal(intervals[0].total, 1860);
  assert.equal(session({ reps: 3, rep: 3, rest: 60, warmup: 10, cooldown: 10 }).repDistanceMeters, null);
});

test('environment uses the image data, then heat and dew-point adjustment', () => {
  const result = environmentalPace(240, cfg({ hill: 10, hillType: 'uphill', wind: 15, windType: 'head', temp: 17, dew: 16 }));
  assert.deepEqual(result.changes.slice(0, 2).map(({ delta }) => delta), [12, 20]);
  assert.equal(result.adjusted, 272 / 0.98);
  assert.equal(environmentalPace(330, cfg({ wind: 10, windType: 'loop' })).adjusted, 333);
  assert.equal(environmentalPace(180, cfg({ wind: 15, windType: 'tail' })).adjusted, 172);
  assert.equal(environmentalPace(300, cfg({ temp: 25 })).adjusted, 312.5);
  assert.equal(environmentalPace(390, cfg({ wind: 15 })).warnings.length, 1);
  assert.equal(environmentalPace(300, cfg({ temp: 16, dew: 18 })).adjusted, 300);
});

test('every weekly option balances its totals and reports constrained volume', () => {
  for (const count of [4, 5, 6, 7]) {
    for (const hours of [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9]) {
      const week = weeklyPlan(cfg({ count }), hours * 3600);
      assert.equal(week.total, week.calendar.reduce((sum, day) => sum + day.total, 0));
      assert.equal(week.sub, week.calendar.reduce((sum, day) => sum + (day.sub ?? 0), 0));
      assert.equal(week.easy + week.sub, week.total);
      assert.equal(week.rest, 7 - count);
      assert.equal(week.total + week.shortfall, hours * 3600);
      assert.ok(week.calendar.filter(({ kind }) => kind === 'sub').length <= Math.min(3, count - 2));
      if (count === 7) assert.equal(week.shortfall, 0);
    }
  }
});

test('honor selected weekdays and race-specific long-run caps', () => {
  const week = weeklyPlan(cfg({ days: [0, 2, 4, 5], count: 4, race: 'half', long: 120 }), 6 * 3600);
  assert.deepEqual(week.calendar.filter((day) => day.total > 0).map((day) => day.day), [0, 2, 4, 5]);
  assert.equal(week.long, 100 * 60);
  const marathon = weeklyPlan(cfg({ race: 'full', marathonEstimate: 160 * 60, long: 175 }), 8 * 3600);
  assert.equal(marathon.long, 160 * 60);
  const short = weeklyPlan(cfg({ long: 20 }), 5 * 3600);
  assert.equal(short.long, 20 * 60);
  const constrained = weeklyPlan(cfg({ long: 180, count: 4 }), 120 * 60);
  assert.equal(constrained.total, 120 * 60);
  assert.equal(constrained.rest, 3);
  assert.ok(constrained.warnings.some((warning) => warning.includes('ロングランの指定')));
});

test('default steps preserve four weeks and then add time, including one short repetition', () => {
  const { weeks, sample } = trainingPlan(cfg({}), date);
  assert.equal(sample, true);
  assert.equal(weeks.length, 12);
  assert.ok(weeks.slice(0, 4).every((week) => week.total === 300 * 60));
  assert.equal(weeks[4].change, 15 * 60);
  assert.equal(weeks[4].sub - weeks[3].sub, 3 * 60);
  assert.equal(weeks[5].change, 0);
  assert.equal(weeks[7].change, 15 * 60);
});

test('maintenance and custom scheduling, including recovery weeks', () => {
  const maintained = trainingPlan(cfg({ mode: 'maintain', hours: 6, weeks: 8 }), date);
  assert.equal(maintained.weeks.length, 8);
  assert.ok(maintained.weeks.every((week) => week.total === 21600));
  const { weeks } = trainingPlan(cfg({ mode: 'custom', hold: 2, interval: 2, increment: 12, subShare: 0, recoveryEvery: 4 }), date);
  assert.equal(weeks[2].change, 12 * 60);
  assert.equal(weeks[2].sub, weeks[0].sub);
  assert.ok(weeks[3].recovery);
  assert.equal(weeks[3].total, Math.round(312 * 60 * .8));
});

test('date plans count backwards, handle a partial first week and preserve actual weekdays', () => {
  const settings = cfg({ race: '10k', weeks: 8, ends: '2027-02-14' });
  const { weeks, dated } = trainingPlan(settings, date);
  assert.equal(dated, true);
  assert.equal(weeks.length, 8);
  assert.equal(weeks[0].calendar[0].date, '2026-12-21');
  assert.equal(weeks.at(-1).calendar.at(-1).date, settings.ends);
  assert.equal(weeks.at(-1).calendar.at(-1).kind, 'race');
  assert.equal(weeks.at(-1).calendar.at(-1).sub, 0);
  assert.ok(weeks.at(-1).taper);
  assert.ok(weeks.at(-1).total < weeks.at(-2).total);
  const partial = trainingPlan({ ...settings, starts: '2027-02-03' }, date);
  assert.equal(partial.weeks.length, 2);
  assert.equal(partial.weeks[0].calendar[0].kind, 'outside');
  assert.equal(partial.weeks[0].calendar[2].day, 2);
  assert.throws(() => trainingPlan({ ...settings, starts: '2027-02-30' }, date), /開始日/);
});

test('full marathon uses 15 weeks and a four-phase sequence', () => {
  const { weeks } = trainingPlan(cfg({ race: 'full', hours: 7, marathonEstimate: 165 * 60 }), date);
  assert.equal(weeks.length, 15);
  assert.deepEqual([...new Set(weeks.map((week) => week.phase))], ['基礎期', '負荷増加期', 'レース特化期', 'テーパリング']);
  assert.ok(weeks.every((week) => week.long <= 165 * 60));
  assert.ok(weeks.at(-1).total < weeks.at(-3).total);
  assert.equal(weeks.at(-1).calendar.find((item) => item.kind === 'race'), undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, environmentalPace, paceInputs, parseClock, session, tablePaces, trainingPlan, weeklyPlan } from '../src/engine.mjs';

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

test('validate COROS input and preserve the threshold independently', () => {
  assert.equal(parseClock('４：２０'), 260);
  assert.throws(() => paceInputs(cfg({ coros: '4:65' })), /分:秒/);
  assert.throws(() => paceInputs(cfg({ coros: '1:20' })), /2:00/);
  assert.throws(() => paceInputs(DEFAULTS), /入力/);
  const result = paceInputs(cfg({ coros: '4:20' }));
  assert.equal(result.coros.thresholdSeconds, 260);
  assert.equal(result.coros.subThresholdPaces, null);
  assert.deepEqual(result.paces.map(({ base }) => base), [null, null, null]);
});

test('prioritize manual paces per repetition without overriding the other inputs', () => {
  const result = paceInputs(cfg({ five: '20:00', coros: '4:18', pace6: '4:23' }));
  assert.equal(result.coros.thresholdSeconds, 258);
  assert.deepEqual(result.paces.map(({ base }) => base), [254, 263, 269]);
  assert.deepEqual(result.paces.map(({ source }) => source), ['表 1.4', '手動指定', '表 1.4']);
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

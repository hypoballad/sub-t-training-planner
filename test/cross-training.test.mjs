import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, trainingPlan } from '../src/engine.mjs';
import { CYCLING_WEEKS, crossSchedule, cyclingWatts } from '../src/cross-training.mjs';

const date = '2026-11-16';
const plan = (settings = {}, start = date) => trainingPlan({ ...DEFAULTS, ...settings }, start);

test('empty settings preserve running time with no extra activities', () => {
  const [week] = plan().weeks;
  assert.ok(week.calendar.every((day) => day.cross.length === 0));
  assert.deepEqual(week.activity, { running: 18000, cycling: 0, other: 0, high: 0, rest: 0, total: 18000, conflicts: [] });
});

test('keep fixed weekdays, count both disciplines and preserve every running workout', () => {
  const settings = {
    count: 6,
    cyclingDays: [0, 2], cyclingMinutes: 45, cyclingIntensity: 'medium',
    otherDays: [1, 2], otherMinutes: 30, otherIntensity: 'high', otherFrequency: 2, otherNote: '固定メモ',
  };
  const actual = plan(settings).weeks;
  const original = plan({ count: 6 }).weeks;
  for (const [i, week] of actual.entries()) {
    assert.deepEqual(week.calendar.map(({ cross, ...run }) => run), original[i].calendar.map(({ cross, ...run }) => run));
    assert.equal(week.total, original[i].total);
    assert.equal(week.sub, original[i].sub);
    assert.equal(week.change, original[i].change);
    assert.equal(week.activity.cycling, 5400);
    assert.equal(week.activity.other, 3600);
    assert.equal(week.activity.total, week.total + 9000);
    assert.equal(week.activity.high, 2);
    assert.equal(week.activity.rest, 0);
    assert.deepEqual(week.calendar[2].cross.map(({ kind }) => kind), ['cycling', 'other']);
    assert.equal(week.calendar[2].cross[1].note, '固定メモ');
  }
});

test('detect high intensity on the same or adjacent dates, including across weekly boundaries', () => {
  const settings = { otherDays: [1, 6], otherMinutes: 25, otherIntensity: 'high' };
  const [week] = plan(settings).weeks;
  assert.ok(week.activity.conflicts.some(({ sameDay, crossDate }) => sameDay && crossDate === '2026-11-17'));
  assert.ok(week.activity.conflicts.some(({ sameDay, crossDate, subDate }) =>
    !sameDay && crossDate === '2026-11-22' && subDate === '2026-11-21'));
  const [mondayAtEnd] = plan({ ...settings, otherDays: [0] }, '2026-11-17').weeks;
  assert.ok(mondayAtEnd.activity.conflicts.some(({ crossDate, subDate }) =>
    crossDate === '2026-11-23' && subDate === '2026-11-24'));
  assert.deepEqual(plan({ ...settings, otherIntensity: 'medium' }).weeks[0].activity.conflicts, []);
});

test('check Other Training frequency and support inferred or explicit frequency', () => {
  const settings = { otherDays: [2, 4], otherMinutes: 25, otherIntensity: 'low' };
  assert.equal(crossSchedule(settings).flat().length, 2);
  assert.equal(crossSchedule({ ...settings, otherFrequency: 2 }).flat().length, 2);
  assert.throws(() => crossSchedule({ ...settings, otherFrequency: 1 }), /週間実施回数/);
  assert.throws(() => crossSchedule({ otherDays: [2] }), /1回の時間/);
  assert.throws(() => crossSchedule({ cyclingDays: [2] }), /サイクリングの1回の時間/);
});

test('apply only the cycling rows from each verified reference and calculate optional FTP watts', () => {
  assert.equal(CYCLING_WEEKS.weekA.table, '3.5');
  assert.equal(CYCLING_WEEKS.weekB.table, '3.6');
  const a = crossSchedule({ cyclingPlan: 'weekA', cyclingFtp: 237 });
  assert.deepEqual(a.map((day) => day[0]?.total / 60 || 0), [0, 65, 0, 0, 0, 0, 120]);
  assert.deepEqual(a[1][0].ftp, [86, 89]);
  assert.deepEqual(a[1][0].watts, [204, 211]);
  assert.equal(a[1][0].rest, 120);
  const b = crossSchedule({ cyclingPlan: 'weekB' });
  assert.deepEqual(b.map((day) => day[0]?.total / 60 || 0), [60, 0, 60, 0, 0, 70, 0]);
  assert.deepEqual(b[5][0].ftp, [90, 93]);
  assert.equal(b[5][0].watts, null);
  assert.equal(b[5][0].intensity, 'high');
  assert.deepEqual(cyclingWatts([65, 75], 200), [130, 150]);
  assert.equal(plan({ cyclingPlan: 'weekB' }).weeks[0].activity.cycling, 190 * 60);
});

test('clip fixed activities to actual plan dates without moving them for taper', () => {
  const { weeks } = plan({
    race: 'half', starts: '2026-11-19', ends: '2026-11-22',
    otherDays: [1, 6], otherMinutes: 30, otherIntensity: 'high',
  });
  const [week] = weeks;
  assert.ok(week.taper);
  assert.ok(week.calendar.filter(({ kind }) => kind === 'outside').every(({ cross }) => cross.length === 0));
  assert.equal(week.activity.other, 1800);
  assert.equal(week.calendar.at(-1).kind, 'race');
  assert.equal(week.calendar.at(-1).cross[0].kind, 'other');
});

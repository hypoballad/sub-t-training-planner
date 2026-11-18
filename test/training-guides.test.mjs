import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, clock, corosPaceAlert, easyRunGuide, environmentalPace, paceInputs } from '../src/engine.mjs';

test('Easy Run Guide agrees with Table 2.3, including both endpoints', () => {
  const rows = [[920, '4:22'], [1040, '4:58'], [1200, '5:43'], [1220, '5:50'], [1360, '6:29'], [1500, '7:09'], [1520, '7:14'], [1800, '8:34']];
  for (const [seconds, pace] of rows) assert.equal(clock(easyRunGuide(seconds).pace), pace);
});

test('Easy pace uses linear interpolation and declines inputs outside Table 2.3', () => {
  assert.equal(easyRunGuide(1210).pace, 346.5);
  assert.equal(clock(easyRunGuide(1210).pace), '5:47');
  assert.equal(easyRunGuide(921).pace, 262.3);
  for (const outside of [900, 919.999, 1800.001, 1820]) {
    assert.deepEqual(easyRunGuide(outside), { pace: null, outOfRange: true, heartRate: null });
  }
});

test('70% of HRmax remains available when the 5 km value is missing', () => {
  assert.deepEqual(easyRunGuide(null, 187), { pace: null, outOfRange: false, heartRate: 130.9 });
  assert.deepEqual(easyRunGuide(null, ''), { pace: null, outOfRange: false, heartRate: null });
  assert.equal(easyRunGuide(1200, 180).heartRate, 126);
});

test('Easy reference changes with the selected pace input', () => {
  const settings = { ...DEFAULTS, five: '20:00', coros: '4:50', corosPrediction: '22:40', pace3: '5:00', pace6: '5:10', pace10: '5:30' };
  const easy = (selection) => easyRunGuide(paceInputs({ ...settings, ...selection }).reference).pace;
  assert.equal(clock(easy({ paceMode: 'five' })), '5:43');
  assert.equal(clock(easy({ paceMode: 'coros' })), '6:33');
  assert.equal(clock(easy({ paceMode: 'coros', corosSource: 'prediction' })), '6:29');
  assert.equal(easy({ paceMode: 'manual' }), null);
  assert.equal(easy({ paceMode: 'coros', coros: '' }), null);
});

test('default COROS alert boundaries match the three repetition examples', () => {
  const input = paceInputs({ ...DEFAULTS, paceMode: 'coros', coros: '4:50' });
  const examples = input.paces.map(({ base }) => {
    const { fast, slow } = corosPaceAlert(base);
    return [clock(base), clock(fast), clock(slow)];
  });
  assert.deepEqual(examples, [
    ['4:49', '4:44', '4:59'], ['4:56', '4:51', '5:06'], ['5:06', '5:01', '5:16'],
  ]);
});

test('alert width changes apply before display rounding, including corrected paces', () => {
  const { adjusted } = environmentalPace(240, { ...DEFAULTS, temp: 17 });
  assert.equal(adjusted, 240 / .99);
  let limits = corosPaceAlert(adjusted, 2.1, 12.25);
  assert.equal(limits.fast, adjusted - 2.1);
  assert.equal(limits.slow, adjusted + 12.25);
  assert.deepEqual([clock(limits.fast), clock(limits.slow)], ['4:00', '4:15']);
  limits = corosPaceAlert(288.6, 5.25, 0);
  assert.deepEqual([clock(limits.fast), clock(limits.slow)], ['4:43', '4:49']);
  assert.equal(corosPaceAlert(null), null);
});

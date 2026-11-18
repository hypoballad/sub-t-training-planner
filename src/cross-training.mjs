export const CROSS_DEFAULTS = {
  cyclingEnabled: true, cyclingPlan: 'custom', cyclingDays: [], cyclingMinutes: '', cyclingIntensity: 'low', cyclingFtp: '',
  otherEnabled: true, otherDays: [], otherMinutes: '', otherIntensity: 'low', otherFrequency: '', otherNote: '',
};
export const INTENSITIES = { low: '低', medium: '中', high: '高' };
export const CROSS_LABELS = { cycling: 'Cycling', other: 'その他のトレーニング' };
export class CrossTrainingError extends Error {}

const easyRide = (minutes) => ({ kind: 'cycling', minutes, intensity: 'low', ftp: [65, 75] });
const rideIntervals = (minutes, reps, repMinutes, rest, ftp) =>
  ({ kind: 'cycling', minutes, intensity: 'high', reps, repMinutes, rest, ftp });
const easyRun = (minutes) => ({ kind: 'easy', minutes });
const subRun = (minutes, reps, repMinutes) => ({ kind: 'sub', minutes, reps, repMinutes });

// Cross Training chapter. Interval rides are flagged as high when checking the calendar.
export const CYCLING_WEEKS = {
  weekA: { name: 'Week A', table: '3.5', days: [
    easyRun(45), rideIntervals(65, 3, 15, 120, [86, 89]), easyRun(45),
    subRun(55, 5, 6), easyRun(40), subRun(60, 10, 3), easyRide(120),
  ] },
  weekB: { name: 'Week B', table: '3.6', days: [
    easyRide(60), subRun(55, 3, 10), easyRide(60), subRun(55, 5, 6),
    easyRun(40), rideIntervals(70, 8, 5, 60, [90, 93]), { kind: 'long', minutes: '80〜90' },
  ] },
};

export const CYCLING_MODES = { custom: '手動設定', weekA: 'Week A のサイクリング', weekB: 'Week B のサイクリング' };

export function cyclingWatts(percent, ftp) {
  return percent && ftp ? percent.map((value) => Math.round(ftp * value / 100)) : null;
}

export function crossSchedule(settings) {
  const {
    cyclingEnabled, cyclingPlan, cyclingDays, cyclingMinutes, cyclingIntensity, cyclingFtp,
    otherEnabled, otherDays, otherMinutes, otherIntensity, otherFrequency, otherNote,
  } = { ...CROSS_DEFAULTS, ...settings };
  const schedule = Array.from({ length: 7 }, () => []);
  const add = (day, { minutes, ...activity }) => schedule[day].push({ ...activity, total: minutes * 60 });

  const reference = cyclingEnabled && CYCLING_WEEKS[cyclingPlan];
  if (reference) {
    reference.days.forEach((activity, day) => {
      if (activity.kind === 'cycling') add(day, { ...activity, source: reference.name, watts: cyclingWatts(activity.ftp, cyclingFtp) });
    });
  } else if (cyclingEnabled && cyclingDays.length) {
    if (!cyclingMinutes) throw new CrossTrainingError('サイクリングの1回の時間を入力してください。');
    for (const day of cyclingDays) add(day, { kind: 'cycling', minutes: cyclingMinutes, intensity: cyclingIntensity });
  }

  if (otherEnabled && otherFrequency !== '' && otherFrequency !== otherDays.length) {
    throw new CrossTrainingError('その他のトレーニングは週間実施回数と選択曜日の数をそろえてください。');
  }
  if (otherEnabled && otherDays.length) {
    if (!otherMinutes) throw new CrossTrainingError('その他のトレーニングの1回の時間を入力してください。');
    for (const day of otherDays) add(day, { kind: 'other', minutes: otherMinutes, intensity: otherIntensity, note: otherNote });
  }
  return schedule;
}

export function addCrossTraining(weeks, schedule) {
  const calendar = weeks.flatMap((week) => week.calendar);
  let offset = 0;
  return weeks.map((week) => {
    const conflicts = [];
    const totals = { running: week.total, cycling: 0, other: 0, high: 0, rest: 0 };
    const days = week.calendar.map((day, index) => {
      const cross = day.kind === 'outside' ? [] : schedule[day.day];
      if (day.kind === 'rest' && !cross.length) totals.rest += 1;
      for (const activity of cross) {
        totals[activity.kind] += activity.total;
        if (activity.intensity !== 'high') continue;
        totals.high += 1;
        const position = offset + index;
        for (const adjacent of [-1, 0, 1]) {
          const run = calendar[position + adjacent];
          if (run?.kind === 'sub') conflicts.push({ crossDate: day.date, kind: activity.kind, subDate: run.date, sameDay: adjacent === 0 });
        }
      }
      return { ...day, cross };
    });
    offset += days.length;
    const total = totals.running + totals.cycling + totals.other;
    return { ...week, calendar: days, activity: { ...totals, total, conflicts } };
  });
}

import { BOOK_WEEKS, ELEVATION, PACE_ROWS, REP_MINUTES, REST_DEFAULTS, WIND } from './reference.mjs';
import { corosReference } from './coros.mjs';

const DAY = 86400000;
export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
export const RACES = { general: '一般トレーニング', '5k': '5 km', '10k': '10 km', half: 'ハーフマラソン', full: 'フルマラソン' };
export const DEFAULTS = {
  five: '', coros: '', lthr: '', maxHr: '', hours: '', count: 7, easy: '', long: '', sessions: '',
  race: 'general', starts: '', ends: '', weeks: '', expected: '', days: [],
  mode: 'standard', hold: 4, interval: 3, increment: 15, subShare: 20, recoveryEvery: 0, recoveryCut: 20,
  warmup: 10, cooldown: 10, pace3: '', pace6: '', pace10: '', easyPace: '', jogPace: '',
  rest3: 60, rest6: 75, rest10: 105, temp: '', dew: '', wind: '', windType: 'loop', hill: '', hillType: 'loop',
};

export const localDate = (date = new Date()) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((v) => String(v).padStart(2, '0')).join('-');

export function parseClock(value, { optional = false, max = 120, min = 1 } = {}) {
  const input = String(value ?? '').normalize('NFKC').trim();
  if (!input && optional) return null;
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(input);
  if (!match) throw new Error('分:秒の形式で入力してください。');
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds < min * 60 || seconds > max * 60) throw new Error(`${min}:00〜${max}:00 の範囲で入力してください。`);
  return seconds;
}

export function clock(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export function tablePaces(fiveSeconds) {
  if (!Number.isFinite(fiveSeconds) || fiveSeconds < 900 || fiveSeconds > 1800) return null;
  const position = (fiveSeconds - 900) / 20;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return PACE_ROWS[lower].map((pace, i) => pace + fraction * ((PACE_ROWS[lower + 1]?.[i] ?? pace) - pace));
}

function paceField(value, label, range) {
  try {
    return parseClock(value, { optional: true, ...range });
  } catch (error) {
    throw new Error(`${label}　${error.message}`);
  }
}

export function paceInputs(settings) {
  const five = paceField(settings.five, '5 km タイム', { min: 5, max: 120 });
  const coros = corosReference(paceField(settings.coros, 'COROS 閾値ペース', { min: 2, max: 30 }));
  if (five === null && coros === null) throw new Error('5 km タイムか COROS 閾値ペースを入力してください。');
  const tabulated = tablePaces(five);
  const paces = REP_MINUTES.map((rep, i) => {
    const manual = paceField(settings[`pace${rep}`], `${rep}分反復ペース`, { min: 2, max: 30 });
    const source = manual ? '手動指定' : (tabulated && (five - 900) % 20 ? '表 1.4・線形補間' : '表 1.4');
    return { rep, base: manual ?? tabulated?.[i] ?? null, source };
  });
  return { five, coros, tabulated, paces };
}

function interpolate(values, position) {
  const i = Math.floor(position);
  return values[i] + (position - i) * ((values[i + 1] ?? values[i]) - values[i]);
}

export function environmentalPace(base, settings) {
  const warnings = [];
  const changes = [];
  if (base === null) return { adjusted: null, changes, warnings };
  let adjusted = base;

  if (settings.hill > 0) {
    const { rows, table } = ELEVATION[settings.hillType];
    if (base < 180 || base > 360 || settings.hill > rows[0].length * 5) {
      warnings.push(`高低差が表 ${table} の範囲外です。`);
    } else {
      const row = rows[Math.round(base / 60) - 3];
      const delta = interpolate([0, ...row], settings.hill / 5);
      adjusted += delta;
      changes.push({ label: `高低差・表 ${table}`, delta });
    }
  }

  if (settings.wind > 0) {
    const { rows, table } = WIND[settings.windType];
    if (base < 180 || base > 360 || settings.wind < 10 || settings.wind > 30) {
      warnings.push(`風補正は表 ${table} の 3:00〜6:00/km、10〜30 km/h が対象です。`);
    } else {
      const delta = interpolate(rows.map((row) => interpolate(row, (settings.wind - 10) / 5)), (base - 180) / 30);
      adjusted += delta;
      changes.push({ label: `風・表 ${table}`, delta });
    }
  }

  if (settings.temp !== '' || settings.dew !== '') {
    const { temp, dew } = settings;
    const validTemp = temp === '' || (temp >= 2 && temp <= 28);
    if (!validTemp) warnings.push('気温補正は表 2.2 の 2〜28°C が対象です。');
    if (dew !== '' && temp !== '' && dew > temp) {
      warnings.push('露点が気温を上回っています。気温・露点補正を適用できません。');
    } else if (validTemp) {
      const heat = temp >= 25 ? 4 : temp >= 20 ? 2 : temp >= 15 ? 1 : 0;
      const humidity = dew >= 18 ? 4 : dew >= 15 ? 2 : dew >= 12 ? 1 : 0;
      const percent = Math.max(heat, humidity);
      const next = adjusted / (1 - percent / 100);
      changes.push({ label: `気温・露点・表 2.2（${percent}%）`, delta: next - adjusted });
      adjusted = next;
    }
  }
  return { adjusted, changes, warnings };
}

export function session({ reps, rep, rest, warmup, cooldown, pace = null, easyPace = null, jogPace = null }) {
  const sub = reps * rep * 60;
  const recovery = Math.max(0, reps - 1) * rest;
  const warmAndCool = (warmup + cooldown) * 60;
  const workDistance = pace ? sub / pace : null;
  const distance = workDistance !== null && (!warmAndCool || easyPace) && (!recovery || jogPace)
    ? workDistance + (warmAndCool ? warmAndCool / easyPace : 0) + (recovery ? recovery / jogPace : 0)
    : null;
  return { reps, rep, rest, warmup, cooldown, pace, sub, recovery, total: sub + recovery + warmAndCool, workDistance, distance };
}

const WORKOUT_DAYS = [1, 3, 5];
const AUTO_DAYS = { 4: [1, 3, 5, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const WORKOUT_TYPES = [10, 6, 3];
const MIN_EASY = 15 * 60;
const MIN_LONG = 30 * 60;
const use = (value, fallback) => value === '' ? fallback : value;
const sum = (values) => values.reduce((total, item) => total + item, 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function bookModel(minutes) {
  const guides = [255, 315, 360, 390, 420, 450, 480, 540];
  const index = guides.findIndex((guide, i) => minutes < (guide + guides[i + 1]) / 2);
  return BOOK_WEEKS[index === -1 ? guides.length - 1 : index];
}

function chooseWorkoutDays(days, longDay, count) {
  const remaining = days.filter((day) => day !== longDay);
  if (!count) return [];
  const distance = (a, b) => Math.min(Math.abs(a - b), 7 - Math.abs(a - b));
  const candidates = [[]];
  for (const day of remaining) {
    candidates.push(...candidates.filter((choice) => choice.length < count).map((choice) => [...choice, day]));
  }
  const score = (choice) => {
    const collisions = choice.flatMap((day, i) => choice.slice(i + 1).map((other) => distance(day, other) === 1 ? 1 : 0));
    const difference = sum(choice.map((day, i) => Math.abs(day - WORKOUT_DAYS[count === 2 ? i * 2 : i])));
    return sum(collisions) * 20 + difference + (choice.includes((longDay + 1) % 7) ? 2 : 0);
  };
  return candidates.filter((choice) => choice.length === count).sort((a, b) => score(a) - score(b))[0];
}

function assembleWorkout(type, reps, settings, paces = []) {
  return session({
    rep: type, reps, rest: use(settings[`rest${type}`], REST_DEFAULTS[REP_MINUTES.indexOf(type)]),
    warmup: use(settings.warmup, 10), cooldown: use(settings.cooldown, 10),
    pace: paces.find((pace) => pace.rep === type)?.adjusted ?? null,
    easyPace: settings.distancePaces?.easy, jogPace: settings.distancePaces?.jog,
  });
}

export function weeklyPlan(settings, target, model = bookModel(target / 60), progressionSub = 0, racePhase = '', subBudget = target / 4) {
  const days = settings.days.length ? [...settings.days].sort((a, b) => a - b) : AUTO_DAYS[settings.count];
  const longDay = days.at(-1);
  const autoCount = Math.min(days.length - 2, model.low ? 2 : 3);
  const requested = use(settings.sessions, autoCount);
  let workoutCount = Math.min(requested, days.length - 2);
  const warnings = [];
  if (workoutCount < requested) warnings.push('Easy とロングランの日を確保するため、Sub-T の回数を減らしました。');

  const raceCap = settings.race === 'half' ? 100 * 60 : settings.race === 'full'
    ? Math.min(180 * 60, settings.marathonEstimate ?? Infinity) : Infinity;
  const easyFixed = settings.easy === '' ? null : settings.easy * 60;
  const longFixed = settings.long === '' ? null : Math.min(settings.long * 60, raceCap);
  const longMin = Math.min(raceCap, longFixed ?? MIN_LONG);
  const double = days.length === 7 && target > 8 * 3600;
  const regularCap = double ? 85 * 60 : 75 * 60;
  const preferredLong = settings.race === 'half' ? (target >= 7 * 3600 ? 1.9 : 1.8)
    : racePhase === 'レース特化期' && target >= 6 * 3600 ? 2.15
    : racePhase === '負荷増加期' && target >= 6 * 3600 ? 1.9 : 1.7;
  const autoLongCap = days.length < 6 && settings.race !== 'full' ? Math.min(110, model.long + 15) : 110;
  const longCap = Math.min(raceCap, longFixed ?? (settings.race === 'full' ? 180 * 60 : autoLongCap * 60));
  if (settings.race === 'full' && !settings.marathonEstimate) warnings.push('予想完走時間が空欄のため、フルのロングラン上限は180分を使用します。');
  if (settings.long !== '' && settings.long * 60 > raceCap) warnings.push('指定したロングランをレース別の上限まで短縮しました。');

  const paces = settings.paces ?? [];
  let workoutDays;
  let workouts;
  let budget;
  while (true) {
    workoutDays = chooseWorkoutDays(days, longDay, workoutCount);
    const types = workoutCount === 3 ? WORKOUT_TYPES : workoutCount === 2 ? [10, 3] : [6];
    let extra = progressionSub;
    const increases = new Map();
    for (const type of [...types].sort((a, b) => a - b)) {
      const sourceReps = model.workouts[WORKOUT_TYPES.indexOf(type)][0];
      const limit = Math.max(0, Math.floor(42 / type) - sourceReps);
      const reps = Math.min(limit, Math.floor(extra / (type * 60)));
      increases.set(type, reps);
      extra -= reps * type * 60;
    }
    workouts = workoutDays.map((day, i) => {
      const type = types[i];
      const sourceReps = model.workouts[WORKOUT_TYPES.indexOf(type)][0];
      const reps = clamp(sourceReps + increases.get(type), 1, Math.floor(42 / type));
      return { day, ...assembleWorkout(type, reps, settings, paces) };
    });
    budget = Math.max(0, target - (longFixed ?? longMin) - (days.length - workoutCount - 1) * (easyFixed ?? MIN_EASY));
    while (sum(workouts.map((item) => item.total)) > budget || sum(workouts.map((item) => item.sub)) > subBudget) {
      const reducible = workouts.filter((item) => item.reps > 1).sort((a, b) => b.sub - a.sub)[0];
      if (!reducible) break;
      Object.assign(reducible, assembleWorkout(reducible.rep, reducible.reps - 1, settings, paces));
    }
    if (!workoutCount || (sum(workouts.map((item) => item.total)) <= budget && sum(workouts.map((item) => item.sub)) <= subBudget)) break;
    workoutCount -= 1;
  }
  if (workoutCount < Math.min(requested, days.length - 2)) warnings.push('時間枠に収まるよう Sub-T の回数を減らしました。');
  const easyDays = days.filter((day) => day !== longDay && !workoutDays.includes(day));
  const available = target - sum(workouts.map((item) => item.total));
  const easyMin = Math.min(MIN_EASY, easyFixed ?? MIN_EASY, Math.floor((available - 1) / easyDays.length));
  const longUpper = Math.min(longCap, available - easyMin * easyDays.length);
  const longLower = Math.min(longMin, longUpper);
  let easy = easyFixed ?? Math.round((available - (longFixed ?? 0)) / (easyDays.length + (longFixed === null ? preferredLong : 0)));
  easy = clamp(easy, easyMin, regularCap);
  let long = clamp(longFixed ?? Math.round(easy * preferredLong), longLower, longUpper);
  if (easyFixed === null && longFixed === null) {
    const spare = available - long - easy * easyDays.length;
    long += clamp(spare, longLower - long, longUpper - long);
  }
  const availableEasy = Math.max(0, available - long);
  let easyLeft = availableEasy;
  const durations = easyDays.map((_, index) => {
    const share = Math.floor(easyLeft / (easyDays.length - index));
    const duration = clamp(easyFixed ?? share, 0, Math.min(regularCap, share));
    easyLeft -= duration;
    return duration;
  });
  const calendar = WEEKDAYS.map((_, day) => {
    const workout = workouts.find((item) => item.day === day);
    const duration = durations[easyDays.indexOf(day)] ?? 0;
    if (workout) return { ...workout, kind: 'sub' };
    if (day === longDay) return { day, kind: 'long', total: long, long };
    if (duration) return { day, kind: 'easy', total: duration, ...(double && duration > 60 * 60 ? { double: true } : {}) };
    return { day, kind: 'rest', total: 0 };
  });
  if (longFixed !== null && long !== longFixed) warnings.push('時間枠に合わせてロングランの指定を調整しました。');
  if (easyFixed !== null && durations.some((duration) => duration !== easyFixed)) warnings.push('時間枠または1日あたりの上限に合わせて Easy の指定を調整しました。');
  if (easyLeft >= 60) warnings.push('練習日数、指定時間、1日あたりの上限により、週間目標の一部を配分できませんでした。');
  else if (easyLeft > 0) warnings.push('練習時間の指定により、週間目標に未配分時間があります。');
  if (double) warnings.push('週8時間超は、書籍の9時間例を参考に、60分を超える Easy を朝夕に分けます。');
  if (workoutDays.some((day) => workoutDays.includes((day + 1) % 7))) warnings.push('選択した曜日では Sub-T が連続します。');
  return summarize(calendar, target, model.table, warnings);
}

function summarize(calendar, target, table, warnings) {
  const total = sum(calendar.map((item) => item.total));
  const sub = sum(calendar.map((item) => item.sub ?? 0));
  return {
    calendar, total, target, sub, easy: total - sub, long: sum(calendar.map((item) => item.long ?? 0)),
    rest: calendar.filter((item) => item.kind === 'rest').length,
    shortfall: Math.max(0, target - total), table, warnings,
  };
}

function dayNumber(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}を入力してください。`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error(`${label}を確認してください。`);
  return time / DAY;
}

const dateString = (day) => new Date(day * DAY).toISOString().slice(0, 10);
const weekday = (day) => ((day + 3) % 7 + 7) % 7;
const TAPER_DAYS = { '5k': 3, '10k': 6, half: 6, full: 10 };

function phaseOf(settings, index, total, taper, recovery) {
  if (taper) return 'テーパリング';
  if (recovery) return '回復週';
  if (settings.race !== 'full') return index ? '継続期' : '基準週';
  if (index < Math.ceil(total * 4 / 15)) return '基礎期';
  return index < Math.ceil(total * 8 / 15) ? '負荷増加期' : 'レース特化期';
}

function taperDay(item, settings, daysToRace) {
  const window = TAPER_DAYS[settings.race];
  if (daysToRace === 0) return { ...item, kind: 'race', total: 0, sub: 0, long: 0 };
  if (daysToRace > window || item.kind === 'rest') return item;
  const ratio = settings.race === 'full' ? (daysToRace > 6 ? 0.75 : 0.55) : daysToRace > 3 ? 0.85 : 0.65;
  if (item.kind === 'sub' && daysToRace >= 3 && (settings.race !== 'full' || daysToRace >= 4)) {
    const shortened = assembleWorkout(item.rep, Math.max(1, Math.floor(item.reps * ratio)), settings, settings.paces);
    return { ...item, ...shortened };
  }
  const total = Math.min(Math.round(item.total * ratio), item.kind === 'easy' ? Infinity : 45 * 60);
  return { day: item.day, date: item.date, kind: 'easy', total };
}

export function trainingPlan(settings, today = localDate()) {
  const requested = use(settings.weeks, settings.race === 'full' ? 15 : 12);
  const dated = settings.race !== 'general' && settings.ends !== '';
  const starts = dayNumber(settings.starts || today, '計画開始日');
  const end = dated ? dayNumber(settings.ends, 'レース日') : starts + requested * 7 - 1;
  if (end < starts) throw new Error('レース日は計画開始日以降に設定してください。');
  const first = dated ? Math.max(starts, end - requested * 7 + 1) : starts;
  const weeks = Math.ceil((end - first + 1) / 7);
  const blockStart = end - weeks * 7 + 1;
  const base = Math.round(use(settings.hours, 5) * 3600);
  const model = bookModel(base / 60);
  const warnings = [];
  if (dated && first > starts) warnings.push(`レース日から${requested}週を逆算して開始日を調整しました。`);
  if (dated && weeks < requested) warnings.push(`レース日までの期間に合わせて${weeks}週を表示します。`);
  const result = [];
  for (let i = 0; i < weeks; i += 1) {
    const custom = settings.mode === 'custom';
    const hold = custom ? use(settings.hold, 4) : 4;
    const interval = custom ? use(settings.interval, 3) : 3;
    const steps = settings.mode === 'maintain' || i < hold ? 0 : 1 + Math.floor((i - hold) / interval);
    const durationIncrease = steps * (custom ? use(settings.increment, 15) : 15) * 60;
    const regularTarget = Math.min(9 * 3600, base + durationIncrease);
    const subIncrease = (regularTarget - base) * (custom ? use(settings.subShare, 20) : 20) / 100;
    const recovery = custom && settings.recoveryEvery > 0 && (i + 1) % settings.recoveryEvery === 0 && i >= hold;
    const target = recovery ? Math.round(regularTarget * (1 - use(settings.recoveryCut, 20) / 100)) : regularTarget;
    const start = blockStart + i * 7;
    const fullSample = !dated && settings.race === 'full';
    const taper = (dated || fullSample) && end + Number(fullSample) - (start + 6) <= TAPER_DAYS[settings.race];
    const phase = phaseOf(settings, i, weeks, taper, recovery);
    const subBudget = recovery ? target / 4 : base / 4 + subIncrease;
    const weekly = weeklyPlan(settings, target, model, recovery ? 0 : subIncrease, phase, subBudget);
    const calendar = Array.from({ length: 7 }, (_, offset) => {
      const day = start + offset;
      const index = weekday(day);
      if (day < first) return { day: index, date: dateString(day), total: 0, kind: 'outside' };
      const item = { ...weekly.calendar[index], date: dateString(day) };
      if (dated) return taperDay(item, settings, end - day);
      if (fullSample) return taperDay(item, settings, end + 1 - day);
      return item;
    });
    const adjusted = taper || start < first;
    const total = sum(calendar.map((item) => item.total));
    const plan = summarize(calendar, adjusted ? total : target, model.table, weekly.warnings);
    const previous = result.at(-1)?.total;
    const change = previous === undefined ? null : plan.total - previous;
    const changeRate = change === null || !previous ? null : change / previous;
    if (changeRate > 0.10) plan.warnings.push('前週比が10%を超えています。アプリの確認目安です。');
    result.push({ ...plan, index: i + 1, phase, taper, recovery, change, changeRate, plannedTarget: target });
  }
  return { weeks: result, warnings, sample: settings.hours === '', dated };
}

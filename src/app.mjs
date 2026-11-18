import { BOOK_WEEKS, REP_MINUTES } from './reference.mjs';
import { DEFAULTS, RACES, WEEKDAYS, clock, environmentalPace, localDate, paceInputs, parseClock, session, trainingPlan } from './engine.mjs';

const $ = (id) => document.getElementById(id);
const form = $('planner-form');
const storageKey = 'sub-t-planner-v1';
const options = (values) => Object.entries(values).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
const number = (name, label, min, max, placeholder = '自動', step = '1') =>
  ({ name, label, min, max, placeholder, step, type: 'number' });
const time = (name, label, placeholder) => ({ name, label, placeholder, type: 'text' });
const date = (name, label) => ({ name, label, type: 'date', full: true });
const select = (name, label, values) => ({ name, label, values, type: 'select', full: true });
const fields = [
  { title: '週間練習', fields: [
    number('hours', '週間練習時間（h）', 4, 9, '例 5', 'any'), number('count', '練習日数', 4, 7),
    number('easy', 'Easy（分）', 10, 120), number('long', 'ロングラン（分）', 20, 180),
    number('sessions', 'Sub-T 回数', 0, 3),
  ], days: true },
  { title: 'レースと期間', fields: [
    select('race', '目標レース', RACES), date('starts', '計画開始日'), date('ends', 'レース日'),
    number('weeks', '計画期間（週）', 8, 16, '12'),
    { ...time('expected', 'フル予想完走時間（分:秒）', '210:00'), full: true, condition: 'full' },
  ] },
  { title: '負荷増加', fields: [select('mode', '負荷増加方式', { standard: '標準', custom: 'カスタム', maintain: '維持' })] },
  { title: '増加と回復の設定', condition: 'custom', fields: [
    number('hold', '最初の維持（週）', 0, 16), number('interval', '増加間隔（週）', 1, 16),
    number('increment', '増加量（分）', 0, 120), number('subShare', '増加分の Sub-T（%）', 0, 100),
    number('recoveryEvery', '回復週の間隔（0＝なし）', 0, 16), number('recoveryCut', '回復週の削減（%）', 5, 50),
  ] },
  { title: 'ペース・心拍・休息', fields: [
    ...REP_MINUTES.flatMap((rep, i) => [
      time(`pace${rep}`, `${rep}分反復ペース`, '分:秒 /km'),
      number(`rest${rep}`, `${rep}分反復の休息（秒）`, 0, 600, String([60, 75, 105][i])),
    ]),
    time('easyPace', 'WU・CD ペース', '分:秒 /km'), time('jogPace', '休息ジョグペース', '分:秒 /km'),
    number('warmup', 'WU（分）', 0, 60, '10'), number('cooldown', 'CD（分）', 0, 60, '10'),
    number('lthr', 'COROS 閾値心拍数', 60, 250, 'bpm'), number('maxHr', '最大心拍数', 60, 250, 'bpm'),
  ] },
  { title: '環境補正', fields: [
    number('temp', '気温（°C）', -50, 70, '未設定', 'any'), number('dew', '露点（°C）', -60, 70, '未設定', 'any'),
    select('windType', '風向', { loop: '往復の向かい風・追い風', head: '向かい風', tail: '追い風', cross: '往復の横風' }),
    number('wind', '風速（km/h）', 0, 150, '未設定', 'any'),
    select('hillType', '高低差の種類', { loop: '往復・周回', uphill: '上りのみ', downhill: '下りのみ' }),
    number('hill', '高低差（m/km）', 0, 400, '未設定', 'any'),
  ] },
];

$('setting-fields').innerHTML = fields.map((group) => `
  <fieldset ${group.condition ? `data-condition="${group.condition}"` : ''}><legend>${group.title}</legend>
  <div class="field-grid">${group.fields.map((item) => `
    <label class="field ${item.full ? 'span' : ''}" ${item.condition ? `data-condition="${item.condition}"` : ''}>${item.label}
    ${item.type === 'select' ? `<select name="${item.name}">${options(item.values)}</select>` :
      `<input name="${item.name}" type="${item.type}" placeholder="${item.placeholder ?? ''}"
        ${item.type === 'number' ? `min="${item.min}" max="${item.max}" step="${item.step}"` : ''}
        ${item.type === 'text' ? 'maxlength="9"' : ''}>`}
    </label>`).join('')}
  ${group.days ? `<div class="span field"><span>練習可能な曜日</span><div class="checks">
    ${WEEKDAYS.map((name, i) => `<label>${name}<input type="checkbox" name="days" value="${i}"></label>`).join('')}
    </div><small>未選択で自動配置。指定する場合は練習日数と同じ数を選択。</small></div>` : ''}
  </div></fieldset>`).join('');

const descriptors = fields.flatMap((group) => group.fields);
const parseOptionalPace = (value) => parseClock(value, { min: 2, max: 30, optional: true });

function clean(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('設定の形式を確認してください。');
  const result = { ...DEFAULTS };
  for (const key of ['five', 'coros']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > 9) throw new Error('走力入力の形式を確認してください。');
      result[key] = input[key].trim();
    }
  }
  for (const field of descriptors) {
    const value = input[field.name];
    if (value === undefined) continue;
    if (field.type === 'number') {
      if (value === '') continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max
        || (field.step === '1' && !Number.isInteger(value))) {
        throw new Error(`${field.label}　${field.min}〜${field.max} の範囲で入力してください。`);
      }
    } else if (field.type === 'select') {
      if (!Object.hasOwn(field.values, value)) throw new Error(`${field.label}の設定を確認してください。`);
    } else if (typeof value !== 'string' || value.length > (field.type === 'date' ? 10 : 9)) {
      throw new Error(`${field.label}の形式を確認してください。`);
    }
    result[field.name] = typeof value === 'string' ? value.trim() : value;
  }
  if (input.days !== undefined) {
    if (!Array.isArray(input.days) || input.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      || new Set(input.days).size !== input.days.length) throw new Error('練習曜日の設定を確認してください。');
    result.days = input.days;
  }
  return result;
}

function collect() {
  const data = new FormData(form);
  const raw = Object.fromEntries(data.entries());
  for (const { name, type } of descriptors) {
    if (type === 'number' && raw[name] !== undefined && raw[name] !== '') raw[name] = Number(raw[name]);
  }
  raw.days = data.getAll('days').map(Number);
  return clean(raw);
}

function setFields(settings) {
  for (const [name, value] of Object.entries(settings)) {
    if (name !== 'days') form.elements.namedItem(name).value = value;
  }
  for (const checkbox of form.querySelectorAll('[name="days"]')) checkbox.checked = settings.days.includes(+checkbox.value);
  syncForm();
}

function syncForm() {
  const isFull = form.elements.race.value === 'full';
  const isCustom = form.elements.mode.value === 'custom';
  for (const element of form.querySelectorAll('[data-condition]')) {
    element.hidden = element.dataset.condition === 'full' ? !isFull : !isCustom;
    for (const input of element.querySelectorAll('input,select')) input.disabled = element.hidden;
  }
  form.elements.weeks.placeholder = isFull ? '15' : '12';
  form.elements.starts.setAttribute('aria-description', `空欄の場合は今日（${localDate()}）`);
}

function announce(message, error = false) {
  $('message').textContent = message;
  $('message').classList.toggle('error', error);
}

const paceLabel = (value) => value === null ? '—' : `${clock(value)}/km`;
const min = (value) => value % 60 ? `${Math.floor(value / 60)}分${value % 60}秒` : `${value / 60}分`;
const deltaLabel = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${min(Math.abs(value))}`;
const rate = (value) => value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
const distance = (value) => value === null ? '—' : `${value.toFixed(2)} km`;
const notes = (messages = []) => [...new Set(messages)].map((message) => `<p class="note warning">${message}</p>`).join('');
const kindName = { easy: 'Easy', long: 'ロング', sub: 'Sub-T', rest: '休養', outside: '期間外', race: 'レース' };

let model;
let selectedWeek = 0;

function calculate(settings, allowEmpty = false) {
  if (settings.days.length && settings.days.length !== settings.count) throw new Error('練習日数と選択した曜日の数をそろえてください。');
  if (settings.lthr && settings.maxHr && settings.lthr > settings.maxHr) throw new Error('閾値心拍数は最大心拍数以下に設定してください。');
  const hasPace = settings.five || settings.coros;
  const input = !hasPace && allowEmpty
    ? { five: null, coros: null, tabulated: null, paces: REP_MINUTES.map((rep) => ({ rep, base: null })) }
    : paceInputs(settings);
  const paces = input.paces.map((pace) => ({ ...pace, ...environmentalPace(pace.base, settings) }));
  const easy = parseOptionalPace(settings.easyPace);
  const jog = parseOptionalPace(settings.jogPace);
  const marathonEstimate = settings.race === 'full'
    ? parseClock(settings.expected, { min: 100, max: 900, optional: true })
    : null;
  const normalized = { ...settings, paces, marathonEstimate, distancePaces: { easy, jog } };
  const plan = trainingPlan(normalized);
  return { input, paces, settings: normalized, plan };
}

function renderPaces() {
  const { input, paces, settings, plan } = model;
  const { five, coros, tabulated } = input;
  $('pace-status').textContent = paces.some((pace) => pace.base !== null) ? 'ペース算出済み' : coros ? 'COROS 閾値を表示' : five ? '表の範囲外' : '入力待ち';
  const metrics = [];
  if (five !== null) metrics.push(`<span>5 km 実績 <strong>${clock(five)}</strong>（平均 ${paceLabel(five / 5)}）</span>`);
  if (coros) metrics.push(`<span>COROS 閾値ペース <strong>${paceLabel(coros.thresholdSeconds)}</strong></span>`);
  const warnings = paces.flatMap((pace) => pace.warnings);
  if (five !== null && !tabulated) warnings.push('5 km タイムが表 1.4 の15:00〜30:00の範囲外です。手動ペースを指定できます。');
  if (coros) warnings.push('COROS 閾値ペースは機器の推定値です。Sub-T への換算根拠は未確定です。');
  const starters = [8, 5, 3];
  const examples = paces.map((pace, i) => {
    const planned = plan.weeks[selectedWeek].calendar.find((day) => day.kind === 'sub' && day.rep === pace.rep);
    const { rep } = pace;
    return planned ?? session({
      rep, reps: starters[i], rest: settings[`rest${rep}`], warmup: settings.warmup, cooldown: settings.cooldown,
      pace: pace.adjusted, easyPace: settings.distancePaces.easy, jogPace: settings.distancePaces.jog,
    });
  });
  $('pace-output').innerHTML = `
    <div class="pace-grid">${paces.map((pace) => `
      <article class="pace-tile">
        <h3>${pace.rep} 分反復</h3>
        <p class="pace-number">${clock(pace.adjusted)}${pace.adjusted === null ? '' : '<small> /km</small>'}</p>
        <p>${pace.base === null ? 'ペース未設定' : pace.source}
           ${pace.changes.length ? ` · 基準 ${paceLabel(pace.base)}` : ''}</p>
      </article>`).join('')}</div>
    ${metrics.length ? `<div class="inputs-comp">${metrics.join('')}</div>` : '<p class="note">走力を入力するとペースを確認できます。</p>'}
    ${notes(warnings)}
    ${settings.lthr ? `<p class="note">心拍の目安（書籍）　序盤 ${settings.lthr - 15}〜${settings.lthr - 10} bpm。終盤は LTHR ${settings.lthr} bpm 未満。</p>` : ''}
    ${settings.maxHr ? `<p class="note">Easy の平均心拍の目安（書籍）　最大心拍数の70%以下（${Math.floor(settings.maxHr * .7)} bpm）。</p>` : ''}
    <details class="data"><summary>おすすめインターバルと所要時間</summary>
      <p class="note">選択週にない反復種別は独立したセッション例です。</p>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">反復</th><th scope="col">ペース</th><th scope="col">間の休息</th><th scope="col">Sub-T</th><th scope="col">総時間</th><th scope="col">反復距離</th><th scope="col">全体距離</th></tr></thead>
        <tbody>${examples.map((item) => `<tr><th scope="row">${item.reps} × ${item.rep}分</th><td>${paceLabel(item.pace)}</td>
        <td>${item.reps > 1 ? `${item.rest}秒` : '—'}</td><td>${min(item.sub)}</td><td>${min(item.total)}</td>
        <td>${distance(item.workDistance)}</td><td>${distance(item.distance)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">WU ${settings.warmup}分・CD ${settings.cooldown}分。反復距離は反復の合計です。</p>
      ${paces.filter((pace) => pace.changes.length).map((pace) => `<p class="note">${pace.rep}分反復　${pace.changes.map(({ label, delta }) => `${label} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}秒/km`).join(' ／ ')}</p>`).join('')}
    </details>`;
}

function renderWeek() {
  const { plan, settings } = model;
  const week = plan.weeks[selectedWeek];
  const sub = week.total ? +(week.sub / week.total * 100).toFixed(1) : 0;
  const easy = week.total ? +(100 - sub).toFixed(1) : 0;
  $('week-picker').value = selectedWeek;
  $('calendar-output').innerHTML = `
    <dl class="metrics">
      <div><dt>練習合計</dt><dd>${min(week.total)}</dd></div>
      <div><dt>Easy / Sub-T</dt><dd>${easy}% / ${sub}%</dd></div>
      <div><dt>ロングラン</dt><dd>${min(week.long)}</dd></div>
      <div><dt>休養</dt><dd>${week.rest} 日</dd></div>
    </dl>
    <ol class="calendar">${week.calendar.map((item) => `<li class="cal-day ${item.kind}">
      <div class="day-label">${item.date.slice(5).replace('-', '/')}（${WEEKDAYS[item.day]}）</div>
      <strong class="kind">${kindName[item.kind]}</strong>
      ${item.total ? `<div class="day-duration">${min(item.total)}</div>` : ''}
      ${item.kind === 'sub' ? `<div class="day-menu">${item.reps} × ${item.rep}分${item.pace ? `<br>${paceLabel(item.pace)}` : ''}</div>` : ''}
      ${item.double ? `<div class="day-menu">朝 ${min(Math.floor(item.total / 120) * 60)}<br>夕 ${min(item.total - Math.floor(item.total / 120) * 60)}</div>` : ''}
      ${item.kind === 'race' ? `<div class="day-menu">${RACES[settings.race]}</div>` : ''}
    </li>`).join('')}</ol>
    <p class="note">${plan.sample ? 'サンプル（開始時の週間練習量を5時間と仮定）' : '入力した週間練習量を起点に作成'} · アプリ自動計画（表 ${week.table} 参照）</p>
    <p class="note">${week.phase}${week.change === null ? '' : ` · 前週比 ${deltaLabel(week.change)}（${rate(week.changeRate)}）`}
      ${week.shortfall ? ` · 目標 ${min(week.target)}、未配分 ${min(week.shortfall)}` : ''}</p>
    ${notes(week.warnings)}`;
}

function renderProgress() {
  const { plan, settings } = model;
  const max = Math.max(60, ...plan.weeks.map((week) => week.total));
  const chart = plan.weeks.map((week, i) => {
    const bars = ['total', 'sub', 'long'].map((key) => `<i aria-hidden="true" class="bar ${key}-bar" style="height:${week[key] / max * 100}%"></i>`).join('');
    const detail = `第${week.index}週 ${week.phase}　合計 ${min(week.total)}、Sub-T ${min(week.sub)}、ロング ${min(week.long)}`;
    return `<button type="button" data-week="${i}" ${week.taper ? 'data-taper' : ''} title="${detail}" aria-label="${detail}" aria-pressed="${selectedWeek === i}"><span class="columns">${bars}</span><b>${week.index}</b></button>`;
  }).join('');
  $('progress-output').innerHTML = `
    <p class="note">${RACES[settings.race]} · ${plan.weeks.length}週 · ${plan.dated ? `レース日 ${settings.ends}` : '日程サンプル'}</p>
    <div class="chart" role="group" aria-label="練習時間の推移。週を選択すると週間プランが切り替わります。">${chart}</div>
    <div class="legend"><span><i class="total-bar"></i>総時間</span><span><i class="sub-bar"></i>Sub-T</span><span><i class="long-bar"></i>ロングラン</span>${plan.weeks.some((week) => week.taper) ? '<span><i class="taper-bar"></i>テーパリング</span>' : ''}</div>
    ${notes(plan.warnings)}
    <details class="data"><summary>週ごとの時間と増加ポイント</summary>
      <div class="table-wrap"><table><thead><tr><th scope="col">週</th><th scope="col">期間</th><th scope="col">総時間</th><th scope="col">Sub-T</th><th scope="col">ロング</th><th scope="col">前週比</th><th scope="col">フェーズ</th></tr></thead>
      <tbody>${plan.weeks.map((week) => `<tr><th scope="row">${week.index}</th><td>${week.calendar.find((item) => item.kind !== 'outside').date}〜${week.calendar.at(-1).date.slice(5)}</td>
        <td>${min(week.total)}</td><td>${min(week.sub)}</td><td>${min(week.long)}</td><td>${week.change === null ? '—' : `${deltaLabel(week.change)}（${rate(week.changeRate)}）`}</td>
        <td>${week.phase}${week.changeRate > 0.10 ? ' · 増加幅を確認' : ''}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function show() {
  $('week-picker').replaceChildren(...model.plan.weeks.map((week, i) => new Option(`第${week.index}週`, i)));
  renderPaces();
  renderWeek();
  renderProgress();
}

function selectWeek(index) {
  selectedWeek = index;
  renderPaces();
  renderWeek();
  for (const button of $('progress-output').querySelectorAll('[data-week]')) {
    button.setAttribute('aria-pressed', String(+button.dataset.week === index));
  }
}

function renderBook(index) {
  const week = BOOK_WEEKS[index];
  $('book-output').innerHTML = `<p class="note">書籍の掲載例 · 表 ${week.table} · ${week.label}</p>
    <div class="table-wrap"><table><thead><tr><th scope="col">曜日</th><th scope="col">メニュー</th><th scope="col">掲載時間（分）</th></tr></thead>
    <tbody>${WEEKDAYS.map((name, i) => {
      const workout = week.workouts[[1, 3, 5].indexOf(i)];
      const label = workout ? `${workout[0]} × ${workout[1]}分${week.low && i === 1 ? '・推定マラソンペースの95%強度（書籍表記）' : ''}`
        : week.minutes[i] === 0 ? '休養' : i === 6 ? (week.double ? '朝ロング／夕 Easy' : 'ロングラン') : 'Easy';
      return `<tr><th scope="row">${name}</th><td>${label}</td><td>${week.minutes[i] || '—'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="note">時間は表の記載値です。週タイトルの目安と日別時間の合計は異なる場合があります。</p>`;
}

function store(settings) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const settings = collect();
    model = calculate(settings);
    selectedWeek = 0;
    show();
    announce(store(settings) ? '計算して設定を保存しました。' : '計算しました。ブラウザの保存を利用できません。');
    if (matchMedia('(max-width: 730px)').matches) $('paces').focus();
  } catch (error) {
    announce(error.message, true);
  }
});

// Reveal native validation errors even when their field is in the closed settings panel.
form.addEventListener('invalid', (event) => {
  const details = event.target.closest('details');
  if (details) details.open = true;
}, true);
form.addEventListener('change', syncForm);
$('week-picker').addEventListener('change', (event) => selectWeek(+event.target.value));
$('progress-output').addEventListener('click', (event) => {
  const button = event.target.closest('[data-week]');
  if (button) selectWeek(+button.dataset.week);
});
$('book-picker').replaceChildren(...BOOK_WEEKS.map((week, i) => new Option(week.label, i)));
$('book-picker').value = 1;
$('book-picker').addEventListener('change', (event) => renderBook(+event.target.value));
renderBook(1);

$('json-out').addEventListener('click', () => {
  try {
    download('sub-t-settings.json', JSON.stringify({ version: 1, settings: collect() }, null, 2), 'application/json');
  } catch (error) {
    announce(error.message, true);
  }
});
$('json-in').addEventListener('click', () => $('upload').click());
$('upload').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('設定ファイルが大きすぎます。');
    const data = JSON.parse(await file.text());
    if (data?.version !== 1) throw new Error('設定ファイルのバージョンを確認してください。');
    const settings = clean(data.settings);
    const updated = calculate(settings, true);
    setFields(settings);
    model = updated;
    selectedWeek = 0;
    show();
    announce(store(settings) ? '設定を読み込んで保存しました。' : '設定を読み込みました。ブラウザの保存を利用できません。');
  } catch (error) {
    announce(`読み込めませんでした。 ${error instanceof SyntaxError ? 'JSON を確認してください。' : error.message}`, true);
  } finally {
    event.target.value = '';
  }
});
$('reset').addEventListener('click', () => {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Reset the current page even if storage is disabled.
  }
  setFields(DEFAULTS);
  model = calculate(DEFAULTS, true);
  selectedWeek = 0;
  show();
  announce('設定を初期化しました。');
});
$('csv').addEventListener('click', () => {
  const rows = [['週', '日付', '曜日', 'フェーズ', 'メニュー', '所要秒', 'Sub-T秒', 'ロングラン秒', '反復回数', '1反復分', '休息秒', 'ペース秒/km', '週間合計秒', '前週差秒', '前週比%']];
  for (const week of model.plan.weeks) {
    for (const day of week.calendar.filter((item) => item.kind !== 'outside')) {
      const sub = day.kind === 'sub';
      rows.push([week.index, day.date, WEEKDAYS[day.day], week.phase, kindName[day.kind], day.total, day.sub ?? 0,
        day.long ?? 0, sub ? day.reps : '', sub ? day.rep : '', sub ? day.rest : '',
        sub && day.pace ? Math.round(day.pace) : '', week.total, week.change ?? '',
        week.changeRate === null ? '' : (week.changeRate * 100).toFixed(1)]);
    }
  }
  download('sub-t-training-plan.csv', '\ufeff' + rows.map((row) => row.join(',')).join('\r\n'), 'text/csv;charset=utf-8');
});
$('print').addEventListener('click', () => {
  const closed = [...document.querySelectorAll('.results details:not([open])')];
  closed.forEach((item) => { item.open = true; });
  window.print();
  closed.forEach((item) => { item.open = false; });
});

try {
  const saved = localStorage.getItem(storageKey);
  const settings = saved ? clean(JSON.parse(saved)) : DEFAULTS;
  model = calculate(settings, true);
  setFields(settings);
} catch {
  model = calculate(DEFAULTS, true);
  setFields(DEFAULTS);
  announce('保存済みの設定を読み込めなかったため、初期値を表示しています。', true);
}
show();
$('calculate').disabled = false;

import { BOOK_WEEKS, REP_MINUTES } from './reference.mjs';
import { DEFAULTS, PACE_MODES, RACES, WEEKDAYS, clock, corosPaceAlert, easyRunGuide, environmentalPace, localDate, paceInputs, parseClock, session, trainingPlan } from './engine.mjs';
import { CROSS_LABELS, CYCLING_MODES, CYCLING_WEEKS, INTENSITIES, CrossTrainingError, cyclingWatts } from './cross-training.mjs';

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
    number('hours', '週間ランニング時間（h）', 4, 9, '例 5', 'any'), number('count', 'ランニング日数', 4, 7),
    number('easy', 'Easy（分）', 10, 120), number('long', 'ロングラン（分）', 20, 180),
    number('sessions', 'Sub-T 回数', 0, 3),
  ], days: 'days' },
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
  { title: 'COROS 閾値ペースの推定', fields: [
    number('riegelMinutes', '想定持続時間（分）', 5, 240, '60', 'any'),
    number('riegelExponent', 'Riegel 指数', 1, 2, '1.06', 'any'),
  ] },
  { title: 'ペース・心拍・休息', fields: [
    ...REP_MINUTES.map((rep, i) => number(`rest${rep}`, `${rep}分反復の休息（秒）`, 0, 600, String([60, 75, 105][i]))),
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
const crossFields = [
  { title: 'サイクリング', enabled: 'cyclingEnabled', fields: [
    select('cyclingPlan', 'サイクリングの計画元', CYCLING_MODES),
    number('cyclingFtp', 'FTP（W・任意）', 1, 2000, '例 200'),
    { ...number('cyclingMinutes', '1回の時間（分）', 1, 600, '未登録'), condition: 'cycling-custom' },
    { ...select('cyclingIntensity', '運動強度', INTENSITIES), condition: 'cycling-custom' },
  ], days: 'cyclingDays', dayCondition: 'cycling-custom',
  help: 'Week A・B はサイクリングの行を固定予定に追加します。<a href="#cycling-reference">書籍の週例とFTPの目安</a>' },
  { title: 'その他のトレーニング', enabled: 'otherEnabled', fields: [
    number('otherMinutes', '1回の時間（分）', 1, 600, '未登録'),
    number('otherFrequency', '週間実施回数', 0, 7, '曜日数'),
    select('otherIntensity', '運動強度', INTENSITIES),
    { name: 'otherNote', label: 'メモ（任意）', type: 'textarea', full: true },
  ], days: 'otherDays', help: '1日1回。実施回数を指定する場合は選択曜日数とそろえてください。空欄なら自動で数えます。' },
];
const dayFields = ['days', 'cyclingDays', 'otherDays'];
const conditional = (value) => value ? `data-condition="${value}"` : '';

function renderFields(groups) {
  return groups.map((group) => `
  <fieldset ${conditional(group.condition)}><legend>${group.title}</legend>
  ${group.enabled ? `<label class="cross-toggle"><input type="checkbox" name="${group.enabled}"> ${group.title}を計画に含める</label>` : ''}
  <div class="field-grid" ${group.enabled ? `data-cross-fields="${group.enabled}"` : ''}>${group.fields.map((item) => `
    <label class="field ${item.full ? 'span' : ''}" ${conditional(item.condition)}>${item.label}
    ${item.type === 'select' ? `<select name="${item.name}">${options(item.values)}</select>` :
      item.type === 'textarea' ? `<textarea name="${item.name}" rows="2" maxlength="300"></textarea>` :
      `<input name="${item.name}" type="${item.type}" placeholder="${item.placeholder ?? ''}"
        ${item.type === 'number' ? `min="${item.min}" max="${item.max}" step="${item.step}"` : ''}
        ${item.type === 'text' ? 'maxlength="9"' : ''}>`}
    </label>`).join('')}
  ${group.days ? `<div class="span field" ${conditional(group.dayCondition)}><span>${group.days === 'days' ? '練習可能な曜日' : '実施曜日'}</span><div class="checks">
    ${WEEKDAYS.map((name, i) => `<label>${name}<input type="checkbox" name="${group.days}" value="${i}"></label>`).join('')}
    </div>${group.days === 'days' ? '<small>未選択で自動配置。指定する場合はランニング日数と同じ数を選択。</small>' : ''}</div>` : ''}
  ${group.help ? `<p class="span note">${group.help}</p>` : ''}
  </div></fieldset>`).join('');
}

$('setting-fields').innerHTML = renderFields(fields);
$('cross-fields').innerHTML = renderFields(crossFields);

const descriptors = [
  select('paceMode', 'ペース計算方式', PACE_MODES),
  time('five', '5 km タイム'),
  time('coros', 'COROS 閾値ペース'),
  number('alertFast', '速い側の許容幅（秒/km）', 0, 60, '5', 'any'),
  number('alertSlow', '遅い側の許容幅（秒/km）', 0, 60, '10', 'any'),
  ...REP_MINUTES.map((rep) => time(`pace${rep}`, `${rep}分反復ペース`)),
  ...fields.flatMap((group) => group.fields),
  ...crossFields.flatMap((group) => group.fields.map((field) => ({ ...field, enabled: group.enabled }))),
];
const parseOptionalPace = (value) => parseClock(value, { min: 2, max: 30, optional: true });

function clean(input, fallback = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('設定の形式を確認してください。');
  const result = { ...DEFAULTS };
  for (const { enabled } of crossFields) {
    if (input[enabled] === undefined) continue;
    if (typeof input[enabled] !== 'boolean') throw new Error('クロストレーニングの有効設定を確認してください。');
    result[enabled] = input[enabled];
  }
  for (const field of descriptors) {
    const value = input[field.name];
    if (value === undefined) continue;
    let issue = '';
    if (field.type === 'number') {
      if (value === '') continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max
        || (field.step === '1' && !Number.isInteger(value))) {
        issue = `${field.label}　${field.min}〜${field.max} の範囲で入力してください。`;
      }
    } else if (field.type === 'select') {
      if (!Object.hasOwn(field.values, value)) issue = `${field.label}の設定を確認してください。`;
    } else if (typeof value !== 'string' || value.length > ({ date: 10, textarea: 300 }[field.type] ?? 9)) {
      issue = `${field.label}の形式を確認してください。`;
    }
    if (issue) {
      if (!field.enabled || result[field.enabled]) throw new Error(issue);
      result[field.name] = fallback[field.name];
      continue;
    }
    result[field.name] = typeof value === 'string' ? value.trim() : value;
  }
  if (input.paceMode === undefined) {
    if (REP_MINUTES.every((rep) => result[`pace${rep}`])) result.paceMode = 'manual';
    else if (!result.five && result.coros) result.paceMode = 'coros';
  }
  // Preserve a previously selected race prediction when the destination field is empty.
  if (input.paceMode === 'coros' && input.corosSource === 'prediction' && !result.five && typeof input.corosPrediction === 'string') {
    try {
      const prediction = parseClock(input.corosPrediction, { min: 5, max: 120 });
      result.five = clock(prediction);
      result.paceMode = 'five';
    } catch {
      // Keep the threshold mode when there is no usable time to migrate.
    }
  }
  for (const name of dayFields) {
    const days = input[name];
    if (days === undefined) continue;
    if (!Array.isArray(days) || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      || new Set(days).size !== days.length) throw new Error('実施曜日の設定を確認してください。');
    result[name] = days;
  }
  return result;
}

function collect() {
  const data = new FormData(form);
  const raw = Object.fromEntries(data.entries());
  for (const { enabled, fields: activityFields } of crossFields) {
    raw[enabled] = form.elements[enabled].checked;
    if (!raw[enabled]) {
      for (const { name } of activityFields) raw[name] = form.elements[name].value;
    }
  }
  for (const { name, type } of descriptors) {
    if (type === 'number' && raw[name] !== undefined && raw[name] !== '') raw[name] = Number(raw[name]);
  }
  for (const name of dayFields) {
    raw[name] = [...form.querySelectorAll(`[name="${name}"]:checked`)].map((item) => +item.value);
  }
  return clean(raw, savedSettings);
}

function setFields(settings) {
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === 'boolean') form.elements.namedItem(name).checked = value;
    else if (!dayFields.includes(name)) form.elements.namedItem(name).value = value;
  }
  for (const name of dayFields) {
    for (const checkbox of form.querySelectorAll(`[name="${name}"]`)) checkbox.checked = settings[name].includes(+checkbox.value);
  }
  syncForm();
}

function syncForm() {
  const isFull = form.elements.race.value === 'full';
  const isCustom = form.elements.mode.value === 'custom';
  const paceMode = form.elements.paceMode.value;
  const isCoros = paceMode === 'coros';
  $('manual-pace-fields').hidden = paceMode !== 'manual';
  $('five-help').textContent = paceMode === 'five' ? '実測・予測どちらでも入力できます' : '比較用（任意）';
  $('coros-help').textContent = isCoros ? 'Riegel モデルで5 kmタイムを推定' : '比較用（任意）';
  const visible = { full: isFull, custom: isCustom, 'cycling-custom': form.elements.cyclingPlan.value === 'custom' };
  for (const element of form.querySelectorAll('[data-condition]')) {
    element.hidden = !visible[element.dataset.condition];
    if (element.dataset.condition !== 'cycling-custom') {
      for (const input of element.querySelectorAll('input,select')) input.disabled = element.hidden;
    }
  }
  for (const group of form.querySelectorAll('[data-cross-fields]')) {
    group.hidden = !form.elements[group.dataset.crossFields].checked;
    for (const field of group.querySelectorAll('input,select,textarea')) field.disabled = group.hidden;
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
const escapeText = (value) => value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const notes = (messages = []) => [...new Set(messages)].map((message) => `<p class="note warning">${message}</p>`).join('');
const kindName = { easy: 'Easy', long: 'Long Run', sub: 'Sub-T', rest: 'Rest', outside: '期間外', race: 'レース', ...CROSS_LABELS };
const shortDate = (date) => date.slice(5).replace('-', '/');
const powerLabel = (activity) => activity.ftp
  ? `${activity.ftp.join('〜')}% FTP${activity.watts ? `（${activity.watts.join('〜')} W）` : ''}` : '';
const intervalLabel = (activity) => activity.reps ? `${activity.reps} × ${activity.repMinutes}分・間の休息 ${min(activity.rest)}` : '';

let model;
let selectedWeek = 0;
let savedSettings = DEFAULTS;
let refreshTimer;

function calculate(settings) {
  if (settings.days.length && settings.days.length !== settings.count) throw new Error('練習日数と選択した曜日の数をそろえてください。');
  if (settings.lthr && settings.maxHr && settings.lthr > settings.maxHr) throw new Error('閾値心拍数は最大心拍数以下に設定してください。');
  const input = paceInputs(settings);
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
  const { five, coros, estimate, source, duration, exponent, issue, outOfRange, comparisonWarnings } = input;
  const sourceTitle = {
    five: '5 km の入力タイムを使った Sub-T ペース',
    threshold: 'COROS閾値ペースから推定したSub-Tペース',
    manual: '手動指定の Sub-T ペース',
  }[source];
  $('pace-status').textContent = outOfRange ? '表の範囲外' : issue ? '入力を確認' : source === 'threshold' ? '推定ペース' : 'ペース算出済み';
  const metrics = [];
  if (five !== null) metrics.push(`<span>${source === 'five' ? '' : '比較用 · '}5 km 入力タイム <strong>${clock(five)}</strong>（平均 ${paceLabel(five / 5)}）</span>`);
  if (coros !== null) metrics.push(`<span>${source === 'threshold' ? '' : '比較用 · '}COROS 閾値ペース <strong>${paceLabel(coros)}</strong></span>`);
  if (estimate !== null) metrics.push(`<span>推定5 kmタイム <strong>${clock(estimate)}</strong></span>`);
  const warnings = [...comparisonWarnings, ...paces.flatMap((pace) => pace.warnings)];
  const detailsOpen = $('pace-output').querySelector('details')?.open;
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
    <p class="pace-source">${sourceTitle}</p>
    <div class="pace-grid">${paces.map((pace) => `
      <article class="pace-tile">
        <h3>${pace.rep} 分反復</h3>
        <p class="pace-number">${clock(pace.adjusted)}${pace.adjusted === null ? '' : '<small> /km</small>'}</p>
        <p>${pace.base === null ? 'ペース未設定' : pace.source}
           ${pace.changes.length ? ` · 基準 ${paceLabel(pace.base)}` : ''}</p>
      </article>`).join('')}</div>
    ${metrics.length ? `<div class="inputs-comp">${metrics.join('')}</div>` : ''}
    ${issue ? `<p class="note${outOfRange ? ' warning' : ''}">${issue}</p>` : ''}
    ${source === 'threshold' ? `<p class="note">COROS閾値ペースを${duration}分持続可能なペースと仮定し、Riegelモデルから5kmタイムを推定しています。この換算は本書およびCOROS公式の指定式ではありません。Riegel指数は${exponent}です。</p>` : ''}
    ${notes(warnings)}
    <details class="data"${detailsOpen ? ' open' : ''}><summary>おすすめインターバルと所要時間</summary>
      <p class="note">選択週にない反復種別は独立したセッション例です。</p>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">反復</th><th scope="col">ペース</th><th scope="col">1rep距離</th><th scope="col">間の休息</th><th scope="col">Sub-T</th><th scope="col">総時間</th><th scope="col">Sub-T合計距離</th><th scope="col">全体距離</th></tr></thead>
        <tbody>${examples.map((item) => `<tr><th scope="row">${item.reps} × ${item.rep}分</th><td>${paceLabel(item.pace)}</td>
        <td>${item.repDistanceMeters === null ? '—' : `${item.repDistanceMeters} m`}</td>
        <td>${item.reps > 1 ? `${item.rest}秒` : '—'}</td><td>${min(item.sub)}</td><td>${min(item.total)}</td>
        <td>${distance(item.workDistance)}</td><td>${distance(item.distance)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">WU ${settings.warmup}分・CD ${settings.cooldown}分。</p>
      ${paces.filter((pace) => pace.changes.length).map((pace) => `<p class="note">${pace.rep}分反復　${pace.changes.map(({ label, delta }) => `${label} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}秒/km`).join(' ／ ')}</p>`).join('')}
    </details>`;
}

function renderTrainingGuides() {
  const { input, paces, settings } = model;
  const { pace, outOfRange, heartRate } = easyRunGuide(input.reference, settings.maxHr);
  const referenceLabel = { five: '5 km 入力タイム', threshold: 'Riegel モデルによる推定5 km' }[input.source];
  const easyNote = outOfRange ? '表 2.3 の対象範囲は5 kmタイム15:20〜30:00です。'
    : input.source === 'manual' ? 'ペースの目安を表示するには、5 kmタイム基準またはCOROS閾値ペース基準を選んでください。'
    : pace === null ? '選択した方式の入力がそろうと、ペースの目安が表示されます。' : '';
  $('easy-guide-output').innerHTML = `
    <p class="easy-guide-limit">イージーランのペース上限目安　<strong>${paceLabel(pace)}</strong></p>
    ${input.reference !== null ? `<p class="note">${referenceLabel} ${clock(input.reference)} · 表 2.3</p>` : ''}
    ${easyNote ? `<p class="note${outOfRange ? ' warning' : ''}">${easyNote}</p>` : ''}
    <p class="note">ペースは速い側の上限目安です。実際はそれより遅いペースで走って構いません。</p>
    <p class="note">本書はペースより平均心拍を優先し、最大心拍数（HRmax）の70%を平均心拍の上限目安としています。心拍が高くなりそうならペースを落とします。</p>
    <p class="note">${heartRate === null ? '最大心拍数を詳細設定に入力すると、70%に相当する心拍数を表示します。'
        : `平均心拍の上限目安　<strong>${heartRate} bpm</strong>（最大心拍数 ${settings.maxHr} bpm × 70%）`}</p>`;

  $('pace-alert-output').innerHTML = `
    <p class="note">表示中の Sub-T ペースを使用します。環境補正が適用される場合は補正後のペースが基準です。</p>
    ${paces.every((pace) => pace.adjusted === null) ? '<p class="note">Sub-T ペースが算出されると、COROS への設定用の境界を表示します。</p>' : ''}
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">反復時間</th><th scope="col">目標ペース</th><th scope="col">速い側の境界</th><th scope="col">遅い側の境界</th></tr></thead>
      <tbody>${paces.map(({ rep, adjusted }) => {
        const bounds = corosPaceAlert(adjusted, settings.alertFast, settings.alertSlow);
        return `<tr><th scope="row">${rep}分</th><td>${paceLabel(adjusted)}</td><td>${paceLabel(bounds?.fast ?? null)}</td><td>${paceLabel(bounds?.slow ?? null)}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    ${settings.lthr ? `<div class="lthr-guide">
      <h3>LTHR ガードレール（書籍）</h3>
      <ul>
        <li>最初の反復終了時は、LTHRより10〜15 bpm低い ${settings.lthr - 15}〜${settings.lthr - 10} bpmが目安です。</li>
        <li>最後の反復は、原則としてLTHR（${settings.lthr} bpm）を継続的に超えないようにします。</li>
        <li>心拍の反応には遅れや個人差があります。体感の強度も併せて確認します。</li>
      </ul>
    </div>` : '<p class="note">COROS 閾値心拍数を詳細設定に入力すると、LTHR ガードレールを表示します。</p>'}`;
}

function renderWeek() {
  const { plan, settings } = model;
  const week = plan.weeks[selectedWeek];
  const sub = week.total ? +(week.sub / week.total * 100).toFixed(1) : 0;
  const easy = week.total ? +(100 - sub).toFixed(1) : 0;
  const { activity } = week;
  const subCount = week.calendar.filter((day) => day.kind === 'sub').length;
  $('week-picker').value = selectedWeek;
  $('calendar-output').innerHTML = `
    <dl class="metrics activity-metrics">
      <div><dt>ランニング</dt><dd>${min(activity.running)}</dd></div>
      <div><dt>サイクリング</dt><dd>${min(activity.cycling)}</dd></div>
      <div><dt>その他のトレーニング</dt><dd>${min(activity.other)}</dd></div>
      <div><dt>全運動時間</dt><dd>${min(activity.total)}</dd></div>
      <div><dt>高強度（クロストレーニング）</dt><dd>${activity.high} 回</dd></div>
    </dl>
    <dl class="metrics">
      <div><dt>Easy / Sub-T（ランニング）</dt><dd>${easy}% / ${sub}%</dd></div>
      <div><dt>Sub-T 回数</dt><dd>${subCount} 回</dd></div>
      <div><dt>ロングラン</dt><dd>${min(week.long)}</dd></div>
      <div><dt>休養</dt><dd>${activity.rest} 日</dd></div>
    </dl>
    <ol class="calendar">${week.calendar.map((item) => `<li class="cal-day ${item.kind === 'rest' && item.cross.length ? 'cross-only' : item.kind}">
      <div class="day-label">${shortDate(item.date)}（${WEEKDAYS[item.day]}）</div>
      ${item.kind === 'rest' && item.cross.length ? '' : `<strong class="kind">${kindName[item.kind]}</strong>`}
      ${item.total ? `<div class="day-duration">${min(item.total)}</div>` : ''}
      ${item.kind === 'sub' ? `<div class="day-menu">${item.reps} × ${item.rep}分${item.pace ? `<br>${paceLabel(item.pace)}` : ''}</div>` : ''}
      ${item.double ? `<div class="day-menu">朝 ${min(Math.floor(item.total / 120) * 60)}<br>夕 ${min(item.total - Math.floor(item.total / 120) * 60)}</div>` : ''}
      ${item.kind === 'race' ? `<div class="day-menu">${RACES[settings.race]}</div>` : ''}
      ${item.cross.map((extra) => `<div class="cross-session ${extra.kind}">
        <strong class="kind">${kindName[extra.kind]}</strong>
        <div class="day-duration">${min(extra.total)} · 強度 ${INTENSITIES[extra.intensity]}</div>
        ${extra.reps ? `<div class="day-menu">${intervalLabel(extra)}</div>` : ''}
        ${extra.ftp ? `<div class="day-menu">${powerLabel(extra)}</div>` : ''}
        ${extra.note ? `<div class="day-menu cross-note">${escapeText(extra.note)}</div>` : ''}
      </div>`).join('')}
    </li>`).join('')}</ol>
    <p class="note">${plan.sample ? 'サンプル（開始時の週間ランニング時間を5時間と仮定）' : '入力した週間ランニング時間を起点に作成'} · アプリ自動計画（表 ${week.table} 参照）</p>
    <p class="note">${week.phase}${week.change === null ? '' : ` · ランニング時間の前週比 ${deltaLabel(week.change)}（${rate(week.changeRate)}）`}
      ${week.shortfall ? ` · 目標 ${min(week.target)}、未配分 ${min(week.shortfall)}` : ''}</p>
    ${activity.conflicts.length ? `<div class="schedule-warning">
      <strong>高強度の予定と Sub-T が接近しています</strong>
      <ul>${activity.conflicts.map(({ crossDate, kind, subDate, sameDay }) =>
        `<li>${shortDate(crossDate)} の ${kindName[kind]} と ${shortDate(subDate)} の Sub-T が${sameDay ? '同日' : '連続日'}</li>`).join('')}</ul>
      ${subCount ? `<p>代替案として Sub-T を週${subCount - 1}回に設定できます。設定後のカレンダーで競合を確認してください。</p>
        <button class="secondary" type="button" data-reduce-sub="${subCount - 1}">Sub-T を週${subCount - 1}回に設定</button>`
        : '<p>前後の週の Sub-T または固定予定を確認してください。</p>'}
    </div>` : ''}
    ${notes(week.warnings)}`;
}

function renderProgress() {
  const { plan, settings } = model;
  const detailsOpen = $('progress-output').querySelector('details')?.open;
  const max = Math.max(60, ...plan.weeks.map((week) => week.total));
  const chart = plan.weeks.map((week, i) => {
    const bars = ['total', 'sub', 'long'].map((key) => `<i aria-hidden="true" class="bar ${key}-bar" style="height:${week[key] / max * 100}%"></i>`).join('');
    const detail = `第${week.index}週 ${week.phase}　ランニング ${min(week.total)}、Sub-T ${min(week.sub)}、ロング ${min(week.long)}`;
    return `<button type="button" data-week="${i}" ${week.taper ? 'data-taper' : ''} title="${detail}" aria-label="${detail}" aria-pressed="${selectedWeek === i}"><span class="columns">${bars}</span><b>${week.index}</b></button>`;
  }).join('');
  $('progress-output').innerHTML = `
    <p class="note">${RACES[settings.race]} · ${plan.weeks.length}週 · ${plan.dated ? `レース日 ${settings.ends}` : '日程サンプル'}</p>
    <div class="chart" role="group" aria-label="ランニング時間の推移。週を選択すると週間プランが切り替わります。">${chart}</div>
    <div class="legend"><span><i class="total-bar"></i>ランニング</span><span><i class="sub-bar"></i>Sub-T</span><span><i class="long-bar"></i>ロングラン</span>${plan.weeks.some((week) => week.taper) ? '<span><i class="taper-bar"></i>テーパリング</span>' : ''}</div>
    ${notes(plan.warnings)}
    <details class="data"${detailsOpen ? ' open' : ''}><summary>週ごとの時間と増加ポイント</summary>
      <div class="table-wrap"><table><thead><tr><th scope="col">週</th><th scope="col">期間</th><th scope="col">ランニング</th><th scope="col">Sub-T</th><th scope="col">ロング</th><th scope="col">前週比</th><th scope="col">フェーズ</th><th scope="col">Cycling</th><th scope="col">その他</th><th scope="col">全運動時間</th></tr></thead>
      <tbody>${plan.weeks.map((week) => `<tr><th scope="row">${week.index}</th><td>${week.calendar.find((item) => item.kind !== 'outside').date}〜${week.calendar.at(-1).date.slice(5)}</td>
        <td>${min(week.total)}</td><td>${min(week.sub)}</td><td>${min(week.long)}</td><td>${week.change === null ? '—' : `${deltaLabel(week.change)}（${rate(week.changeRate)}）`}</td>
        <td>${week.phase}${week.changeRate > 0.10 ? ' · 増加幅を確認' : ''}</td>
        <td>${min(week.activity.cycling)}</td><td>${min(week.activity.other)}</td><td>${min(week.activity.total)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function show() {
  selectedWeek = Math.min(selectedWeek, model.plan.weeks.length - 1);
  $('alert-width-error').textContent = '';
  $('week-picker').replaceChildren(...model.plan.weeks.map((week, i) => new Option(`第${week.index}週`, i)));
  renderPaces();
  renderTrainingGuides();
  renderWeek();
  renderProgress();
  renderCyclingReference();
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

function renderCyclingReference() {
  const key = $('cycling-reference-picker').value;
  const reference = CYCLING_WEEKS[key];
  const { cyclingEnabled, cyclingFtp, cyclingPlan } = model.settings;
  const referenceApplied = cyclingEnabled && cyclingPlan === key;
  $('cycling-reference-output').innerHTML = `
    <p>Cross Training 章 · 表 ${reference.table} · ${reference.name}</p>
    <div class="table-wrap"><table>
    <thead><tr><th scope="col">曜日</th><th scope="col">メニュー</th><th scope="col">掲載時間</th><th scope="col">内容</th></tr></thead>
    <tbody>${reference.days.map((day, index) => {
      const watts = cyclingWatts(day.ftp, cyclingFtp);
      const detail = day.kind === 'cycling' ? [intervalLabel(day), powerLabel({ ...day, watts })].filter(Boolean).join(' · ')
        : day.reps ? `${day.reps} × ${day.repMinutes}分（掲載時間は WU・CD 込み）` : '—';
      return `<tr><th scope="row">${WEEKDAYS[index]}</th><td>${kindName[day.kind]}</td><td>${day.minutes}分</td><td>${detail}</td></tr>`;
    }).join('')}</tbody>
    </table></div>
    <p>適用すると、サイクリングの行を毎週の固定予定に追加します。サイクリングのインターバルは日程の確認上「高」として扱います。</p>
    <button class="secondary" type="button" data-cycle-week="${key}" ${referenceApplied ? 'disabled' : ''}>${referenceApplied ? '週間プランに適用済み' : `${reference.name} のサイクリングを追加`}</button>`;
}

function renderEasyBikeRange() {
  const input = $('easy-bike-minutes');
  const minutes = input.valueAsNumber;
  $('easy-bike-range').textContent = !Number.isFinite(minutes) || !input.validity.valid ? ''
    : `書籍の時間の目安　サイクリング 約${Math.round(minutes * 1.2)}〜${Math.round(minutes * 1.3)}分`;
}

function store(settings) {
  savedSettings = settings;
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

function refresh({ submitted = false, selectionChanged = false, deactivated = '' } = {}) {
  clearTimeout(refreshTimer);
  try {
    const settings = collect();
    model = calculate(settings);
    show();
    $('cross-message').textContent = '';
    const saved = store(settings);
    if (submitted && model.input.issue) announce(model.input.issue, true);
    else if (!saved) announce('ブラウザの保存を利用できません。', true);
    else announce(submitted ? '計算して設定を保存しました。' : '');
    if (submitted && !model.input.issue && matchMedia('(max-width: 730px)').matches) $('paces').focus();
  } catch (error) {
    if (deactivated) {
      const settings = { ...savedSettings, [deactivated]: false };
      model = calculate(settings);
      show();
      store(settings);
    } else if (selectionChanged) {
      const settings = { ...savedSettings, paceMode: form.elements.paceMode.value };
      store(settings);
    }
    const message = `${error.message} ${deactivated ? 'チェックを外した種目を除外し、ほかの項目には前回の有効な設定を使っています。' : '練習計画は前回の計算結果を表示しています。'}`;
    $('cross-message').textContent = error instanceof CrossTrainingError ? message : '';
    announce(error instanceof CrossTrainingError && $('cross-settings').open ? '' : message, true);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  refresh({ submitted: true });
});

// Reveal native validation errors even when their field is in the closed settings panel.
form.addEventListener('invalid', (event) => {
  const details = event.target.closest('details');
  if (details) details.open = true;
}, true);
form.addEventListener('input', (event) => {
  if (!event.target.matches('input[type="text"], input[type="number"], textarea')) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(), 180);
});
form.addEventListener('change', (event) => {
  syncForm();
  const { name, checked } = event.target;
  const deactivated = !checked && crossFields.some(({ enabled }) => enabled === name) ? name : '';
  refresh({ selectionChanged: name === 'paceMode', deactivated });
});
const alertWidths = $('alert-widths');
function refreshAlertWidths(event) {
  const valid = [...alertWidths.querySelectorAll('input')].every((field) => field.validity.valid);
  $('alert-width-error').textContent = valid ? '' : '許容幅は0〜60秒/kmで入力してください。前回の範囲を表示しています。';
  if (valid && event.type !== 'invalid') refresh();
}
alertWidths.addEventListener('input', refreshAlertWidths);
alertWidths.addEventListener('invalid', (event) => {
  $('coros-pace-alert').open = true;
  refreshAlertWidths(event);
}, true);
$('week-picker').addEventListener('change', (event) => selectWeek(+event.target.value));
$('progress-output').addEventListener('click', (event) => {
  const button = event.target.closest('[data-week]');
  if (button) selectWeek(+button.dataset.week);
});
$('calendar-output').addEventListener('click', (event) => {
  const option = event.target.closest('[data-reduce-sub]');
  if (!option) return;
  form.elements.sessions.value = option.dataset.reduceSub;
  refresh();
  const settings = $('setting-fields').closest('details');
  settings.open = true;
  form.elements.sessions.focus();
});
$('book-picker').replaceChildren(...BOOK_WEEKS.map((week, i) => new Option(week.label, i)));
$('book-picker').value = 1;
$('book-picker').addEventListener('change', (event) => renderBook(+event.target.value));
renderBook(1);
$('cycling-reference-picker').replaceChildren(...Object.entries(CYCLING_WEEKS).map(([key, week]) => new Option(week.name, key)));
$('cycling-reference-picker').addEventListener('change', renderCyclingReference);
$('cycling-reference-output').addEventListener('click', (event) => {
  const option = event.target.closest('[data-cycle-week]');
  if (!option) return;
  form.elements.cyclingEnabled.checked = true;
  form.elements.cyclingPlan.value = option.dataset.cycleWeek;
  syncForm();
  refresh();
  $('cross-settings').open = true;
  form.elements.cyclingPlan.focus();
});
$('easy-bike-minutes').addEventListener('input', renderEasyBikeRange);
renderEasyBikeRange();

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
    const updated = calculate(settings);
    clearTimeout(refreshTimer);
    setFields(settings);
    model = updated;
    selectedWeek = 0;
    show();
    $('cross-message').textContent = '';
    announce(store(settings) ? '設定を読み込んで保存しました。' : '設定を読み込みました。ブラウザの保存を利用できません。');
  } catch (error) {
    announce(`読み込めませんでした。 ${error instanceof SyntaxError ? 'JSON を確認してください。' : error.message}`, true);
  } finally {
    event.target.value = '';
  }
});
$('reset').addEventListener('click', () => {
  clearTimeout(refreshTimer);
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Reset the current page even if storage is disabled.
  }
  setFields(DEFAULTS);
  savedSettings = DEFAULTS;
  model = calculate(DEFAULTS);
  selectedWeek = 0;
  show();
  $('cross-message').textContent = '';
  announce('設定を初期化しました。');
});

function csvCell(value) {
  if (typeof value !== 'string') return value;
  if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(value)) value = "'" + value;
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

$('csv').addEventListener('click', () => {
  const rows = [[
    '週', '日付', '曜日', 'フェーズ', 'メニュー', '所要秒', 'Sub-T秒', 'ロングラン秒', '反復回数', '1反復分', '休息秒', 'ペース秒/km', '週間ランニング秒', '前週差秒', '前週比%',
    'クロストレーニング強度', 'メモ', 'FTP(W)', '目標FTP下限%', '目標FTP上限%', '目標W下限', '目標W上限', 'サイクリングの参考週',
    '週間サイクリング秒', '週間その他秒', '週間全運動秒', '週間クロストレーニング高強度回数',
  ]];
  for (const week of model.plan.weeks) {
    const weekTail = [week.total, week.change ?? '', week.changeRate === null ? '' : Number((week.changeRate * 100).toFixed(1))];
    const { cycling, other, total, high } = week.activity;
    const totals = [cycling, other, total, high];
    for (const day of week.calendar.filter((item) => item.kind !== 'outside')) {
      const start = [week.index, day.date, WEEKDAYS[day.day], week.phase];
      const sub = day.kind === 'sub';
      if (day.kind !== 'rest' || !day.cross.length) {
        rows.push([...start, kindName[day.kind], day.total, day.sub ?? 0, day.long ?? 0, sub ? day.reps : '',
          sub ? day.rep : '', sub ? day.rest : '', sub && day.pace ? Math.round(day.pace) : '',
          ...weekTail, '', '', '', '', '', '', '', '', ...totals]);
      }
      for (const extra of day.cross) {
        rows.push([...start, kindName[extra.kind], extra.total, 0, 0, extra.reps ?? '', extra.repMinutes ?? '', extra.rest ?? '', '',
          ...weekTail, INTENSITIES[extra.intensity], extra.note ?? '', extra.kind === 'cycling' ? model.settings.cyclingFtp : '',
          ...(extra.ftp ?? ['', '']), ...(extra.watts ?? ['', '']), extra.source ?? '', ...totals]);
      }
    }
  }
  download('sub-t-training-plan.csv', '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
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
  model = calculate(settings);
  savedSettings = settings;
  setFields(settings);
} catch {
  model = calculate(DEFAULTS);
  setFields(DEFAULTS);
  announce('保存済みの設定を読み込めなかったため、初期値を表示しています。', true);
}
show();
$('calculate').disabled = false;

export const RIEGEL_DEFAULTS = { minutes: 60, exponent: 1.06 };

export function estimateCorosFiveK(paceSeconds, minutes = RIEGEL_DEFAULTS.minutes, exponent = RIEGEL_DEFAULTS.exponent) {
  if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) throw new RangeError('閾値ペースを確認してください。');
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 240) throw new RangeError('持続時間は5〜240分で入力してください。');
  if (!Number.isFinite(exponent) || exponent < 1 || exponent > 2) throw new RangeError('Riegel 指数は1〜2で入力してください。');
  const duration = minutes * 60;
  const distance = duration / paceSeconds;
  return duration * (5 / distance) ** exponent;
}

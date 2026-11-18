export function corosReference(thresholdSeconds) {
  if (thresholdSeconds === null) return null;
  return { thresholdSeconds, subThresholdPaces: null };
}

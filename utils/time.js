export function getMealTimeMSK() {
  const hour = new Date().getUTCHours() + 3;

  if (hour < 11) return "morning";
  if (hour < 18) return "day";
  if (hour < 23) return "evening";
  return "night";
}

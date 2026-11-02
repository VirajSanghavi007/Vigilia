// Pure display helpers. Kept free of React so they can be unit-tested directly.

export type RiskBand = "critical" | "high" | "medium" | "low";

/** Compact currency: 2_480_000_000 -> "$2.48B", 74_980 -> "$74,980". */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** Signed delta with unit, e.g. +8.2%, -3.1%, -2.0 pts. */
export function formatDelta(value: number, unit: "%" | " pts" = "%"): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}${unit}`;
}

/**
 * Map a 0-100 model risk score to a band (matches the design: 95 and 91 are
 * critical, 88 to 79 are high). Display bands only: replace with the
 * backend's calibrated thresholds once wired in.
 */
export function riskBand(score: number): RiskBand {
  if (score >= 90) return "critical";
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/** Percent of total with one decimal, guarding against a zero total. */
export function percentOf(part: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** Initials from an entity name, max two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

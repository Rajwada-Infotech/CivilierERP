/**
 * Safe INR currency formatter using Intl.NumberFormat.
 * Handles null, undefined, and string inputs gracefully.
 */
export const formatINR = (
  value: unknown,
  options?: { decimals?: number }
): string => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: options?.decimals ?? 0,
    maximumFractionDigits: options?.decimals ?? 0,
  }).format(num);
};

/**
 * Compact axis/tick label for a rupee amount — Cr/L/k tiers, Indian
 * numbering. Several dashboard line charts (Finance, Engineering,
 * Maintenance, Material) only had a "k" (thousands) tier with no Lakh/Crore
 * step, so any value over a few lakh rendered as an ugly "14000k" instead
 * of "1.4Cr" — shared here so every dashboard's Y-axis reads consistently
 * instead of each screen re-implementing its own (slightly different)
 * version of the same formatter.
 */
export const formatCompactINR = (value: unknown): string => {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  if (abs >= 1_00_00_000) return `${(num / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${(num / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
  return String(num);
};


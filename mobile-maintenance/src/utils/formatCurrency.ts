// Direct port of src/utils/formatCurrency.ts (web) — same Intl.NumberFormat
// call works unchanged under Hermes.
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

// Direct port of src/utils/formatCurrency.ts (web)'s formatCompactINR —
// used for chart axis labels where full currency formatting is too wide.
export const formatCompactINR = (value: unknown): string => {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  if (abs >= 1_00_00_000) return `${(num / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${(num / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
  return String(num);
};

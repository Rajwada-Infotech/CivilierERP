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


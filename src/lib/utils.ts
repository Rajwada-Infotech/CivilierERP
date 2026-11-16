import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Number-aware ordering for names: "Block 2" before "Block 10", "GC/1/2A" before "GC/1/10A". The one comparer for
// block, floor, unit, plot, room, parking and other name lists — use it instead of a plain localeCompare.
const naturalCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: unknown, b: unknown) => naturalCollator.compare(String(a ?? ""), String(b ?? ""));

export function cleanStr(value: string | null | undefined): string | null {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim();
}

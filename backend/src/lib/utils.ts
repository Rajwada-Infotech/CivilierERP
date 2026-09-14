import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cleanStr(value: string | null | undefined): string | null {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim();
}

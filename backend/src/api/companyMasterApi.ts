import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/company-master";

// Slice of the full company-master record this module actually needs —
// just enough to derive a human-readable "location" string for a company.
export interface CompanyLocation {
  Id: number;
  Name: string;
  ShortName: string | null;
  RegisteredAddress: string | null;
  City: string | null;
  State: string | null;
  Country: string | null;
  Pincode: string | null;
  IsActive: number | boolean;
}

/** Builds a short, human-readable location string from a company's address fields. */
export function formatCompanyLocation(
  c: Pick<CompanyLocation, "City" | "State" | "Country" | "RegisteredAddress">,
): string {
  const parts = [c.City, c.State, c.Country].filter(
    (p) => p && p.trim().length > 0,
  );
  if (parts.length > 0) return parts.join(", ");
  return c.RegisteredAddress?.trim() || "";
}

export const getCompanyLocations = async (): Promise<CompanyLocation[]> => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error(`Failed to fetch companies: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : [];
};

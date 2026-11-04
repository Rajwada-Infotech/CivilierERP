// "PANNOTAVBL" is what the Supplier form stores when "PAN not available" is ticked, because the field is required. Screens and
// printed documents show it in words. Exports keep the stored value.
export const PAN_NOT_AVAILABLE = "PANNOTAVBL";

export const panDisplay = (pan: string | null | undefined): string =>
  String(pan ?? "").trim().toUpperCase() === PAN_NOT_AVAILABLE ? "Not available" : String(pan ?? "");

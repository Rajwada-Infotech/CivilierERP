// Ported from src/lib/dependencyAutoName.ts (+ roomDisplay from src/lib/floorLabel.ts) on the web, so a
// mobile "Auto Name" is character-for-character what the web shows and searches on.

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

const storeyDisplay = (s: string | null | undefined): string => {
  if (!s) return "";
  const u = s.toUpperCase();
  if (u === "B") return "Basement";
  if (u === "G") return "Ground floor";
  if (/^\d+$/.test(s)) return `Floor ${s}`;
  return u === "ROOF" ? "Roof terrace" : s;
};

const roomDisplay = (name: string | null | undefined, storey?: string | null): string =>
  storey ? `${storeyDisplay(storey)} · ${name || "Room"}` : name || "Room";

/** "<flat>, <room> and <activity>" — e.g. "NS/n1/101, Hall Room and 2.1 Column and Beam Fiver net Fix". */
export function dependencyAutoName(parts: {
  flatName?: string | null;
  alias?: string | null;
  roomName?: string | null;
  storey?: string | null;
  activityName?: string | null;
}): string {
  const flat = (parts.flatName ?? "").trim() || (parts.alias ?? "").trim();
  const roomRaw = (parts.roomName ?? "").trim();
  const room = roomRaw ? roomDisplay(roomRaw, parts.storey) : "";
  const activity = (parts.activityName ?? "").trim();

  const where: string[] = [];
  if (flat) where.push(flat);
  // Skip the room if the flat text already names it.
  if (room && !(roomRaw && norm(flat).includes(norm(roomRaw)))) where.push(room);
  return [where.join(", "), activity].filter(Boolean).join(" and ");
}

/** Words of a search box: split on spaces, commas and ">", drop the joining word "and". */
export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/[\s,>]+/).filter((t) => t && t !== "and").slice(0, 8);
}

/** True when every word of `query` appears in at least one of the given text parts. Empty query matches. */
export function matchesAutoNameSearch(query: string, parts: (string | null | undefined)[]): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = parts.filter(Boolean).join(" \n ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

import { roomDisplay } from "@/lib/floorLabel";

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The "Auto Name" of a dependency activity: the flat/unit, the room, and the activity —
 * e.g. "NS/n1/101, Hall Room and 2.1 Column and Beam Fiver net Fix". Always derived from the
 * dependency record itself, never typed, so it stays right when the room or activity changes.
 *
 * Built from the structured flat and room — NOT from the chain's alias, because an alias is free
 * text and is often a whole location path ("Nisha > n1 > Floor 1 > NS/n1/101 > Hall Room") that
 * already contains the room. The alias is only a fallback when the flat is unknown, and a part
 * that is already contained in the one before it is never repeated.
 */
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

/**
 * Words of a search box, for "Auto Name wise" searching: split on spaces, commas and ">", drop the
 * joining word "and" (so pasting a whole Auto Name like "NS/n1/101, Hall Room and 2.1 Column and
 * Beam" works), lower-cased. Matching is then "every word appears somewhere in the record".
 */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,>]+/)
    .filter((t) => t && t !== "and")
    .slice(0, 8);
}

/** True when every word of `query` appears in at least one of the given text parts. Empty query matches. */
export function matchesAutoNameSearch(query: string, parts: (string | null | undefined)[]): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = parts.filter(Boolean).join(" \n ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

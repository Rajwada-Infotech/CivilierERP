import { roomDisplay } from "@/lib/floorLabel";

/**
 * The "Auto Name" of a dependency activity: the chain's alias, the room, and the activity —
 * e.g. "NS/n1/101, Hall Room and 2.1 Column and Beam Fiver net Fix". Always derived from the
 * dependency record itself, never typed, so it stays right when the alias, room or activity changes.
 */
export function dependencyAutoName(parts: {
  alias?: string | null;
  roomName?: string | null;
  storey?: string | null;
  activityName?: string | null;
}): string {
  const alias = (parts.alias ?? "").trim();
  const room = parts.roomName ? roomDisplay(parts.roomName, parts.storey) : "";
  const activity = (parts.activityName ?? "").trim();
  const where = [alias, room].filter(Boolean).join(", ");
  return [where, activity].filter(Boolean).join(" and ");
}

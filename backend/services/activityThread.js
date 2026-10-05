// Who may use a Civil Work DPR activity's comment thread, and the live-room
// plumbing around it.
//
// Participants = the activity's CURRENT allocated engineers + every user named
// on its approval levels (ApprovalLevelsJson), plus super_admin. The set is
// cached briefly per rung so a burst of messages costs one lookup, not one
// per message; saving the activity's allocation invalidates it immediately.

const { getPool, sql } = require("../db");

const TTL_MS = 30_000;
const cache = new Map(); // rungId -> { ids:Set<number>, at:number }

const roomOf = (rungId) => `activity-thread:${rungId}`;

async function getParticipantIds(rungId) {
  const hit = cache.get(rungId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

  const r = await getPool().request().input("rungId", sql.Int, rungId).query(`
    SELECT daa.Id AS assignmentId, daa.ApprovalLevelsJson AS levelsJson
    FROM dbo.DependencyActivityAssignment daa
    WHERE daa.DependencyMasterActivityId = @rungId AND daa.IsCurrent = 1
  `);
  const ids = new Set();
  const a = r.recordset[0];
  if (a) {
    const eng = await getPool().request().input("aid", sql.Int, a.assignmentId)
      .query("SELECT EngineerId FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @aid");
    eng.recordset.forEach((e) => ids.add(Number(e.EngineerId)));
    try {
      const levels = JSON.parse(a.levelsJson || "[]");
      for (const lvl of Array.isArray(levels) ? levels : []) {
        for (const uid of Array.isArray(lvl.userIds) ? lvl.userIds : []) ids.add(Number(uid));
      }
    } catch {
      /* malformed approval JSON — engineers only */
    }
  }
  cache.set(rungId, { ids, at: Date.now() });
  return ids;
}

async function canUseThread(user, rungId) {
  if (!user) return false;
  if (String(user.role || "").toLowerCase() === "super_admin") return true;
  const userId = Number(user.userId ?? user.id);
  if (!Number.isFinite(userId)) return false;
  return (await getParticipantIds(rungId)).has(userId);
}

// Called when an activity's engineers / approval levels change. Drops the
// cached set, then makes everyone currently in the live room re-join — the
// join re-checks access, so a user who was just removed stops receiving
// messages instead of staying subscribed until they close the modal.
function invalidateThread(rungId) {
  cache.delete(Number(rungId));
  try {
    const io = require("../socket").getIo();
    const room = roomOf(rungId);
    io.in(room).emit("activity-thread:rejoin", { rungId: Number(rungId) });
    io.in(room).socketsLeave(room);
  } catch {
    /* socket server not running (tests / scripts) */
  }
}

// Bulk form of invalidateThread for thousands of activities at once (Dependency
// Master "Bulk Assign"). Drops every cached participant set (they are re-read on
// demand within the 30 s TTL anyway) and tells only the rooms that actually exist
// -- i.e. have someone in them -- to re-join. Walking the adapter's room table is
// cheaper than addressing one room per activity, and needs no id list.
const ROOM_PREFIX = "activity-thread:";
function invalidateAllThreads() {
  cache.clear();
  let io = null;
  try {
    io = require("../socket").getIo();
  } catch {
    return; // socket server not running (tests / scripts)
  }
  const rooms = io?.sockets?.adapter?.rooms;
  if (!rooms) return;
  for (const room of [...rooms.keys()]) {
    if (typeof room !== "string" || !room.startsWith(ROOM_PREFIX)) continue;
    try {
      io.in(room).emit("activity-thread:rejoin", { rungId: Number(room.slice(ROOM_PREFIX.length)) });
      io.in(room).socketsLeave(room);
    } catch {
      /* best effort */
    }
  }
}

function emitComment(rungId, comment) {
  try {
    require("../socket").getIo().to(roomOf(rungId)).emit("activity-comment:new", { rungId: Number(rungId), comment });
  } catch (err) {
    console.warn(`[activityThread] emit failed for rung ${rungId}: ${err?.message || err}`);
  }
}

module.exports = { roomOf, canUseThread, invalidateThread, invalidateAllThreads, emitComment };

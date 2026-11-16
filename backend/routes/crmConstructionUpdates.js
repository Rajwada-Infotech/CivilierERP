// Construction progress, read live from the DPR module — nothing to prepare or map by hand.
//
// The DPR module holds the real work: dependency chains (dbo.DependencyMaster) per project, tower, floor, flat and room;
// each chain an ordered list of steps (DependencyMasterActivity -> ActivityMaster), each step in a DPR work group
// (ActivityMaster.group_id: Hacking, Brick Work, Electric Work, Plastering ...); each step's current assignment
// (DependencyActivityAssignment, IsCurrent = 1) with its status and %.
//
// constructionProgress() rolls all of it up in ONE set-based query (GROUPING SETS over a single scan of the steps):
//   * a step counts 100% when Completed/Approved, its reported % while In progress / Hold / Rework, 0% before it starts;
//     cancelled steps and retired chains don't count;
//   * each step weighs its planned days (assignment Days, else the activity's days of completion, else 1), so a long
//     job moves the figure more than a short one;
//   * the same scan gives the % for the project, each tower and each flat — overall and per DPR work;
//   * DPR works are put in site order (their place in the chains); "now" is the work under way, "next" the first one
//     not started after it.
// What moved comes from the DPR progress log (every % change a site engineer records) and completed steps.
// Payment milestones wait for a DPR work (CrmMilestoneMaster.DprGroupId, else the DPR work of the same name): when it
// reaches 100% for a booking's unit (else its tower, else the project) the milestone is listed as ready to demand.
// Staff notes for buyers (CrmConstructionUpdate) stay as before.
const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { projectPredicate, projectAllowed, assertProjectAllowed } = require("../services/projectScope");
const { parseId } = require("../middleware/validateRequest");

router.use(apiRateLimit);
router.use(authMiddleware);
// A project in the URL must be one the user may work in (the shared project-scope guard).
router.param("projectId", require("../services/projectScope").projectParamGuard("SELECT id AS ProjectId FROM dbo.enterprise WHERE id = @id"));

const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const DONE_SQL = "('COMPLETED', 'APPROVED')";
const MOVING_SQL = "('IN_PROGRESS', 'HOLD', 'REWORK')";
const idList = (ids) => [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

// A DPR work's name as people say it: "5. PLASTERING" -> "Plastering", "9. ELECTRICK WIRING WORK" -> "Electrick Wiring Work".
const workName = (g) => String(g || "").replace(/^\s*\d+(\.\d+)*\.?\s*/, "").toLowerCase().replace(/(^|[\s&/(-])\S/g, (c) => c.toUpperCase()).trim() || "Other work";
// For matching a milestone to a DPR work by name: letters only, upper case, numbering dropped.
const matchKey = (s) => String(s || "").replace(/^\s*\d+(\.\d+)*\.?\s*/, "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();

// The live DPR steps of the given projects, one row each: where it is, its DPR work, weight and %.
const stepsSql = (list) => `
  SELECT dm.ProjectId, dm.TowerId, dm.FlatId, am.group_id AS GroupId, dma.SequenceNo,
         CAST(COALESCE(NULLIF(daa.Days, 0), NULLIF(am.days_of_completion, 0), 1) AS FLOAT) AS W,
         CAST(CASE WHEN daa.Status IN ${DONE_SQL} THEN 100
                   WHEN daa.Status IN ${MOVING_SQL} THEN CASE WHEN daa.ProgressPercent > 100 THEN 100 WHEN daa.ProgressPercent < 0 THEN 0 ELSE ISNULL(daa.ProgressPercent, 0) END
                   ELSE 0 END AS FLOAT) AS Pct,
         daa.Status, daa.EndDate
  FROM dbo.DependencyMaster dm
  JOIN dbo.DependencyMasterActivity dma ON dma.DependencyMasterId = dm.Id
  JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
  LEFT JOIN dbo.DependencyActivityAssignment daa ON daa.DependencyMasterActivityId = dma.Id AND daa.IsCurrent = 1
  WHERE dm.IsActive = 1 AND dm.ProjectId IN (${list}) AND ISNULL(daa.Status, '') <> 'CANCELLED'`;

// A place's DPR works in site order with their %, and what is under way now and next.
function worksLine(byGroup, order, names) {
  const works = [...byGroup.entries()]
    .map(([gid, f]) => ({ groupId: gid, name: workName(names.get(gid)), pct: round1(f.pct), steps: f.steps, done: f.done, moving: f.moving, order: order.get(gid) ?? 1e9 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ order: _o, ...w }) => w);
  // Now: works partway done; when none is, the ones just started (still at 0%).
  const partway = works.filter((w) => w.pct > 0 && w.pct < 100);
  const now = partway.length ? partway : works.filter((w) => w.moving > 0 && w.pct < 100);
  const lastStarted = works.reduce((i, w, k) => (w.pct > 0 ? k : i), -1);
  const next = works.slice(lastStarted + 1).find((w) => w.pct === 0) || null;
  return { works, now: now.map((w) => ({ name: w.name, pct: w.pct })), next: next ? next.name : null, allDone: works.length > 0 && works.every((w) => w.pct >= 100) };
}

/**
 * Live progress of the given projects. Returns Map(projectId -> { hasDpr, pct, steps, done, moving, late, works, now,
 * next, allDone, towers: [{ blockId, blockName, pct, steps, done, works, now, next }], flats: Map(unitId -> { pct, steps, done, works, now, next }) }).
 */
async function constructionProgress(pool, projectIds) {
  const ids = idList(projectIds);
  const out = new Map();
  if (!ids.length) return out;
  const list = ids.join(",");
  const [rows, late, groupOrder, blocks] = await Promise.all([
    pool.request().query(`
      WITH step AS (${stepsSql(list)})
      SELECT ProjectId, TowerId, FlatId, GroupId, GROUPING(TowerId) AS gT, GROUPING(FlatId) AS gF, GROUPING(GroupId) AS gG,
             SUM(W * Pct) / NULLIF(SUM(W), 0) AS Pct, COUNT(*) AS Steps,
             SUM(CASE WHEN Pct >= 100 THEN 1 ELSE 0 END) AS Done,
             SUM(CASE WHEN Status IN ${MOVING_SQL} THEN 1 ELSE 0 END) AS Moving
      FROM step
      GROUP BY GROUPING SETS ((ProjectId), (ProjectId, GroupId), (ProjectId, TowerId), (ProjectId, TowerId, GroupId),
                              (ProjectId, FlatId), (ProjectId, FlatId, GroupId))`),
    pool.request().query(`
      WITH step AS (${stepsSql(list)})
      SELECT ProjectId, COUNT(*) AS Late FROM step
      WHERE Pct < 100 AND EndDate BETWEEN '2000-01-01' AND DATEADD(DAY, -1, CAST(GETDATE() AS DATE)) GROUP BY ProjectId`),
    // Site order of each DPR work: where its steps sit in the chains, on average.
    pool.request().query(`
      SELECT dm.ProjectId, am.group_id AS GroupId, g.activity_name AS GroupName, AVG(CAST(dma.SequenceNo AS FLOAT)) AS Ord
      FROM dbo.DependencyMaster dm JOIN dbo.DependencyMasterActivity dma ON dma.DependencyMasterId = dm.Id
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId LEFT JOIN dbo.ActivityMaster g ON g.id = am.group_id
      WHERE dm.IsActive = 1 AND dm.ProjectId IN (${list}) GROUP BY dm.ProjectId, am.group_id, g.activity_name`),
    pool.request().query(`SELECT Id, BlockName FROM dbo.BlockMaster WHERE Id IN (SELECT DISTINCT TowerId FROM dbo.DependencyMaster WHERE IsActive = 1 AND ProjectId IN (${list}))`),
  ]);
  const blockName = new Map(blocks.recordset.map((b) => [b.Id, b.BlockName]));
  const lateOf = new Map(late.recordset.map((r) => [r.ProjectId, r.Late]));
  const orderOf = new Map(); const names = new Map();
  for (const g of groupOrder.recordset) {
    if (!orderOf.has(g.ProjectId)) orderOf.set(g.ProjectId, new Map());
    orderOf.get(g.ProjectId).set(g.GroupId, g.Ord);
    names.set(g.GroupId, g.GroupName);
  }
  const bucket = () => ({ pct: 0, steps: 0, done: 0, moving: 0, byGroup: new Map() });
  const P = new Map(); const T = new Map(); const F = new Map();
  const at = (m, k) => { if (!m.has(k)) m.set(k, bucket()); return m.get(k); };
  for (const r of rows.recordset) {
    const fig = { pct: Number(r.Pct) || 0, steps: r.Steps, done: r.Done, moving: r.Moving };
    const target = r.gT && r.gF ? at(P, r.ProjectId) : !r.gT ? at(T, `${r.ProjectId}:${r.TowerId}`) : at(F, `${r.ProjectId}:${r.FlatId}`);
    if (r.gG) Object.assign(target, fig); else target.byGroup.set(r.GroupId, fig);
  }
  for (const pid of ids) {
    const p = P.get(pid);
    if (!p) { out.set(pid, { hasDpr: false, pct: null, steps: 0, done: 0, moving: 0, late: 0, works: [], now: [], next: null, allDone: false, towers: [], flats: new Map() }); continue; }
    const order = orderOf.get(pid) || new Map();
    const line = (b) => ({ pct: round1(b.pct), steps: b.steps, done: b.done, moving: b.moving, ...worksLine(b.byGroup, order, names) });
    const towers = [...T.entries()].filter(([k]) => k.startsWith(`${pid}:`)).map(([k, t]) => {
      const blockId = Number(k.split(":")[1]) || null;
      return { blockId, blockName: blockName.get(blockId) || null, ...line(t) };
    }).sort((a, b) => String(a.blockName || "").localeCompare(String(b.blockName || "")));
    const flats = new Map([...F.entries()].filter(([k]) => k.startsWith(`${pid}:`)).map(([k, f]) => [Number(k.split(":")[1]), line(f)]));
    out.set(pid, { hasDpr: true, late: lateOf.get(pid) || 0, ...line(p), towers, flats });
  }
  return out;
}

/**
 * What moved on site: every % change a site engineer recorded (DPR progress log) and steps completed, newest first.
 * Scoped to a project, and optionally one tower or one flat.
 * The DPR daily log (DependencyActivityDailyLog) is written by the same save as the progress log
 * (dependencyActivityAssignment.js), as one snapshot per day: reading it too would show each change twice. A save of
 * remarks only is logged without a % and is not a move.
 */
async function siteFeed(pool, { projectId, blockId = null, unitId = null, days = 14, top = 40 }) {
  const r = await pool.request().input("pid", sql.Int, projectId).input("bid", sql.Int, blockId).input("uid", sql.Int, unitId)
    .input("days", sql.Int, days).input("top", sql.Int, top).query(`
    WITH ev AS (
      SELECT l.LoggedAt AS At, l.FromProgressPercent AS FromPct, l.ToProgressPercent AS ToPct, l.StatusAfter AS Status, daa.DependencyMasterActivityId AS RungId
      FROM dbo.DependencyActivityProgressLog l JOIN dbo.DependencyActivityAssignment daa ON daa.Id = l.AssignmentId
      WHERE l.LoggedAt >= DATEADD(DAY, -@days, SYSDATETIME())
        AND l.ToProgressPercent IS NOT NULL AND ISNULL(l.FromProgressPercent, -1) <> l.ToProgressPercent
      UNION ALL
      -- Steps completed without a progress entry for it (finished in one go).
      SELECT daa.UpdatedAt, NULL, 100, daa.Status, daa.DependencyMasterActivityId
      FROM dbo.DependencyActivityAssignment daa
      WHERE daa.IsCurrent = 1 AND daa.Status IN ${DONE_SQL} AND daa.UpdatedAt >= DATEADD(DAY, -@days, SYSDATETIME())
        AND NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityProgressLog l WHERE l.AssignmentId = daa.Id AND l.ToProgressPercent >= 100)
    )
    SELECT TOP (@top) ev.At, ev.FromPct, ev.ToPct, ev.Status, am.activity_name AS Activity, g.activity_name AS GroupName,
           blk.BlockName, u.UnitName, dm.Alias
    FROM ev
    JOIN dbo.DependencyMasterActivity dma ON dma.Id = ev.RungId
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
    LEFT JOIN dbo.ActivityMaster g ON g.id = am.group_id
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = dm.TowerId
    LEFT JOIN dbo.UnitMaster u ON u.Id = dm.FlatId
    WHERE dm.ProjectId = @pid AND dm.IsActive = 1 AND (@bid IS NULL OR dm.TowerId = @bid) AND (@uid IS NULL OR dm.FlatId = @uid)
    ORDER BY ev.At DESC`);
  return r.recordset.map((x) => {
    const room = String(x.Alias || "").split(">").slice(3).join(" > ") || null;
    const done = x.ToPct != null && Number(x.ToPct) >= 100;
    return { at: x.At, work: workName(x.GroupName), activity: x.Activity, tower: x.BlockName, unit: x.UnitName, room,
      from: x.FromPct != null ? Number(x.FromPct) : null, to: x.ToPct != null ? Number(x.ToPct) : null, completed: done };
  });
}

// A buyer sees only the unit attached to their booking; never fall back to block or project totals.
async function unitProgress(pool, { projectId, unitId }) {
  if (!projectId || !unitId) return null;
  const p = (await constructionProgress(pool, [projectId])).get(Number(projectId));
  if (!p || !p.hasDpr) return null;
  const flat = p.flats.get(Number(unitId)) || null;
  if (!flat) return null;
  const feed = (await siteFeed(pool, { projectId, unitId, days: 30, top: 15 }))
    .map(({ work, activity, room, from, to, completed, at }) => ({ work, activity, room, from, to, completed, at }));
  const pick = (x) => x && { pct: x.pct, works: x.works.map(({ name, pct }) => ({ name, pct })), now: x.now, next: x.next, allDone: x.allDone };
  return { unit: pick(flat), feed, scope: "unit" };
}

// GET /progress — every project the user may see that has DPR work (or notes): its figures, works and towers.
router.get("/progress", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projects = (await pool.request().query(`
      SELECT e.id AS ProjectId, e.name AS ProjectName FROM dbo.enterprise e
      WHERE e.business_type = 'P' AND (e.id IN (SELECT DISTINCT ProjectId FROM dbo.DependencyMaster WHERE IsActive = 1)
        OR e.id IN (SELECT DISTINCT ProjectId FROM dbo.CrmConstructionUpdate))${projectPredicate(req.projectScope, "e.id")}
      ORDER BY e.name`)).recordset;
    const prog = await constructionProgress(pool, projects.map((p) => p.ProjectId));
    res.json({ projects: projects.map((p) => {
      const g = prog.get(p.ProjectId);
      return { projectId: p.ProjectId, projectName: p.ProjectName, hasDpr: g.hasDpr, pct: g.pct, steps: g.steps, done: g.done, moving: g.moving,
        late: g.late, works: g.works, now: g.now, next: g.next, allDone: g.allDone,
        towers: g.towers.map(({ blockId, blockName, pct, steps, done, now, next }) => ({ blockId, blockName, pct, steps, done, now, next })) };
    }) });
  } catch (e) {
    console.error("[crm-construction-updates] GET /progress error:", e.message);
    res.status(500).json({ error: "Could not read the construction progress" });
  }
});

// GET /progress/:projectId?blockId=&unitId= — project, tower, or unit progression.
router.get("/progress/:projectId", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const pid = parseId(req.params.projectId);
    if (!pid) return res.status(400).json({ error: "Invalid project" });
    if (!projectAllowed(req.projectScope, pid)) return res.status(403).json({ error: "You don't have access to this project" });
    const blockId = req.query.blockId ? parseId(req.query.blockId) : null;
    const unitId = req.query.unitId ? parseId(req.query.unitId) : null;
    if (req.query.blockId && !blockId) return res.status(400).json({ error: "Invalid block" });
    if (req.query.unitId && !unitId) return res.status(400).json({ error: "Invalid unit" });
    const g = (await constructionProgress(pool, [pid])).get(pid);
    const unitNames = g.flats.size ? new Map((await pool.request().query(`SELECT Id, UnitName, BlockId FROM dbo.UnitMaster WHERE Id IN (${[...g.flats.keys()].join(",")})`)).recordset.map((u) => [u.Id, u])) : new Map();
    const units = [...g.flats.entries()]
      .map(([id, f]) => ({ unitId: id, unitName: unitNames.get(id)?.UnitName || `Unit ${id}`, blockId: unitNames.get(id)?.BlockId ?? null, pct: f.pct, now: f.now, next: f.next, works: f.works, done: f.done, moving: f.moving, steps: f.steps }))
      .filter((u) => !blockId || Number(u.blockId) === blockId)
      .sort((a, b) => b.pct - a.pct || a.unitName.localeCompare(b.unitName));
    const tower = blockId ? g.towers.find((t) => Number(t.blockId) === blockId) : null;
    if (blockId && !tower) return res.status(404).json({ error: "Block has no construction progress in this project" });
    const unit = unitId ? units.find((u) => Number(u.unitId) === unitId) : null;
    if (unitId && !unit) return res.status(404).json({ error: "Unit has no DPR progression in this project or block" });
    const base = unit || tower || g;
    res.json({ projectId: pid, hasDpr: g.hasDpr, pct: base.pct, steps: base.steps, done: base.done, moving: base.moving, late: g.late,
      works: base.works, now: base.now, next: base.next, allDone: base.allDone,
      towers: g.towers.map(({ blockId: b, blockName, pct, steps, done, now, next }) => ({ blockId: b, blockName, pct, steps, done, now, next })),
      selectedUnit: unit ? { unitId: unit.unitId, unitName: unit.unitName, blockId: unit.blockId } : null,
      units, feed: g.hasDpr ? await siteFeed(pool, { projectId: pid, blockId, unitId, days: 14, top: 40 }) : [] });
  } catch (e) {
    console.error("[crm-construction-updates] GET /progress/:projectId error:", e.message);
    res.status(500).json({ error: "Could not read the project's progress" });
  }
});

// The DPR works and which one each payment milestone waits for (set, or matched by name).
async function milestoneLinks(pool) {
  const [groups, milestones] = await Promise.all([
    pool.request().query("SELECT id AS GroupId, activity_name AS Name FROM dbo.ActivityMaster WHERE activity_type = 0 AND ISNULL(is_active, 1) = 1 ORDER BY activity_name"),
    pool.request().query("SELECT Id, Name, SortOrder, DprGroupId FROM dbo.CrmMilestoneMaster WHERE IsActive = 1 ORDER BY SortOrder, Id"),
  ]);
  const byKey = new Map();
  for (const g of groups.recordset) { const k = matchKey(g.Name); byKey.set(k, byKey.has(k) ? null : g.GroupId); } // ambiguous names don't match
  return {
    groups: groups.recordset.map((g) => ({ groupId: g.GroupId, name: workName(g.Name) })),
    milestones: milestones.recordset.map((m) => {
      // DprGroupId: a DPR work; 0 = set to none on purpose; empty = match by name.
      const auto = byKey.get(matchKey(m.Name)) || null;
      return { id: m.Id, name: m.Name, groupId: m.DprGroupId === 0 ? null : (m.DprGroupId ?? auto), matched: m.DprGroupId == null && auto != null };
    }),
  };
}

// GET /milestone-links — the payment milestones and the DPR work each waits for.
router.get("/milestone-links", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try { res.json(await milestoneLinks(getPool())); }
  catch (e) { console.error("[crm-construction-updates] GET /milestone-links error:", e.message); res.status(500).json({ error: "Could not load the milestone links" }); }
});

// PUT /milestone-links { links: [{ id, groupId|null }] } — set which DPR work a milestone waits for (null: none).
router.put("/milestone-links", requirePageRight("crm-construction-updates", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const links = Array.isArray(req.body?.links) ? req.body.links : [];
    for (const l of links) {
      const id = parseId(l.id); if (!id) continue;
      const gid = l.groupId == null || l.groupId === "" ? 0 : parseId(l.groupId);
      if (gid) {
        const ok = (await pool.request().input("g", sql.Int, gid).query("SELECT 1 AS x FROM dbo.ActivityMaster WHERE id = @g AND activity_type = 0")).recordset.length;
        if (!ok) return res.status(400).json({ error: "A DPR work picked does not exist" });
      }
      await pool.request().input("id", sql.Int, id).input("g", sql.Int, gid).input("u", sql.Int, actorId(req))
        .query("UPDATE dbo.CrmMilestoneMaster SET DprGroupId = @g, UpdatedBy = @u, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-construction-updates] PUT /milestone-links error:", e.message);
    res.status(500).json({ error: "Could not save the milestone links" });
  }
});

/**
 * Payment milestones whose DPR work is complete and are not demanded or paid yet. A booking milestone reaches its
 * milestone master through the booking's plan template item. The work is judged at the level the booking's payment
 * plan was set for (the same tags getApplicablePaymentPlans reads): a plan set for the unit -> the unit; for its tower
 * -> the tower; for the project, or not tagged -> the project. Only where that level has no DPR steps for the work is
 * it judged one level up.
 */
async function readyDemands(pool, { bookingId = null, projectId = null, scope = null } = {}) {
  const links = new Map((await milestoneLinks(pool)).milestones.filter((m) => m.groupId).map((m) => [m.id, m.groupId]));
  if (!links.size) return [];
  const r = pool.request();
  const conds = ["b.IsActive = 1", "m.Status NOT IN ('Paid', 'Waived')", "ISNULL(m.DemandStatus, 'Pending') = 'Pending'", "m.ExtraChargeId IS NULL", "m.ParkingAllotmentId IS NULL",
    `ti.MilestoneMasterId IN (${[...links.keys()].join(",")})`];
  if (bookingId) { r.input("bid", sql.Int, bookingId); conds.push("b.Id = @bid"); }
  if (projectId) { r.input("pid", sql.Int, projectId); conds.push("b.ProjectId = @pid"); }
  const rows = (await r.query(`
    SELECT m.Id AS MilestoneId, m.MilestoneNo, m.MilestoneName, m.AmountDue, b.Id AS BookingId, b.BookingNo, b.ProjectId, b.UnitId, u.BlockId,
           b.UnitNo, a.ApplicantName, ti.MilestoneMasterId,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmUnitPaymentPlan x WHERE x.UnitId = b.UnitId AND x.PlanId = b.PaymentPlanId AND x.IsActive = 1) THEN 'Unit'
                WHEN EXISTS (SELECT 1 FROM dbo.CrmBlockPaymentPlan x WHERE x.BlockId = u.BlockId AND x.PlanId = b.PaymentPlanId AND x.IsActive = 1) THEN 'Tower'
                ELSE 'Project' END AS PlanLevel
    FROM dbo.CrmPaymentMilestone m
    JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.UnitMaster u ON u.Id = b.UnitId
    JOIN dbo.CrmPaymentPlanTemplateItem ti ON ti.PlanTemplateId = b.PaymentPlanId AND ti.MilestoneNo = m.MilestoneNo
    WHERE ${conds.join(" AND ")} AND b.Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL}${projectPredicate(scope, "b.ProjectId")}
    ORDER BY b.ProjectId, b.BookingNo, m.MilestoneNo`)).recordset;
  if (!rows.length) return [];
  const prog = await constructionProgress(pool, rows.map((x) => x.ProjectId));
  const out = [];
  for (const x of rows) {
    const p = prog.get(x.ProjectId); if (!p?.hasDpr) continue;
    const gid = links.get(x.MilestoneMasterId);
    const workIn = (place) => place?.works.find((w) => w.groupId === gid) || null;
    const levels = [
      ["Unit", workIn(p.flats.get(Number(x.UnitId)))],
      ["Tower", workIn(p.towers.find((t) => Number(t.blockId) === Number(x.BlockId)))],
      ["Project", workIn(p)],
    ];
    // From the plan's own level upward, the first place the site tracks this work.
    const from = levels.findIndex(([lvl]) => lvl === x.PlanLevel);
    const hit = levels.slice(from < 0 ? 2 : from).find(([, w]) => w);
    if (hit && hit[1].pct >= 100) out.push({ ...x, work: hit[1].name, judgedOn: hit[0] });
  }
  return out;
}

// GET /ready-demands?bookingId=&projectId= — milestones whose DPR work is complete (payments staff may read it too).
router.get("/ready-demands", requireAnyPageRight(["crm-construction-updates", "crm-payments"], "view"), async (req, res) => {
  try {
    const projectId = req.query.projectId ? parseId(req.query.projectId) : null;
    if (projectId && !projectAllowed(req.projectScope, projectId)) return res.status(403).json({ error: "You don't have access to this project" });
    res.json(await readyDemands(getPool(), { bookingId: req.query.bookingId ? parseId(req.query.bookingId) : null, projectId, scope: req.projectScope }));
  } catch (e) {
    console.error("[crm-construction-updates] GET /ready-demands error:", e.message);
    res.status(500).json({ error: "Could not work out the milestones ready to demand" });
  }
});

// GET / — staff notes to buyers, newest first; ?projectId=
router.get("/", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const r0 = getPool().request();
    const conds = [];
    if (req.query.projectId) { r0.input("pid", sql.Int, parseInt(req.query.projectId, 10) || 0); conds.push("u.ProjectId = @pid"); }
    if (req.projectScope) conds.push(projectPredicate(req.projectScope, "u.ProjectId", "").trim());
    const result = await r0.query(`
      SELECT u.*, cu.name AS CreatedByName FROM dbo.CrmConstructionUpdate u LEFT JOIN dbo.Users cu ON cu.id = u.CreatedBy
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY u.UpdateDate DESC, u.Id DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-construction-updates] GET error:", e.message);
    res.status(500).json({ error: "Could not load the construction notes" });
  }
});

// POST / — a note for the buyers of a project (shown with the live progress in their portal).
router.post("/", requirePageRight("crm-construction-updates", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    const pid = parseId(b.ProjectId);
    if (!pid) return res.status(400).json({ error: "ProjectId is required — select a project from Unit Master" });
    if (!assertProjectAllowed(req, res, pid)) return;
    const proj = (await pool.request().input("pid", sql.Int, pid).query("SELECT name FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'")).recordset[0];
    if (!proj) return res.status(400).json({ error: "Selected project does not exist" });
    if (!String(b.Summary || "").trim()) return res.status(400).json({ error: "Write the note for buyers" });
    // The note carries the live figure at the time it was written (it is customer-visible: a typed % could be wrong).
    const g = (await constructionProgress(pool, [pid])).get(pid);
    const pct = g.hasDpr ? g.pct : (b.PercentComplete != null && b.PercentComplete !== "" ? Number(b.PercentComplete) : null);
    if (pct != null && !(pct >= 0 && pct <= 100)) return res.status(400).json({ error: "Percent Complete must be between 0 and 100" });
    const stage = g.hasDpr ? (g.now[0]?.name || (g.allDone ? "Complete" : g.next) || null) : (b.Stage || null);
    await pool.request()
      .input("pid", sql.Int, pid).input("proj", sql.NVarChar(200), proj.name)
      .input("dt", sql.Date, b.UpdateDate || null).input("pct", sql.Decimal(5, 2), pct)
      .input("stage", sql.NVarChar(100), stage).input("sum", sql.NVarChar(sql.MAX), String(b.Summary).trim()).input("cb", sql.Int, actorId(req))
      .query(`INSERT INTO dbo.CrmConstructionUpdate (ProjectId, ProjectName, UpdateDate, PercentComplete, Stage, Summary, CreatedBy, CreatedAt)
              VALUES (@pid, @proj, ISNULL(@dt, CAST(SYSDATETIME() AS DATE)), @pct, @stage, @sum, @cb, SYSDATETIME())`);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-construction-updates] POST error:", e.message);
    res.status(500).json({ error: "Could not save the note" });
  }
});

module.exports = router;
module.exports.constructionProgress = constructionProgress;
module.exports.unitProgress = unitProgress;
module.exports.siteFeed = siteFeed;
module.exports.readyDemands = readyDemands;

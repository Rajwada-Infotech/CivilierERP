"use strict";
/**
 * Notice Board (HR): notices for All employees or chosen departments. Mounted at /api/employee-notices.
 * Employees read them through /api/employee-portal/notices (routes/employeePortal.js).
 *
 *   GET    /                list (with departments, audience size, read count)
 *   GET    /departments     active departments to choose from
 *   POST   /                create { title, body, audience, departmentIds[], priority, pinned, publishFrom, expiresOn }
 *   PUT    /:id             update
 *   DELETE /:id             remove (soft)
 */
const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

const PAGE = "employee-notice";
const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const idParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function clean(b = {}) {
  const title = text(b.title, 200);
  const body = text(b.body, 4000);
  if (!title) return { error: "Write the notice title" };
  if (!body) return { error: "Write the notice" };
  const audience = b.audience === "Departments" ? "Departments" : "All";
  const departmentIds = audience === "Departments" ? [...new Set((Array.isArray(b.departmentIds) ? b.departmentIds : []).map(idParam).filter(Boolean))] : [];
  if (audience === "Departments" && !departmentIds.length) return { error: "Choose at least one department" };
  const publishFrom = isoDate(b.publishFrom) || todayIst();
  const expiresOn = isoDate(b.expiresOn);
  if (expiresOn && expiresOn < publishFrom) return { error: "The end date can't be before the start date" };
  return { title, body, audience, departmentIds, priority: b.priority === "Important" ? "Important" : "Normal", pinned: !!b.pinned, publishFrom, expiresOn };
}

// Employees a notice reaches: active employees, all or those whose Department matches a chosen department's name.
const AUDIENCE_SQL = `
  (SELECT COUNT(*) FROM dbo.EmployeeMaster e WHERE e.IsActive = 1 AND (n.Audience = N'All' OR EXISTS (
     SELECT 1 FROM dbo.EmployeeNoticeDepartment nd JOIN dbo.DepartmentMaster d ON d.Id = nd.DepartmentId
     WHERE nd.NoticeId = n.NoticeId AND LOWER(LTRIM(RTRIM(d.DepartmentName))) = LOWER(LTRIM(RTRIM(e.Department))))))`;

router.get("/", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const rows = (await getPool().request().query(`
      SELECT n.NoticeId, n.Title, n.Body, n.Audience, n.Priority, n.IsPinned, CONVERT(char(10), n.PublishFrom, 23) AS PublishFrom,
             CONVERT(char(10), n.ExpiresOn, 23) AS ExpiresOn, n.CreatedAt, n.UpdatedAt,
             (SELECT name FROM dbo.users WHERE id = n.CreatedBy) AS CreatedByName,
             (SELECT STRING_AGG(CAST(nd.DepartmentId AS varchar(10)), ',') FROM dbo.EmployeeNoticeDepartment nd WHERE nd.NoticeId = n.NoticeId) AS DepartmentIds,
             (SELECT STRING_AGG(d.DepartmentName, ', ') FROM dbo.EmployeeNoticeDepartment nd JOIN dbo.DepartmentMaster d ON d.Id = nd.DepartmentId WHERE nd.NoticeId = n.NoticeId) AS Departments,
             ${AUDIENCE_SQL} AS AudienceCount,
             (SELECT COUNT(*) FROM dbo.EmployeeNoticeRead r WHERE r.NoticeId = n.NoticeId) AS ReadCount
      FROM dbo.EmployeeNotice n WHERE n.IsActive = 1
      ORDER BY n.IsPinned DESC, n.PublishFrom DESC, n.NoticeId DESC`)).recordset;
    res.json(rows.map((r) => ({ ...r, DepartmentIds: r.DepartmentIds ? r.DepartmentIds.split(",").map(Number) : [] })));
  } catch (err) {
    console.error("[notices] list:", err.message);
    res.status(500).json({ error: "Could not load notices" });
  }
});

router.get("/departments", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    res.json((await getPool().request().query(`
      SELECT d.Id, d.DepartmentName,
             (SELECT COUNT(*) FROM dbo.EmployeeMaster e WHERE e.IsActive = 1 AND LOWER(LTRIM(RTRIM(e.Department))) = LOWER(LTRIM(RTRIM(d.DepartmentName)))) AS Employees
      FROM dbo.DepartmentMaster d WHERE d.IsActive = 1 ORDER BY d.DepartmentName`)).recordset);
  } catch (err) {
    console.error("[notices] departments:", err.message);
    res.status(500).json({ error: "Could not load departments" });
  }
});

async function save(req, res, id) {
  const n = clean(req.body);
  if (n.error) return res.status(400).json({ error: n.error });
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = new sql.Request(tx).input("T", sql.NVarChar(200), n.title).input("B", sql.NVarChar(4000), n.body).input("A", sql.NVarChar(20), n.audience)
      .input("P", sql.NVarChar(20), n.priority).input("Pin", sql.Bit, n.pinned).input("F", sql.Date, n.publishFrom).input("X", sql.Date, n.expiresOn)
      .input("U", sql.Int, req.user?.userId || null).input("Id", sql.Int, id);
    let noticeId = id;
    if (id) {
      const u = await r.query(`UPDATE dbo.EmployeeNotice SET Title = @T, Body = @B, Audience = @A, Priority = @P, IsPinned = @Pin, PublishFrom = @F, ExpiresOn = @X,
        UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE NoticeId = @Id AND IsActive = 1`);
      if (!u.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: "Notice not found" }); }
      await new sql.Request(tx).input("Id", sql.Int, id).query("DELETE FROM dbo.EmployeeNoticeDepartment WHERE NoticeId = @Id");
    } else {
      noticeId = (await r.query(`INSERT INTO dbo.EmployeeNotice (Title, Body, Audience, Priority, IsPinned, PublishFrom, ExpiresOn, CreatedBy)
        OUTPUT INSERTED.NoticeId VALUES (@T, @B, @A, @P, @Pin, @F, @X, @U)`)).recordset[0].NoticeId;
    }
    for (const d of n.departmentIds) {
      await new sql.Request(tx).input("N", sql.Int, noticeId).input("D", sql.Int, d)
        .query("IF EXISTS (SELECT 1 FROM dbo.DepartmentMaster WHERE Id = @D) INSERT INTO dbo.EmployeeNoticeDepartment (NoticeId, DepartmentId) VALUES (@N, @D)");
    }
    await tx.commit();
    res.json({ message: id ? "Notice updated" : "Notice published", noticeId });
  } catch (err) {
    await tx.rollback().catch(() => {});
    console.error("[notices] save:", err.message);
    res.status(500).json({ error: "Could not save the notice" });
  }
}
router.post("/", requirePageRight(PAGE, "create"), (req, res) => save(req, res, null));
router.put("/:id", requirePageRight(PAGE, "edit"), (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid notice" });
  return save(req, res, id);
});
router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid notice" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).input("U", sql.Int, req.user?.userId || null)
      .query("UPDATE dbo.EmployeeNotice SET IsActive = 0, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE NoticeId = @Id AND IsActive = 1");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Notice not found" });
    res.json({ message: "Notice removed" });
  } catch (err) {
    console.error("[notices] delete:", err.message);
    res.status(500).json({ error: "Could not remove the notice" });
  }
});

module.exports = router;

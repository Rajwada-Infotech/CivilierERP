"use strict";
// Deed Registry Search on enquiry land (mounted at /api/legal/enquiry-search).
// When an enquiry is saved it gets a timeline for every registration office type that applies to its state
// (Setup → Registration Office Types, "Timeline on every new enquiry"): due = enquiry date + that type's time limit. Per office the user searches the government site year by
// year (the type's first year → this year), records what was found for each year (or a whole range as not found),
// then marks that office's search complete.
// An office still open past its due date shows on the Legal dashboard and its people are notified (worker, daily).
// Land Conversion waits until every office's search is complete.
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const { writeAudit } = require("./legalAudit");
const apiRateLimit = require("../../middleware/apiRateLimit");

const router = express.Router();
router.use(apiRateLimit);
const PAGE = "legal-land-enquiry";
const FIRST_YEAR = 1956;
const RESULTS = ["Found", "Not Found"];

const idOf = (v) => (/^\d+$/.test(String(v ?? "")) ? Number(v) : null);
const txt = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const thisYear = () => new Date().getFullYear();

async function ready(pool) {
  const r = (await pool.request().query("SELECT OBJECT_ID('dbo.LegalEnquiryOfficeSearch','U') AS t, OBJECT_ID('dbo.LegalRegistrationOfficeType','U') AS m")).recordset[0];
  return !!(r.t && r.m);
}
const notReady = (res) => res.status(503).json({ error: "Deed Registry Search is not set up yet — run the database migrations (655–658)" });

/** Gives an enquiry its office timelines (one per office type) if it has none yet. */
async function ensureOfficeTimelines(pool, enquiryId) {
  if (!(await ready(pool))) return;
  await pool.request().input("id", sql.Int, enquiryId).query(`
    INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate)
    SELECT e.EnquiryId, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear, DATEADD(day, t.SlaDays, e.EnquiryDate)
    FROM dbo.LegalLandEnquiry e
    LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
    JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1 AND (t.StateName IS NULL OR t.StateName = d.State)
    WHERE e.EnquiryId = @id AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch x WHERE x.EnquiryId = e.EnquiryId AND x.OfficeType = t.TypeName)`);
}

// Per enquiry: offices total / complete, the nearest open due date, the worst overdue.
// A rejected enquiry is not waiting for anyone: never pending or overdue.
const PENDING = "e.EnquiryStatus <> N'Rejected' AND EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending')";
const ENQ_STATE = `
  (SELECT COUNT(*) FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId) AS OfficesTotal,
  (SELECT COUNT(*) FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Completed') AS OfficesDone,
  (SELECT CONVERT(char(10), MIN(o.DueDate), 23) FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending') AS NextDue,
  CASE WHEN e.EnquiryStatus = N'Rejected' THEN 0 ELSE ISNULL((SELECT MAX(DATEDIFF(day, o.DueDate, CAST(GETDATE() AS DATE))) FROM dbo.LegalEnquiryOfficeSearch o
    WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE)), 0) END AS DaysOver`;

const OFFICE_COLS = `o.OfficeSearchId, o.EnquiryId, o.OfficeTypeId, o.OfficeType, o.OfficeId, r.OfficeName, o.SlaDays, o.FromYear, CONVERT(char(10), o.DueDate, 23) AS DueDate,
  o.Status, o.Remarks, o.CompletedAt, cu.name AS CompletedByName,
  CASE WHEN o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE) THEN DATEDIFF(day, o.DueDate, CAST(GETDATE() AS DATE)) ELSE 0 END AS DaysOver`;
const OFFICE_FROM = `FROM dbo.LegalEnquiryOfficeSearch o
  LEFT JOIN dbo.LegalRegistrationOffice r ON r.OfficeId = o.OfficeId
  LEFT JOIN dbo.users cu ON cu.id = o.CompletedBy`;

// GET /options — offices in the master, office types with limits, calendar years 1956 → this year.
router.get("/options", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const sla = (await pool.request().query(`SELECT OfficeTypeId, TypeName AS OfficeType, SlaDays AS Days, FromYear, StateName
      FROM dbo.LegalRegistrationOfficeType WHERE IsActive = 1 ORDER BY SortOrder, TypeName`)).recordset;
    const offices = (await pool.request().query(`SELECT o.OfficeId, o.OfficeName, o.OfficeTypeId, o.OfficeType, d.DistrictName, ISNULL(d.State, o.State) AS StateName FROM dbo.LegalRegistrationOffice o
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = o.DistrictId WHERE ISNULL(o.IsActive, 1) = 1 ORDER BY d.DistrictName, o.OfficeName`)).recordset;
    const years = [];
    const first = Math.min(FIRST_YEAR, ...sla.map((t) => t.FromYear));
    for (let y = thisYear(); y >= first; y--) years.push(y);
    res.json({ officeTypes: sla, offices, years });
  } catch (err) {
    console.error("[legal-enquiry-search] options:", err.message);
    res.status(500).json({ error: "Could not load the search options" });
  }
});

// POST /offices { officeName, officeType, enquiryId } — an office typed in the search that is not in the master yet is
// added to Setup → Deed Registration Office (district from the enquiry), so it is offered next time.
router.post("/offices", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const name = txt(req.body?.officeName, 200);
    const typeId = idOf(req.body?.officeTypeId);
    const enquiryId = idOf(req.body?.enquiryId);
    if (!name) return res.status(400).json({ error: "Enter the office name" });
    const tRow = (await pool.request().input("t", sql.Int, typeId).query("SELECT TypeName FROM dbo.LegalRegistrationOfficeType WHERE OfficeTypeId = @t")).recordset[0];
    if (!tRow) return res.status(400).json({ error: "Select the registration office type" });
    const type = tRow.TypeName;
    const same = (await pool.request().input("n", sql.NVarChar(200), name).input("t", sql.NVarChar(60), type)
      .query("SELECT OfficeId, OfficeName, OfficeType FROM dbo.LegalRegistrationOffice WHERE OfficeName = @n AND (OfficeType = @t)")).recordset[0];
    if (same) return res.json({ ...same, message: "Office already in the master" });
    const d = (await pool.request().input("e", sql.Int, enquiryId).query(`SELECT d.DistrictId, d.DistrictName, d.State FROM dbo.LegalLandEnquiry e
      JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId WHERE e.EnquiryId = @e`)).recordset[0];
    if (!d) return res.status(400).json({ error: "Select the enquiry land first" });
    const prefix = type.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase();
    const row = (await pool.request().input("n", sql.NVarChar(200), name).input("t", sql.NVarChar(60), type).input("p", sql.NVarChar(10), prefix)
      .input("d", sql.Int, d.DistrictId).input("dn", sql.NVarChar(200), d.DistrictName).input("st", sql.NVarChar(100), d.State || "West Bengal")
      .input("u", sql.Int, (req.user?.userId ?? req.user?.id ?? null))
      .input("ti", sql.Int, typeId)
      .query(`INSERT INTO dbo.LegalRegistrationOffice (OfficeCode, OfficeName, OfficeType, OfficeTypeId, State, District, DistrictId, IsActive, CreatedBy)
        OUTPUT INSERTED.OfficeId, INSERTED.OfficeName, INSERTED.OfficeType
        SELECT @p + '-' + RIGHT('0000' + CAST(ISNULL(MAX(OfficeId), 0) + 1 AS VARCHAR(10)), 4), @n, @t, @ti, @st, @dn, @d, 1, @u
        FROM dbo.LegalRegistrationOffice WITH (UPDLOCK, HOLDLOCK)`)).recordset[0];
    await writeAudit(pool, req, { action: "Created", entityType: "Deed Registration Office", entityId: row.OfficeId, newValue: row }).catch(() => {});
    res.status(201).json({ ...row, DistrictName: d.DistrictName, message: `${name} added to the office master` });
  } catch (err) {
    console.error("[legal-enquiry-search] add office:", err.message);
    res.status(500).json({ error: "Could not add the office" });
  }
});

// GET /find?projectId=&tab=pending|done|all&q= — enquiries of a project, by enquiry no, Land ID, RS / LR Dag or Khatian.
router.get("/find", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const projectId = idOf(req.query.projectId);
    if (!projectId) return res.status(400).json({ error: "Select the project first" });
    const q = txt(req.query.q, 60);
    const tab = ["pending", "done"].includes(req.query.tab) ? req.query.tab : "all";
    const tabSql = tab === "pending" ? `AND e.LandId IS NULL AND ${PENDING}` : tab === "done" ? `AND NOT (e.LandId IS NULL AND ${PENDING})` : "";
    const rows = (await pool.request().input("p", sql.Int, projectId).input("q", sql.NVarChar(80), q ? `%${q}%` : null).query(`
      SELECT TOP 100 e.EnquiryId, e.EnquiryNo, e.LandLocation, e.EnquiryStatus, e.FinYear, e.JLNo, e.RsDagNo, e.LrDagNo, e.RsKhatianNo, e.LrKhatianNo,
             e.LandId, l.LandCode, d.DistrictName, d.State AS StateName, m.MouzaName, CONVERT(char(10), e.EnquiryDate, 23) AS EnquiryDate, ${ENQ_STATE},
             (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = e.EnquiryId AND s.Status = N'Found') AS Found
      FROM dbo.LegalLandEnquiry e
      LEFT JOIN dbo.LegalLand l ON l.LandId = e.LandId
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
      WHERE e.IsActive = 1 AND e.ProjectId = @p ${tabSql} AND (@q IS NULL
        OR e.EnquiryNo LIKE @q OR l.LandCode LIKE @q OR e.RsDagNo LIKE @q OR e.LrDagNo LIKE @q OR e.RsKhatianNo LIKE @q OR e.LrKhatianNo LIKE @q
        OR EXISTS (SELECT 1 FROM dbo.LegalLandRsRecord x WHERE x.LandId = e.LandId AND x.IsActive = 1 AND (x.RsDagNo LIKE @q OR x.RsKhatianNo LIKE @q))
        OR EXISTS (SELECT 1 FROM dbo.LegalLandLrRecord x WHERE x.LandId = e.LandId AND x.IsActive = 1 AND (x.LrDagNo LIKE @q OR x.LrKhatianNo LIKE @q)))
      ORDER BY CASE WHEN e.LandId IS NULL AND ${PENDING} THEN 0 ELSE 1 END, e.EnquiryDate DESC, e.EnquiryId DESC`)).recordset;
    res.json(rows);
  } catch (err) {
    console.error("[legal-enquiry-search] find:", err.message);
    res.status(500).json({ error: "Could not search the enquiries" });
  }
});

// GET /overdue — office searches still open past their due date (dashboard).
router.get("/overdue", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json([]);
    const rows = (await pool.request().query(`SELECT ${OFFICE_COLS}, e.EnquiryNo, p.name AS ProjectName ${OFFICE_FROM}
      JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId AND e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected'
      LEFT JOIN dbo.enterprise p ON p.id = e.ProjectId
      WHERE o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE) ORDER BY o.DueDate, e.EnquiryNo`)).recordset;
    res.json(rows);
  } catch (err) {
    console.error("[legal-enquiry-search] overdue:", err.message);
    res.status(500).json({ error: "Could not load overdue searches" });
  }
});

// GET /:enquiryId — the enquiry's office timelines and the year results under them.
router.get("/:enquiryId", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.enquiryId);
    if (!id) return res.status(400).json({ error: "Invalid enquiry" });
    await ensureOfficeTimelines(pool, id);
    const offices = (await pool.request().input("id", sql.Int, id).query(`SELECT ${OFFICE_COLS} ${OFFICE_FROM}
      LEFT JOIN dbo.LegalRegistrationOfficeType s ON s.OfficeTypeId = o.OfficeTypeId WHERE o.EnquiryId = @id ORDER BY s.SortOrder, o.OfficeType`)).recordset;
    const years = (await pool.request().input("id", sql.Int, id).query(`
      SELECT s.SearchId, s.OfficeType, s.CalendarYear, s.Status, s.DeedNo, CONVERT(char(10), s.DeedDate, 23) AS DeedDate, s.Parties, s.Details, s.SiteName,
             ISNULL(s.CompletedAt, s.RequestedAt) AS RecordedAt, ISNULL(cu.name, ru.name) AS RecordedByName
      FROM dbo.LegalEnquiryDeedSearch s LEFT JOIN dbo.users cu ON cu.id = s.CompletedBy LEFT JOIN dbo.users ru ON ru.id = s.RequestedBy
      WHERE s.EnquiryId = @id ORDER BY s.CalendarYear DESC, s.SearchId DESC`)).recordset;
    res.json({ offices, years });
  } catch (err) {
    console.error("[legal-enquiry-search] list:", err.message);
    res.status(500).json({ error: "Could not load the searches" });
  }
});

const officeRow = async (pool, osid) => (await pool.request().input("o", sql.Int, osid)
  .query("SELECT o.*, CONVERT(char(10), o.DueDate, 23) AS Due FROM dbo.LegalEnquiryOfficeSearch o WHERE o.OfficeSearchId = @o")).recordset[0];

// PUT /office/:id { officeId } — the specific office (from the master) searched for this office type.
router.put("/office/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const officeId = idOf(req.body?.officeId);
    if (officeId) {
      const r = (await pool.request().input("i", sql.Int, officeId).query("SELECT OfficeType FROM dbo.LegalRegistrationOffice WHERE OfficeId = @i")).recordset[0];
      // (matched by name: offices and timelines both keep the type's name)
      if (!r) return res.status(400).json({ error: "Registration office not found" });
      if (r.OfficeType !== o.OfficeType) return res.status(400).json({ error: `That office is not a ${o.OfficeType}` });
    }
    await pool.request().input("o", sql.Int, o.OfficeSearchId).input("i", sql.Int, officeId).query("UPDATE dbo.LegalEnquiryOfficeSearch SET OfficeId = @i WHERE OfficeSearchId = @o");
    res.json({ message: "Office set" });
  } catch (err) {
    console.error("[legal-enquiry-search] set office:", err.message);
    res.status(500).json({ error: "Could not set the office" });
  }
});

// POST /office/:id/year { calendarYear, result, deedNo, deedDate, parties, details, siteName } — a year's result at this office.
router.post("/office/:id/year", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const year = idOf(req.body?.calendarYear);
    const result = RESULTS.includes(req.body?.result) ? req.body.result : null;
    const from = o.FromYear || FIRST_YEAR;
    if (!year || year < from || year > thisYear()) return res.status(400).json({ error: `Calendar year must be ${from} to ${thisYear()}` });
    if (!result) return res.status(400).json({ error: "Choose Found or Not Found" });
    const deedNo = txt(req.body?.deedNo, 100);
    if (result === "Found" && !deedNo) return res.status(400).json({ error: "Enter the deed number found" });
    const dup = (await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("y", sql.Int, year)
      .query("SELECT 1 AS x FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @e AND OfficeType = @t AND CalendarYear = @y")).recordset[0];
    if (dup) return res.status(409).json({ error: `${year} is already recorded for ${o.OfficeType} — edit it instead` });
    const u = (req.user?.userId ?? req.user?.id ?? null);
    await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("oi", sql.Int, o.OfficeId).input("y", sql.Int, year)
      .input("st", sql.NVarChar(20), result).input("sd", sql.Int, o.SlaDays).input("due", sql.Date, o.Due)
      .input("dn", sql.NVarChar(100), result === "Found" ? deedNo : null).input("dd", sql.Date, result === "Found" ? dateOf(req.body?.deedDate) : null)
      .input("pa", sql.NVarChar(500), result === "Found" ? txt(req.body?.parties, 500) : null)
      .input("de", sql.NVarChar(2000), txt(req.body?.details, 2000)).input("si", sql.NVarChar(200), txt(req.body?.siteName, 200)).input("u", sql.Int, u)
      .query(`INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName,
          RequestedBy, CompletedBy, CompletedAt) VALUES (@e, @t, @oi, @y, @st, @sd, @due, @dn, @dd, @pa, @de, @si, @u, @u, SYSUTCDATETIME())`);
    await writeAudit(pool, req, { action: "Deed search recorded", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType, year, result, deedNo } }).catch(() => {});
    res.status(201).json({ message: result === "Found" ? `Deed ${deedNo} (${year}) stored on the enquiry` : `${o.OfficeType} ${year}: no deed found` });
  } catch (err) {
    console.error("[legal-enquiry-search] year:", err.message);
    res.status(500).json({ error: "Could not save the result" });
  }
});

// PUT /item/:searchId — correct a year's result. DELETE /item/:searchId — remove a wrong one.
router.put("/item/:searchId", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const sid = idOf(req.params.searchId);
    const result = RESULTS.includes(req.body?.result) ? req.body.result : null;
    if (!sid) return res.status(400).json({ error: "Invalid search" });
    if (!result) return res.status(400).json({ error: "Choose Found or Not Found" });
    const deedNo = txt(req.body?.deedNo, 100);
    if (result === "Found" && !deedNo) return res.status(400).json({ error: "Enter the deed number found" });
    const r = await pool.request().input("s", sql.Int, sid).input("st", sql.NVarChar(20), result)
      .input("dn", sql.NVarChar(100), result === "Found" ? deedNo : null)
      .input("dd", sql.Date, result === "Found" ? dateOf(req.body?.deedDate) : null)
      .input("pa", sql.NVarChar(500), result === "Found" ? txt(req.body?.parties, 500) : null)
      .input("de", sql.NVarChar(2000), txt(req.body?.details, 2000)).input("si", sql.NVarChar(200), txt(req.body?.siteName, 200))
      .input("u", sql.Int, (req.user?.userId ?? req.user?.id ?? null))
      .query(`UPDATE dbo.LegalEnquiryDeedSearch SET Status = @st, DeedNo = @dn, DeedDate = @dd, Parties = @pa, Details = @de, SiteName = @si,
          CompletedBy = @u, CompletedAt = SYSUTCDATETIME() OUTPUT INSERTED.EnquiryId WHERE SearchId = @s`);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Result not found" });
    await writeAudit(pool, req, { action: "Deed search corrected", entityType: "Land Enquiry", entityId: row.EnquiryId, newValue: { searchId: sid, result, deedNo } }).catch(() => {});
    res.json({ message: "Result updated" });
  } catch (err) {
    console.error("[legal-enquiry-search] edit:", err.message);
    res.status(500).json({ error: "Could not save the result" });
  }
});
router.delete("/item/:searchId", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().input("s", sql.Int, idOf(req.params.searchId))
      .query("DELETE FROM dbo.LegalEnquiryDeedSearch OUTPUT DELETED.EnquiryId, DELETED.OfficeType, DELETED.CalendarYear WHERE SearchId = @s");
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Result not found" });
    await writeAudit(pool, req, { action: "Deed search deleted", entityType: "Land Enquiry", entityId: row.EnquiryId, oldValue: row }).catch(() => {});
    res.json({ message: "Result removed" });
  } catch (err) {
    console.error("[legal-enquiry-search] delete:", err.message);
    res.status(500).json({ error: "Could not remove the result" });
  }
});

// POST /office/:id/range { from, to, siteName, details } — every year in the range not recorded yet is stored as
// "Not Found" (a whole stretch checked on the site in one go). Years already recorded are left as they are.
router.post("/office/:id/range", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const first = o.FromYear || FIRST_YEAR;
    const from = idOf(req.body?.from), to = idOf(req.body?.to);
    if (!from || !to || from > to || from < first || to > thisYear()) return res.status(400).json({ error: `Choose years between ${first} and ${thisYear()}` });
    const u = (req.user?.userId ?? req.user?.id ?? null);
    const r = await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("oi", sql.Int, o.OfficeId)
      .input("f", sql.Int, from).input("to", sql.Int, to).input("sd", sql.Int, o.SlaDays).input("due", sql.Date, o.Due)
      .input("de", sql.NVarChar(2000), txt(req.body?.details, 2000)).input("si", sql.NVarChar(200), txt(req.body?.siteName, 200)).input("u", sql.Int, u)
      .query(`WITH y AS (SELECT @f AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < @to)
        INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
        SELECT @e, @t, @oi, y.Y, N'Not Found', @sd, @due, @de, @si, @u, @u, SYSUTCDATETIME() FROM y
        WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = @e AND x.OfficeType = @t AND x.CalendarYear = y.Y)
        OPTION (MAXRECURSION 400)`);
    const n = r.rowsAffected[0] || 0;
    await writeAudit(pool, req, { action: "Deed search range recorded", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType, from, to, years: n } }).catch(() => {});
    res.status(201).json({ message: n ? `${o.OfficeType}: ${n} year${n > 1 ? "s" : ""} (${from}–${to}) recorded as not found` : "Every year in that range is already recorded" });
  } catch (err) {
    console.error("[legal-enquiry-search] range:", err.message);
    res.status(500).json({ error: "Could not save the range" });
  }
});

// POST /office/:id/complete { remarks } — this office's search is done (stops its timeline). POST /office/:id/reopen.
router.post("/office/:id/complete", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const n = (await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType)
      .query("SELECT COUNT(*) AS n FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @e AND OfficeType = @t")).recordset[0].n;
    const remarks = txt(req.body?.remarks, 1000);
    if (!n && !remarks) return res.status(400).json({ error: "Record at least one year's result, or write remarks on what was searched" });
    await pool.request().input("o", sql.Int, o.OfficeSearchId).input("r", sql.NVarChar(1000), remarks).input("u", sql.Int, (req.user?.userId ?? req.user?.id ?? null))
      .query("UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', Remarks = @r, CompletedBy = @u, CompletedAt = SYSUTCDATETIME() WHERE OfficeSearchId = @o");
    await writeAudit(pool, req, { action: "Office search completed", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType, remarks } }).catch(() => {});
    res.json({ message: `${o.OfficeType} search complete` });
  } catch (err) {
    console.error("[legal-enquiry-search] complete:", err.message);
    res.status(500).json({ error: "Could not complete the search" });
  }
});
router.post("/office/:id/reopen", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    await pool.request().input("o", sql.Int, o.OfficeSearchId)
      .query("UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Pending', CompletedBy = NULL, CompletedAt = NULL, AlertOn = NULL WHERE OfficeSearchId = @o");
    await writeAudit(pool, req, { action: "Office search reopened", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType } }).catch(() => {});
    res.json({ message: `${o.OfficeType} search reopened` });
  } catch (err) {
    console.error("[legal-enquiry-search] reopen:", err.message);
    res.status(500).json({ error: "Could not reopen" });
  }
});

module.exports = router;
module.exports.ensureOfficeTimelines = ensureOfficeTimelines;

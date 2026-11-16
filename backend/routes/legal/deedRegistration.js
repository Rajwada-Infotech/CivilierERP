"use strict";
// Deed Registration workspace (mounted at /api/legal/deed-reg). One land, five steps:
//   1. Consideration (total, rate, date; every change kept as a revision)  2. Payments (schedule of instalments + payments
//      made, in the land's Payment History; the full amount must be paid before Final Registration)
//   3. Registration & Stamp Duty queries (date, amount, fee type)
//   3. Apply to deed register (approver — existing POST /api/legal/land/:id/deed-registration)
//   4. Final Registration (date, office, mode, deed number) → upload the registered deed and submit (existing route)
//   5. Physical Deed / IGR tracking (link, IGR status, where the deed is), kept as history; continues after Registered.
// Every choice list comes from Setup (Payment Mode, Registration Fee Type, Deed Registration Office, Registration Mode,
// IGR Status, Deed Location, Area Unit).
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const { canAct } = require("./approvalAuthority");
const { writeAudit } = require("./legalAudit");
const apiRateLimit = require("../../middleware/apiRateLimit");

const router = express.Router();
router.use(apiRateLimit);
const PAGE = "legal-land-master";

const idOf = (v) => (/^\d+$/.test(String(v ?? "")) ? Number(v) : null);
const txt = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const money = (v) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e15 ? Math.round(n * 100) / 100 : NaN; };
const urlOf = (v) => { const s = txt(v, 500); return s && /^https?:\/\/[^\s]+$/i.test(s) ? s : null; };

async function ready(pool) {
  return !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalDeedTracking','U') AS t")).recordset[0].t;
}
const notReady = (res) => res.status(503).json({ error: "Deed Registration details are not set up yet — run the database migrations (659)" });
const lookupOk = async (pool, id, category) => !id || !!(await pool.request().input("i", sql.Int, id).input("c", sql.NVarChar(40), category)
  .query("SELECT 1 AS x FROM dbo.LegalLookupValue WHERE LookupId = @i AND Category = @c")).recordset[0];
const landIn = async (pool, id) => (await pool.request().input("i", sql.Int, id)
  .query("SELECT LandId, LandCode, WorkflowStatus FROM dbo.LegalLand WHERE LandId = @i AND IsActive = 1")).recordset[0];
const lk = (col) => `(SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = l.${col})`;
// Paid towards the purchase so far: active payments, refunds subtracted; a sale receipt or an expense on the land's
// Payment History is not part of the purchase price. Also the date of the last payment.
const PAID = (alias = "l") => `ISNULL((SELECT SUM(CASE WHEN tt.Name = N'Refund' THEN -p.Amount WHEN tt.Name IN (N'Sale Receipt', N'Expense') THEN 0 ELSE p.Amount END) FROM dbo.LegalPayment p
  LEFT JOIN dbo.LegalLookupValue tt ON tt.LookupId = p.TxnTypeId WHERE p.LandId = ${alias}.LandId AND p.IsActive = 1), 0)`;
const PURCHASE = "ISNULL((SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = p.TxnTypeId), N'') NOT IN (N'Sale Receipt', N'Expense')";
const LAST_PAID = (alias = "l") => `(SELECT CONVERT(char(10), MAX(p.PaymentDate), 23) FROM dbo.LegalPayment p WHERE p.LandId = ${alias}.LandId AND p.IsActive = 1 AND ${PURCHASE})`;
const money2 = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
/** Payment position of one land: total, paid, balance, last payment date. */
async function payState(pool, id) {
  return (await pool.request().input("i", sql.Int, id).query(`SELECT l.ConsTotalAmount AS Total, ${PAID()} AS Paid, ${LAST_PAID()} AS LastPaid
    FROM dbo.LegalLand l WHERE l.LandId = @i`)).recordset[0];
}

// GET /list?tab=active|registered — lands at Deed Registration (active) or registered (deed tracking still going).
router.get("/list", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const tab = req.query.tab === "registered" ? "registered" : "active";
    const rows = (await pool.request().query(`
      SELECT l.LandId, l.LandCode, l.LandName, d.DistrictName, m.MouzaName, l.WorkflowStatus, l.RsDagNo, l.LrDagNo,
             CONVERT(char(10), l.DeedTargetDate, 23) AS DeedTargetDate, l.L2ApprovedAt,
             l.ConsTotalAmount, l.ConsAdvanceAmount, ${PAID()} AS Paid,
             (SELECT COUNT(*) FROM dbo.LegalPaymentSchedule s WHERE s.LandId = l.LandId AND s.DueDate < CAST(GETDATE() AS DATE)
                AND (SELECT SUM(s2.Amount) FROM dbo.LegalPaymentSchedule s2 WHERE s2.LandId = l.LandId AND s2.DueDate <= s.DueDate) > ${PAID()}) AS InstalmentsOverdue,
             (SELECT COUNT(*) FROM dbo.LegalStampDutyQuery q WHERE q.LandId = l.LandId) AS Queries,
             (SELECT SUM(q.Amount) FROM dbo.LegalStampDutyQuery q WHERE q.LandId = l.LandId) AS QueryTotal,
             l.RegAppliedAt, DATEDIFF(day, l.RegAppliedAt, SYSUTCDATETIME()) AS RegDaysOpen,
             CONVERT(char(10), l.RegFinalDate, 23) AS RegFinalDate, l.RegDeedNo, l.RegDeedFileId, l.RegCompletedAt,
             ${lk("IgrStatusId")} AS IgrStatus, ${lk("DeedLocationId")} AS DeedLocation
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.IsActive = 1 AND l.WorkflowStatus = ${tab === "registered" ? "N'Registered'" : "N'Deed Registration'"}
      ORDER BY ${tab === "registered" ? "l.RegCompletedAt DESC" : "l.L2ApprovedAt DESC"}`)).recordset;
    const canApply = (await canAct(req, "L1 Approver", PAGE)) || (await canAct(req, "L2 Approver", PAGE));
    res.json({ lands: rows, canApply });
  } catch (err) {
    console.error("[legal-deed-reg] list:", err.message);
    res.status(500).json({ error: "Could not load Deed Registration" });
  }
});

// GET /instalment-templates — Setup → Instalment Schedule Templates, grouped by template.
router.get("/instalment-templates", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalInstalmentTemplate','U') AS t")).recordset[0].t) return res.json([]);
    const rows = (await pool.request().query(`SELECT t.TemplateName, t.SeqNo, t.Label, t.SharePct, t.DueDays, t.TxnTypeId, x.Name AS Purpose
      FROM dbo.LegalInstalmentTemplate t LEFT JOIN dbo.LegalLookupValue x ON x.LookupId = t.TxnTypeId WHERE t.IsActive = 1 ORDER BY t.TemplateName, t.SeqNo`)).recordset;
    const map = new Map();
    for (const r of rows) { if (!map.has(r.TemplateName)) map.set(r.TemplateName, []); map.get(r.TemplateName).push(r); }
    res.json([...map].map(([name, lines]) => ({ name, lines, totalPct: lines.reduce((a, l) => a + Number(l.SharePct), 0) })));
  } catch (err) {
    console.error("[legal-deed-reg] templates:", err.message);
    res.status(500).json({ error: "Could not load the templates" });
  }
});

// GET /:id — everything the five steps show for one land.
router.get("/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const land = (await pool.request().input("i", sql.Int, id).query(`
      SELECT l.LandId, l.LandCode, l.LandName, l.WorkflowStatus, d.DistrictName, m.MouzaName, m.JLNo, l.RsDagNo, l.RsKhatianNo, l.LrDagNo, l.LrKhatianNo,
             CAST(l.Area AS FLOAT) AS Area, u.UnitName, CONVERT(char(10), l.DeedTargetDate, 23) AS DeedTargetDate,
             (SELECT name FROM dbo.users WHERE id = l.L1ReviewerId) AS L1By, (SELECT name FROM dbo.users WHERE id = l.L2ApproverId) AS L2By, l.L2ApprovedAt,
             (SELECT STRING_AGG(o.OwnerName + N' (' + CAST(CAST(o.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + N'%)', N', ')
                FROM dbo.LegalOwnershipRecord o WHERE o.LandId = l.LandId AND o.IsActive = 1 AND o.ValidTo IS NULL) AS Owners,
             (SELECT TOP 1 v.GovernmentValuation FROM dbo.LegalValuation v WHERE v.LandId = l.LandId AND v.IsActive = 1 ORDER BY v.ValuationDate DESC) AS GovtValue,
             l.DeedFileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = l.DeedFileId) AS DeedFileName,
             l.ConsTotalAmount, l.ConsRate, l.ConsRateUnitId, (SELECT UnitName FROM dbo.LegalAreaUnit x WHERE x.AreaUnitId = l.ConsRateUnitId) AS ConsRateUnit,
             l.ConsAdvanceAmount, CONVERT(char(10), l.ConsDate, 23) AS ConsDate, ${PAID()} AS Paid, ${LAST_PAID()} AS LastPaid, l.ConsPaymentModeId, ${lk("ConsPaymentModeId")} AS ConsPaymentMode, l.ConsRemarks,
             l.RegAppliedAt, (SELECT name FROM dbo.users WHERE id = l.RegAppliedBy) AS RegAppliedByName, DATEDIFF(day, l.RegAppliedAt, SYSUTCDATETIME()) AS RegDaysOpen,
             CONVERT(char(10), l.RegFinalDate, 23) AS RegFinalDate, l.RegOfficeId, (SELECT OfficeName FROM dbo.LegalRegistrationOffice r WHERE r.OfficeId = l.RegOfficeId) AS RegOffice,
             l.RegModeId, ${lk("RegModeId")} AS RegMode, l.RegDeedNo,
             l.RegDeedFileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = l.RegDeedFileId) AS RegDeedFileName, l.RegCompletedAt,
             (SELECT name FROM dbo.users WHERE id = l.RegCompletedBy) AS RegCompletedByName,
             l.IgrTrackingUrl, l.IgrStatusId, ${lk("IgrStatusId")} AS IgrStatus, l.DeedLocationId, ${lk("DeedLocationId")} AS DeedLocation
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      WHERE l.LandId = @i AND l.IsActive = 1`)).recordset[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    const queries = (await pool.request().input("i", sql.Int, id).query(`
      SELECT q.QueryId, CONVERT(char(10), q.QueryDate, 23) AS QueryDate, q.FeeTypeId, f.Name AS FeeType, q.Amount, q.Remarks, u.name AS ByName
      FROM dbo.LegalStampDutyQuery q LEFT JOIN dbo.LegalLookupValue f ON f.LookupId = q.FeeTypeId LEFT JOIN dbo.users u ON u.id = q.CreatedBy
      WHERE q.LandId = @i ORDER BY q.QueryDate DESC, q.QueryId DESC`)).recordset;
    const tracking = (await pool.request().input("i", sql.Int, id).query(`
      SELECT t.TrackId, CONVERT(char(10), t.StatusDate, 23) AS StatusDate, s.Name AS IgrStatus, dl.Name AS DeedLocation, t.TrackingUrl, t.Remarks, u.name AS ByName
      FROM dbo.LegalDeedTracking t LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = t.IgrStatusId LEFT JOIN dbo.LegalLookupValue dl ON dl.LookupId = t.DeedLocationId
      LEFT JOIN dbo.users u ON u.id = t.CreatedBy WHERE t.LandId = @i ORDER BY t.StatusDate DESC, t.TrackId DESC`)).recordset;
    const payments = (await pool.request().input("i", sql.Int, id).query(`
      SELECT p.PaymentId, CONVERT(char(10), p.PaymentDate, 23) AS PaymentDate, t.Name AS Purpose, p.Amount, m.Name AS Mode, p.Payee, p.TransactionRef, p.ReceiptNo,
             p.ReceiptFileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = p.ReceiptFileId) AS ReceiptFileName, p.Remarks, u.name AS ByName
      FROM dbo.LegalPayment p LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = p.TxnTypeId LEFT JOIN dbo.LegalLookupValue m ON m.LookupId = p.PaymentModeId
      LEFT JOIN dbo.users u ON u.id = p.CreatedBy WHERE p.LandId = @i AND p.IsActive = 1 AND ${PURCHASE} ORDER BY p.PaymentDate, p.PaymentId`)).recordset;
    const schedule = (await pool.request().input("i", sql.Int, id).query(`
      SELECT s.ScheduleId, CONVERT(char(10), s.DueDate, 23) AS DueDate, s.Amount, s.SharePct, s.Label, t.Name AS Purpose, s.Remarks
      FROM dbo.LegalPaymentSchedule s LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = s.TxnTypeId WHERE s.LandId = @i ORDER BY s.DueDate, s.ScheduleId`)).recordset;
    const revisions = (await pool.request().input("i", sql.Int, id).query(`
      SELECT r.RevisionId, CONVERT(char(10), r.RevisionDate, 23) AS RevisionDate, r.OldTotal, r.NewTotal, r.OldRate, r.NewRate, r.Reason,
             CONVERT(char(10), v.ValuationDate, 23) AS ValuationDate, u.name AS ByName
      FROM dbo.LegalConsiderationRevision r LEFT JOIN dbo.LegalValuation v ON v.ValuationId = r.ValuationId LEFT JOIN dbo.users u ON u.id = r.CreatedBy
      WHERE r.LandId = @i ORDER BY r.RevisionDate DESC, r.RevisionId DESC`)).recordset;
    // Latest valuation: a change after the consideration date is flagged so the price can be revised.
    const valuation = (await pool.request().input("i", sql.Int, id).query(`
      SELECT TOP 1 v.ValuationId, CONVERT(char(10), v.ValuationDate, 23) AS ValuationDate, v.GovernmentValuation, v.EstimatedMarketValue, v.MarketRate, v.ValuationSource
      FROM dbo.LegalValuation v WHERE v.LandId = @i AND v.IsActive = 1 ORDER BY v.ValuationDate DESC, v.ValuationId DESC`)).recordset[0] ?? null;
    const canApply = (await canAct(req, "L1 Approver", PAGE)) || (await canAct(req, "L2 Approver", PAGE));
    res.json({ land, queries, tracking, payments, schedule, revisions, valuation, canApply });
  } catch (err) {
    console.error("[legal-deed-reg] detail:", err.message);
    res.status(500).json({ error: "Could not load the land" });
  }
});

const guard = async (pool, res, id, statuses = ["Deed Registration", "Registered"]) => {
  const l = await landIn(pool, id);
  if (!l) { res.status(404).json({ error: "Land not found" }); return null; }
  if (!statuses.includes(l.WorkflowStatus)) { res.status(409).json({ error: `${l.LandCode} is not at Deed Registration` }); return null; }
  return l;
};

// PUT /:id/consideration { total, rate, rateUnitId, consDate, paymentModeId, remarks, reason, valuationId }
// The first save sets the consideration; a later change of total or rate needs a reason and is kept as a revision
// (e.g. the valuation changed months after the advance). The total can never go below what is already paid.
router.put("/:id/consideration", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const b = req.body || {};
    const total = money(b.total), rate = money(b.rate);
    if ([total, rate].some(Number.isNaN)) return res.status(400).json({ error: "Amounts must be numbers" });
    if (!total) return res.status(400).json({ error: "Enter the total amount" });
    const consDate = dateOf(b.consDate);
    if (!consDate) return res.status(400).json({ error: "Enter the consideration (agreement) date" });
    if (consDate > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "The consideration date cannot be in the future" });
    const pm = idOf(b.paymentModeId), unit = idOf(b.rateUnitId), valuationId = idOf(b.valuationId);
    if (!(await lookupOk(pool, pm, "payment-mode"))) return res.status(400).json({ error: "Pick a payment mode from Setup" });
    const old = (await pool.request().input("i", sql.Int, id).query("SELECT ConsTotalAmount, ConsRate FROM dbo.LegalLand WHERE LandId = @i")).recordset[0];
    const { Paid } = await payState(pool, id);
    if (total < Number(Paid)) return res.status(400).json({ error: `Total cannot be less than the ${money2(Paid)} already paid` });
    const changed = old.ConsTotalAmount != null && (Number(old.ConsTotalAmount) !== total || Number(old.ConsRate ?? 0) !== Number(rate ?? 0));
    const reason = txt(b.reason, 1000);
    if (changed && !reason) return res.status(400).json({ error: "Write why the consideration changed (e.g. revised valuation)" });
    const u = req.user?.userId ?? null;
    await pool.request().input("i", sql.Int, id).input("t", sql.Decimal(18, 2), total).input("r", sql.Decimal(18, 2), rate).input("ru", sql.Int, unit)
      .input("cd", sql.Date, consDate).input("pm", sql.Int, pm).input("rm", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, u)
      .query(`UPDATE dbo.LegalLand SET ConsTotalAmount = @t, ConsRate = @r, ConsRateUnitId = @ru, ConsDate = @cd, ConsPaymentModeId = @pm, ConsRemarks = @rm,
          UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @i`);
    // % instalments follow the new consideration.
    if (changed) await pool.request().input("i", sql.Int, id).input("t", sql.Decimal(18, 2), total)
      .query("UPDATE dbo.LegalPaymentSchedule SET Amount = ROUND(@t * SharePct / 100, 2) WHERE LandId = @i AND SharePct IS NOT NULL");
    if (old.ConsTotalAmount == null || changed) {
      await pool.request().input("i", sql.Int, id).input("d", sql.Date, changed ? new Date().toISOString().slice(0, 10) : consDate)
        .input("ot", sql.Decimal(18, 2), old.ConsTotalAmount).input("nt", sql.Decimal(18, 2), total).input("or", sql.Decimal(18, 2), old.ConsRate).input("nr", sql.Decimal(18, 2), rate)
        .input("v", sql.Int, valuationId).input("re", sql.NVarChar(1000), changed ? reason : reason ?? "Consideration agreed").input("u", sql.Int, u)
        .query(`INSERT INTO dbo.LegalConsiderationRevision (LandId, RevisionDate, OldTotal, NewTotal, OldRate, NewRate, ValuationId, Reason, CreatedBy)
          VALUES (@i, @d, @ot, @nt, @or, @nr, @v, @re, @u)`);
    }
    await writeAudit(pool, req, { action: changed ? "Consideration revised" : "Consideration saved", entityType: "Land Property", entityId: id, landId: id,
      oldValue: changed ? { total: old.ConsTotalAmount, rate: old.ConsRate } : undefined, newValue: { total, rate, consDate, reason } });
    res.json({ message: changed ? `Consideration revised to ${money2(total)}` : "Consideration saved" });
  } catch (err) {
    console.error("[legal-deed-reg] consideration:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:id/payment { paymentDate, txnTypeId, amount, paymentModeId, payee, transactionRef, receiptNo, receiptFileId, remarks }
// Recorded in the land's Payment History. Not in the future, not before the consideration date, never more than the balance.
router.post("/:id/payment", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const b = req.body || {};
    const st = await payState(pool, id);
    if (st.Total == null) return res.status(400).json({ error: "Save the consideration first" });
    const date = dateOf(b.paymentDate), amount = money(b.amount), type = idOf(b.txnTypeId), mode = idOf(b.paymentModeId);
    if (!date) return res.status(400).json({ error: "Enter the payment date" });
    if (date > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "A payment cannot be dated in the future — plan it in the schedule instead" });
    if (!amount || Number.isNaN(amount)) return res.status(400).json({ error: "Enter the amount" });
    if (!type || !(await lookupOk(pool, type, "txn-type"))) return res.status(400).json({ error: "Pick the payment purpose" });
    if (!mode || !(await lookupOk(pool, mode, "payment-mode"))) return res.status(400).json({ error: "Pick the payment mode" });
    const refund = (await pool.request().input("t", sql.Int, type).query("SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = @t")).recordset[0]?.Name === "Refund";
    const balance = Number(st.Total) - Number(st.Paid);
    if (!refund && amount > balance + 0.001) return res.status(400).json({ error: `Only ${money2(balance)} is left to pay — revise the consideration first if the price changed` });
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("t", sql.Int, type).input("a", sql.Decimal(18, 2), amount).input("m", sql.Int, mode)
      .input("pe", sql.NVarChar(200), txt(b.payee, 200)).input("tr", sql.NVarChar(100), txt(b.transactionRef, 100)).input("rn", sql.NVarChar(60), txt(b.receiptNo, 60))
      .input("rf", sql.Int, idOf(b.receiptFileId)).input("rm", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, req.user?.userId ?? null)
      .query(`INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payee, TransactionRef, ReceiptNo, ReceiptFileId, Remarks, CreatedBy)
        VALUES (@i, @d, @t, @a, @m, @pe, @tr, @rn, @rf, @rm, @u)`);
    await writeAudit(pool, req, { action: "Payment recorded", entityType: "Land Property", entityId: id, landId: id, newValue: { date, amount, type } });
    const left = refund ? balance + amount : balance - amount;
    res.status(201).json({ message: left <= 0.001 ? "Payment saved — consideration fully paid" : `Payment saved — ${money2(left)} left to pay` });
  } catch (err) {
    console.error("[legal-deed-reg] payment:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});
router.delete("/payment/:pid", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const p = (await pool.request().input("p", sql.Int, idOf(req.params.pid)).query(
      "SELECT p.LandId, l.WorkflowStatus FROM dbo.LegalPayment p JOIN dbo.LegalLand l ON l.LandId = p.LandId WHERE p.PaymentId = @p")).recordset[0];
    if (!p) return res.status(404).json({ error: "Payment not found" });
    if (p.WorkflowStatus !== "Deed Registration") return res.status(409).json({ error: "Payments of a registered land are not changed here" });
    const r = await pool.request().input("p", sql.Int, idOf(req.params.pid))
      .query("UPDATE dbo.LegalPayment SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() OUTPUT DELETED.Amount, CONVERT(char(10), DELETED.PaymentDate, 23) AS PaymentDate WHERE PaymentId = @p");
    await writeAudit(pool, req, { action: "Payment removed", entityType: "Land Property", entityId: p.LandId, landId: p.LandId, oldValue: r.recordset[0] });
    res.json({ message: "Payment removed" });
  } catch (err) {
    console.error("[legal-deed-reg] payment delete:", err.message);
    res.status(500).json({ error: "Could not remove" });
  }
});

// POST /:id/schedule { dueDate, amount, txnTypeId, remarks } — an agreed instalment. DELETE /schedule/:sid.
router.post("/:id/schedule", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const b = req.body || {};
    const st = await payState(pool, id);
    if (st.Total == null) return res.status(400).json({ error: "Save the consideration first" });
    // Either a % of the consideration (amount worked out, and re-worked if the consideration is revised) or an amount.
    const pct = b.percent === "" || b.percent == null ? null : Number(b.percent);
    if (pct != null && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) return res.status(400).json({ error: "The % must be between 0 and 100" });
    const due = dateOf(b.dueDate), type = idOf(b.txnTypeId);
    const amount = pct != null ? Math.round(Number(st.Total) * pct) / 100 : money(b.amount);
    if (!due) return res.status(400).json({ error: "Enter the due date" });
    if (!amount || Number.isNaN(amount)) return res.status(400).json({ error: "Enter the % or the amount" });
    if (!(await lookupOk(pool, type, "txn-type"))) return res.status(400).json({ error: "Pick the purpose from Setup" });
    const planned = Number((await pool.request().input("i", sql.Int, id).query("SELECT ISNULL(SUM(Amount), 0) AS s FROM dbo.LegalPaymentSchedule WHERE LandId = @i")).recordset[0].s);
    if (planned + amount > Number(st.Total) + 0.001) return res.status(400).json({ error: `The schedule would total more than the consideration (${money2(st.Total)})` });
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, due).input("a", sql.Decimal(18, 2), amount).input("t", sql.Int, type)
      .input("r", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, req.user?.userId ?? null)
      .input("p", sql.Decimal(9, 4), pct).input("lb", sql.NVarChar(100), txt(b.label, 100))
      .query("INSERT INTO dbo.LegalPaymentSchedule (LandId, DueDate, Amount, SharePct, Label, TxnTypeId, Remarks, CreatedBy) VALUES (@i, @d, @a, @p, @lb, @t, @r, @u)");
    await writeAudit(pool, req, { action: "Instalment planned", entityType: "Land Property", entityId: id, landId: id, newValue: { due, amount } });
    res.status(201).json({ message: "Instalment added" });
  } catch (err) {
    console.error("[legal-deed-reg] schedule:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});
// POST /:id/schedule/apply { template, replace } — the land's schedule from a template: each line = its % of the
// consideration, due its days after the consideration date. The last line takes the rounding so a 100% plan adds up exactly.
router.post("/:id/schedule/apply", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const name = txt(req.body?.template, 100);
    const st = await payState(pool, id);
    if (st.Total == null) return res.status(400).json({ error: "Save the consideration first" });
    const cons = (await pool.request().input("i", sql.Int, id).query("SELECT CONVERT(char(10), ISNULL(ConsDate, CAST(GETDATE() AS DATE)), 23) AS d FROM dbo.LegalLand WHERE LandId = @i")).recordset[0].d;
    const lines = (await pool.request().input("n", sql.NVarChar(100), name)
      .query("SELECT SeqNo, Label, SharePct, DueDays, TxnTypeId FROM dbo.LegalInstalmentTemplate WHERE TemplateName = @n AND IsActive = 1 ORDER BY SeqNo")).recordset;
    if (!lines.length) return res.status(400).json({ error: "Pick a template" });
    const existing = (await pool.request().input("i", sql.Int, id).query("SELECT COUNT(*) AS n FROM dbo.LegalPaymentSchedule WHERE LandId = @i")).recordset[0].n;
    if (existing && !req.body?.replace) return res.status(409).json({ error: "This land already has a schedule — replace it?", needsReplace: true });
    const total = Number(st.Total), sumPct = lines.reduce((a, x) => a + Number(x.SharePct), 0);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input("i", sql.Int, id).query("DELETE FROM dbo.LegalPaymentSchedule WHERE LandId = @i");
      let given = 0;
      for (const [k, x] of lines.entries()) {
        const last = k === lines.length - 1 && Math.abs(sumPct - 100) < 0.0001;
        const amt = last ? Math.round((total - given) * 100) / 100 : Math.round(total * Number(x.SharePct)) / 100;
        given += amt;
        const due = new Date(`${cons}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + Number(x.DueDays));
        await new sql.Request(tx).input("i", sql.Int, id).input("d", sql.Date, due.toISOString().slice(0, 10)).input("a", sql.Decimal(18, 2), amt)
          .input("p", sql.Decimal(9, 4), x.SharePct).input("lb", sql.NVarChar(100), x.Label).input("t", sql.Int, x.TxnTypeId).input("r", sql.NVarChar(1000), `From template: ${name}`)
          .input("u", sql.Int, req.user?.userId ?? null)
          .query("INSERT INTO dbo.LegalPaymentSchedule (LandId, DueDate, Amount, SharePct, Label, TxnTypeId, Remarks, CreatedBy) VALUES (@i, @d, @a, @p, @lb, @t, @r, @u)");
      }
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; }
    await writeAudit(pool, req, { action: "Instalment schedule from template", entityType: "Land Property", entityId: id, landId: id, newValue: { template: name, lines: lines.length } });
    res.status(201).json({ message: `${lines.length} instalments made from "${name}"${Math.abs(sumPct - 100) > 0.0001 ? ` (${sumPct}% of the consideration)` : ""}` });
  } catch (err) {
    console.error("[legal-deed-reg] apply template:", err.message);
    res.status(500).json({ error: "Could not apply the template" });
  }
});

router.delete("/schedule/:sid", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().input("s", sql.Int, idOf(req.params.sid))
      .query("DELETE FROM dbo.LegalPaymentSchedule OUTPUT DELETED.LandId, DELETED.Amount, CONVERT(char(10), DELETED.DueDate, 23) AS DueDate WHERE ScheduleId = @s");
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Instalment not found" });
    await writeAudit(pool, req, { action: "Instalment removed", entityType: "Land Property", entityId: row.LandId, landId: row.LandId, oldValue: row });
    res.json({ message: "Instalment removed" });
  } catch (err) {
    console.error("[legal-deed-reg] schedule delete:", err.message);
    res.status(500).json({ error: "Could not remove" });
  }
});

// POST /:id/query { queryDate, feeTypeId, amount, remarks } — a registration / stamp duty query. DELETE /query/:qid.
router.post("/:id/query", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const b = req.body || {};
    const date = dateOf(b.queryDate), amount = money(b.amount), fee = idOf(b.feeTypeId);
    if (!date) return res.status(400).json({ error: "Enter the query date" });
    if (amount == null || Number.isNaN(amount)) return res.status(400).json({ error: "Enter the amount" });
    if (!(await lookupOk(pool, fee, "fee-type"))) return res.status(400).json({ error: "Pick a fee type from Setup" });
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("f", sql.Int, fee).input("a", sql.Decimal(18, 2), amount)
      .input("r", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, req.user?.userId ?? null)
      .query("INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy) VALUES (@i, @d, @f, @a, @r, @u)");
    await writeAudit(pool, req, { action: "Stamp duty query added", entityType: "Land Property", entityId: id, landId: id, newValue: { date, amount, fee } });
    res.status(201).json({ message: "Query saved" });
  } catch (err) {
    console.error("[legal-deed-reg] query:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});
router.delete("/query/:qid", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().input("q", sql.Int, idOf(req.params.qid))
      .query("DELETE FROM dbo.LegalStampDutyQuery OUTPUT DELETED.LandId, DELETED.Amount, CONVERT(char(10), DELETED.QueryDate, 23) AS QueryDate WHERE QueryId = @q");
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Query not found" });
    await writeAudit(pool, req, { action: "Stamp duty query deleted", entityType: "Land Property", entityId: row.LandId, landId: row.LandId, oldValue: row });
    res.json({ message: "Query removed" });
  } catch (err) {
    console.error("[legal-deed-reg] query delete:", err.message);
    res.status(500).json({ error: "Could not remove" });
  }
});

// PUT /:id/final { date, officeId, modeId, deedNo } — Final Registration (before the registered deed is uploaded).
router.put("/:id/final", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id);
    if (!l) return;
    const b = req.body || {};
    const date = dateOf(b.date), office = idOf(b.officeId), mode = idOf(b.modeId);
    if (!date) return res.status(400).json({ error: "Enter the registration date" });
    if (!office) return res.status(400).json({ error: "Pick the office of registration" });
    // Full payment first, and the registration dated on or after the last payment.
    const st = await payState(pool, id);
    if (st.Total == null) return res.status(409).json({ error: "Save the consideration and payments first" });
    if (Number(st.Paid) + 0.001 < Number(st.Total)) return res.status(409).json({ error: `Consideration not fully paid — ${money2(Number(st.Total) - Number(st.Paid))} still due` });
    if (st.LastPaid && date < st.LastPaid) return res.status(400).json({ error: `The registration date cannot be before the last payment (${st.LastPaid})` });
    if (!(await pool.request().input("o", sql.Int, office).query("SELECT 1 AS x FROM dbo.LegalRegistrationOffice WHERE OfficeId = @o")).recordset[0]) return res.status(400).json({ error: "Office not found" });
    if (!mode || !(await lookupOk(pool, mode, "registration-mode"))) return res.status(400).json({ error: "Pick the mode of registration" });
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("o", sql.Int, office).input("m", sql.Int, mode)
      .input("n", sql.NVarChar(100), txt(b.deedNo, 100)).input("u", sql.Int, req.user?.userId ?? null)
      .query("UPDATE dbo.LegalLand SET RegFinalDate = @d, RegOfficeId = @o, RegModeId = @m, RegDeedNo = @n, UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @i");
    await writeAudit(pool, req, { action: "Final registration saved", entityType: "Land Property", entityId: id, landId: id, newValue: { date, office, mode, deedNo: txt(b.deedNo, 100) } });
    res.json({ message: "Final registration saved" });
  } catch (err) {
    console.error("[legal-deed-reg] final:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:id/tracking { statusDate, igrStatusId, deedLocationId, trackingUrl, remarks } — a physical deed / IGR update.
router.post("/:id/tracking", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id);
    if (!l) return;
    const b = req.body || {};
    const date = dateOf(b.statusDate) || new Date().toISOString().slice(0, 10);
    const st = idOf(b.igrStatusId), loc = idOf(b.deedLocationId);
    const link = b.trackingUrl ? urlOf(b.trackingUrl) : null;
    if (b.trackingUrl && !link) return res.status(400).json({ error: "The IGR tracking link must start with http:// or https://" });
    if (!st && !loc && !link) return res.status(400).json({ error: "Enter the IGR status, deed location or tracking link" });
    if (!(await lookupOk(pool, st, "igr-status")) || !(await lookupOk(pool, loc, "deed-location"))) return res.status(400).json({ error: "Pick the status and location from Setup" });
    const u = req.user?.userId ?? null;
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("s", sql.Int, st).input("l", sql.Int, loc).input("url", sql.NVarChar(500), link)
      .input("r", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, u)
      .query(`SET XACT_ABORT ON; BEGIN TRAN;
        INSERT INTO dbo.LegalDeedTracking (LandId, StatusDate, IgrStatusId, DeedLocationId, TrackingUrl, Remarks, CreatedBy) VALUES (@i, @d, @s, @l, @url, @r, @u);
        UPDATE dbo.LegalLand SET IgrStatusId = ISNULL(@s, IgrStatusId), DeedLocationId = ISNULL(@l, DeedLocationId), IgrTrackingUrl = ISNULL(@url, IgrTrackingUrl),
          UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @i;
        COMMIT;`);
    await writeAudit(pool, req, { action: "Deed tracking updated", entityType: "Land Property", entityId: id, landId: id, newValue: { date, st, loc, link } });
    res.status(201).json({ message: "Deed tracking updated" });
  } catch (err) {
    console.error("[legal-deed-reg] tracking:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;

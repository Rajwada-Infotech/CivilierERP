const express = require("express");
const { sumMoney } = require("../services/bookingUnits");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { projectPredicate } = require("../services/projectScope");
// Project access: a restricted user gets 403 on welcome calls outside their projects.
// On /:bookingId/bank-preferences/:id the :id is a bank preference, already
// covered by its :bookingId guard and matched to that booking — so the welcome
// call lookup applies to /:id routes only.
{
  const { crmProjectGuards, crmViaBookingSql, projectParamGuard } = require("../services/projectScope");
  crmProjectGuards(router);
  const guardCall = projectParamGuard(crmViaBookingSql("CrmWelcomeCall"));
  router.param("id", (req, res, next, value) => (req.path.includes("/bank-preferences/") ? next() : guardCall(req, res, next, value)));
}
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { maybeAutoCreateAgreement, requireApprovedBooking } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
const { emitNotification } = require("../services/notify");
const { applyPagination } = require("../services/crmListPagination");

router.use(authMiddleware);

const WC_FROM = `
  FROM dbo.CrmWelcomeCall wc
  JOIN dbo.CrmBooking b ON b.Id = wc.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.BlockMaster blk ON blk.Id = COALESCE(um.BlockId, b.BlockId)
  LEFT JOIN dbo.Users u ON u.id = wc.CalledBy
  LEFT JOIN dbo.Users uOwner ON uOwner.id = b.AssignedTo
  LEFT JOIN dbo.CrmWelcomeCallSubmission sub ON sub.BookingId = wc.BookingId
`;

const WC_SELECT = `
  SELECT
    wc.Id, wc.BookingId, wc.CalledBy, wc.CallDate, wc.DurationSeconds,
    wc.Outcome, wc.NextCallDate, wc.Notes, wc.CustomFields, wc.PreferredAgreementDate,
    wc.PaymentPlanConfirmed, wc.PaymentPlanConfirmedAt, wc.PaymentPlanDisputeReason, wc.CreatedAt,
    u.name  AS CalledByName,
    b.AssignedTo,
    uOwner.name AS AssignedToName,
    b.BookingNo, b.ApplicationId,
    COALESCE(bn.UnitNo, um.UnitName, b.UnitNo) AS UnitNo,
    COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
    COALESCE(blk.BlockName, b.BlockName) AS BlockName,
    a.ApplicantName, a.Mobile, a.Email,
    CASE WHEN sub.IsLocked = 1 THEN 1 ELSE 0 END AS HasSubmittedChecklist
  ${WC_FROM}
`;

const OUTCOMES = ["Welcomed","NotReachable","RequestedCallback","VoiceMail","Busy","SwitchedOff"];

// Ordered outcomes (most-recent first) for the last 20 calls — used to
// compute a true consecutive streak in JS rather than a COUNT(*) that
// has no concept of "stop at the first Welcomed" (the previous bug:
// [NotReachable, NotReachable, Welcomed, NotReachable×3] returned 5
// instead of 2 because the COUNT didn't stop at the Welcomed call).
const NON_REACHED = new Set(["NotReachable","Busy","SwitchedOff","VoiceMail"]);
function computeStreak(orderedOutcomes) {
  let n = 0;
  for (const o of orderedOutcomes) {
    if (NON_REACHED.has(o)) n++;
    else break; // first Welcomed (or any other outcome) ends the streak
  }
  return n;
}

// ─── Board helpers (paginated Welcome Calls work queues at enterprise scale) ─
const CHECKLIST_ALWAYS_KEYS_SQL = [
  "N'project_name'", "N'unit_no'", "N'booking_date'", "N'total_value'",
  "N'plan_structure'", "N'outstanding_balance'",
  "N'applicant_name'", "N'mobile_number'", "N'email'", "N'address'",
  "N'documents_uploaded'", "N'documents_verified'",
].join(",");

const HAS_CO_SQL = "CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmCoApplicant ca WHERE ca.BookingId = b.Id AND ca.IsActive = 1) THEN 1 ELSE 0 END";
const HAS_PARK_SQL = "CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmParkingAllotment pa WHERE pa.BookingId = b.Id AND pa.IsActive = 1) THEN 1 ELSE 0 END";
const HAS_EXTRA_SQL = "CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmExtraCharge ec WHERE ec.BookingId = b.Id AND ec.IsActive = 1) THEN 1 ELSE 0 END";

const CHECKLIST_TOTAL_EXPR = `(12 + ${HAS_CO_SQL} + ${HAS_PARK_SQL} + ${HAS_EXTRA_SQL})`;
const CHECKED_COUNT_EXPR = `(
  (SELECT COUNT(*) FROM dbo.CrmWelcomeChecklistItem ci
   WHERE ci.BookingId = b.Id
     AND ci.IsChecked = 1
     AND ISNULL(ci.RecheckStatus, N'') <> N'Open'
     AND (
       ci.ItemKey IN (${CHECKLIST_ALWAYS_KEYS_SQL})
       OR (ci.ItemKey = N'co_applicant_details' AND EXISTS (SELECT 1 FROM dbo.CrmCoApplicant ca WHERE ca.BookingId = b.Id AND ca.IsActive = 1))
       OR (ci.ItemKey = N'parking_selection' AND EXISTS (SELECT 1 FROM dbo.CrmParkingAllotment pa WHERE pa.BookingId = b.Id AND pa.IsActive = 1))
       OR (ci.ItemKey = N'extra_charges' AND EXISTS (SELECT 1 FROM dbo.CrmExtraCharge ec WHERE ec.BookingId = b.Id AND ec.IsActive = 1))
     )
  )
  + CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmCoApplicant ca WHERE ca.BookingId = b.Id AND ca.IsActive = 1)
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmWelcomeChecklistItem ci WHERE ci.BookingId = b.Id AND ci.ItemKey = N'co_applicant_details')
          AND (SELECT COUNT(*) FROM dbo.CrmWelcomeChecklistItem ci WHERE ci.BookingId = b.Id AND ci.IsChecked = 1 AND ISNULL(ci.RecheckStatus, N'') <> N'Open' AND ci.ItemKey IN (N'co_applicant_identity', N'co_applicant_kyc', N'co_applicant_contact')) = 3
    THEN 1 ELSE 0 END
)`;

const NON_REACHED_OUTCOMES_SQL = "N'NotReachable',N'Busy',N'SwitchedOff',N'VoiceMail'";
const STREAK_AT_LEAST_3_SQL = `(
  lastCall.Outcome IN (${NON_REACHED_OUTCOMES_SQL})
  AND (
    SELECT COUNT(*)
    FROM dbo.CrmWelcomeCall wcS
    WHERE wcS.BookingId = b.Id
      AND wcS.Outcome IN (${NON_REACHED_OUTCOMES_SQL})
      AND (
        lastBreak.Id IS NULL
        OR wcS.CallDate > lastBreak.CallDate
        OR (wcS.CallDate = lastBreak.CallDate AND wcS.CreatedAt > lastBreak.CreatedAt)
      )
  ) >= 3
)`;

const BOARD_BASE_FROM = `
  FROM dbo.CrmBooking b
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.BlockMaster blk ON blk.Id = COALESCE(um.BlockId, b.BlockId)
  LEFT JOIN dbo.Users uOwner ON uOwner.id = b.AssignedTo
  LEFT JOIN dbo.CrmWelcomeCallSubmission sub ON sub.BookingId = b.Id
  OUTER APPLY (
    SELECT TOP 1 wcL.Id, wcL.Outcome, wcL.CallDate, wcL.NextCallDate, wcL.CalledBy, uLast.name AS CalledByName
    FROM dbo.CrmWelcomeCall wcL
    LEFT JOIN dbo.Users uLast ON uLast.id = wcL.CalledBy
    WHERE wcL.BookingId = b.Id
    ORDER BY wcL.CallDate DESC, wcL.CreatedAt DESC
  ) lastCall
  OUTER APPLY (
    SELECT COUNT(*) AS OpenRecheckCount, MIN(ciR.RecheckRequestedAt) AS OldestFlaggedAt
    FROM dbo.CrmWelcomeChecklistItem ciR
    WHERE ciR.BookingId = b.Id AND ciR.RecheckStatus = '${CrmStatus.OPEN}'
  ) rc
  OUTER APPLY (
    SELECT TOP 1 wcP.PaymentPlanConfirmed, wcP.PaymentPlanDisputeReason
    FROM dbo.CrmWelcomeCall wcP
    WHERE wcP.BookingId = b.Id AND wcP.PaymentPlanConfirmed IS NOT NULL
    ORDER BY wcP.CallDate DESC, wcP.CreatedAt DESC
  ) planPref
  OUTER APPLY (
    SELECT TOP 1 wcB.Id, wcB.CallDate, wcB.CreatedAt
    FROM dbo.CrmWelcomeCall wcB
    WHERE wcB.BookingId = b.Id
      AND (wcB.Outcome IS NULL OR wcB.Outcome NOT IN (${NON_REACHED_OUTCOMES_SQL}))
    ORDER BY wcB.CallDate DESC, wcB.CreatedAt DESC
  ) lastBreak
`;

const HAS_WELCOMED_SQL = `EXISTS (SELECT 1 FROM dbo.CrmWelcomeCall wcW WHERE wcW.BookingId = b.Id AND wcW.Outcome = N'Welcomed')`;

function buildBoardScopeFilters(req0, query, projectScope) {
  const companyId = query.companyId ? parseInt(query.companyId, 10) : null;
  const projectId = query.projectId ? parseInt(query.projectId, 10) : null;
  const blockId = query.blockId ? parseInt(query.blockId, 10) : null;
  const search = query.search ? String(query.search).trim() : "";
  const assignedTo = query.assignedTo ? String(query.assignedTo).trim() : "";

  const conds = [`b.Status = '${CrmStatus.APPROVED}'`, "b.IsActive = 1"];
  if (projectScope) conds.push(projectPredicate(projectScope, "b.ProjectId", "").trim());
  if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
  if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
  if (blockId) {
    req0.input("blockId", sql.Int, blockId);
    conds.push(`(COALESCE(um.BlockId, b.BlockId) = @blockId OR EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId WHERE bp.BookingId = b.Id AND bp.Status = N'Active' AND pm.BlockId = @blockId))`);
  }
  if (assignedTo === "unassigned") {
    conds.push("b.AssignedTo IS NULL");
  } else if (assignedTo && /^\d+$/.test(assignedTo)) {
    req0.input("assignedTo", sql.Int, parseInt(assignedTo, 10));
    conds.push("b.AssignedTo = @assignedTo");
  }
  if (search) {
    req0.input("srch", sql.NVarChar(200), `%${search}%`);
    conds.push("(a.ApplicantName LIKE @srch OR a.Mobile LIKE @srch OR b.BookingNo LIKE @srch OR COALESCE(bn.UnitNo, um.UnitName, b.UnitNo) LIKE @srch OR COALESCE(bn.ProjectName, b.ProjectName) LIKE @srch)");
  }
  return conds;
}

function buildBoardTabAndFocusConds(req0, query) {
  const conds = [];
  const tab = String(query.tab || "queue");
  const focus = String(query.focus || "");
  const outcome = String(query.outcome || "");
  const calledBy = query.calledBy ? String(query.calledBy).trim() : "";

  if (tab === "queue") {
    conds.push(`NOT ${HAS_WELCOMED_SQL}`);
  } else if (tab === "checklist") {
    conds.push(`${HAS_WELCOMED_SQL} AND ISNULL(sub.IsLocked, 0) = 0`);
  } else if (tab === "recheck") {
    conds.push("ISNULL(rc.OpenRecheckCount, 0) > 0");
  } else if (tab === "verified") {
    conds.push(`${HAS_WELCOMED_SQL} AND ISNULL(sub.IsLocked, 0) = 1 AND ISNULL(rc.OpenRecheckCount, 0) = 0`);
  }

  if (calledBy && /^\d+$/.test(calledBy)) {
    req0.input("calledBy", sql.Int, parseInt(calledBy, 10));
    conds.push("EXISTS (SELECT 1 FROM dbo.CrmWelcomeCall wcBy WHERE wcBy.BookingId = b.Id AND wcBy.CalledBy = @calledBy)");
  }

  if (outcome === "__never__") {
    conds.push("lastCall.Id IS NULL");
  } else if (OUTCOMES.includes(outcome)) {
    req0.input("outcomeFilter", sql.NVarChar(50), outcome);
    conds.push("lastCall.Outcome = @outcomeFilter");
  }

  // Purpose-specific focus filters per tab
  if (focus === "neverCalled") conds.push("lastCall.Id IS NULL");
  else if (focus === "overdue") conds.push("lastCall.Id IS NOT NULL AND lastCall.NextCallDate IS NOT NULL AND lastCall.NextCallDate < CAST(SYSDATETIME() AS DATE)");
  else if (focus === "dueToday") conds.push("lastCall.Id IS NOT NULL AND lastCall.NextCallDate = CAST(SYSDATETIME() AS DATE)");
  else if (focus === "unreachable3") conds.push(STREAK_AT_LEAST_3_SQL);
  else if (focus === "scheduled") conds.push("lastCall.Id IS NOT NULL AND lastCall.NextCallDate > CAST(SYSDATETIME() AS DATE)");
  else if (focus === "incomplete") conds.push(`${CHECKED_COUNT_EXPR} < ${CHECKLIST_TOTAL_EXPR}`);
  else if (focus === "readyToSubmit") conds.push(`${CHECKED_COUNT_EXPR} >= ${CHECKLIST_TOTAL_EXPR} AND ISNULL(rc.OpenRecheckCount, 0) = 0`);
  else if (focus === "hasRecheck") conds.push("ISNULL(rc.OpenRecheckCount, 0) > 0");
  else if (focus === "missingFinancing") conds.push("NULLIF(LTRIM(RTRIM(ISNULL(b.FinancingType, N''))), N'') IS NULL");
  else if (focus === "planDisputed") conds.push("planPref.PaymentPlanConfirmed = 0");
  else if (focus === "aging") conds.push("rc.OldestFlaggedAt IS NOT NULL AND CAST(rc.OldestFlaggedAt AS DATE) <= DATEADD(day, -3, CAST(SYSDATETIME() AS DATE))");
  else if (focus === "multi") conds.push("ISNULL(rc.OpenRecheckCount, 0) >= 2");

  return conds;
}

const BOARD_SORT_MAP = {
  BookingNo: "b.BookingNo",
  BookingDate: "b.BookingDate",
  ApplicantName: "a.ApplicantName",
  ProjectName: "COALESCE(bn.ProjectName, b.ProjectName)",
  LastOutcome: "ISNULL(lastCall.Outcome, N'')",
  LastCallDate: "ISNULL(lastCall.CallDate, '1900-01-01')",
  NextCallDate: "ISNULL(lastCall.NextCallDate, '9999-12-31')",
  AttemptCount: "(SELECT COUNT(*) FROM dbo.CrmWelcomeCall wcC WHERE wcC.BookingId = b.Id)",
  AssignedToName: "ISNULL(uOwner.name, N'zzzz')",
  LastCalledByName: "ISNULL(lastCall.CalledByName, N'zzzz')",
  CheckedCount: CHECKED_COUNT_EXPR,
  OpenRecheckCount: "ISNULL(rc.OpenRecheckCount, 0)",
  OldestFlaggedAt: "ISNULL(rc.OldestFlaggedAt, '9999-12-31')",
  SubmittedAt: "ISNULL(sub.SubmittedAt, '1900-01-01')",
  FinancingType: "ISNULL(b.FinancingType, N'zzzz')",
  GrandTotal: "COALESCE(NULLIF(b.GrandTotal, 0), b.TotalValue, 0)",
};

function resolveBoardOrder(tab, sortKey, sortDir) {
  const dir = sortDir === "desc" ? "DESC" : "ASC";
  if (sortKey && sortKey !== "Urgency" && Object.hasOwn(BOARD_SORT_MAP, sortKey)) {
    return `${BOARD_SORT_MAP[sortKey]} ${dir}, b.Id DESC`;
  }
  if (tab === "recheck") return "ISNULL(rc.OldestFlaggedAt, '9999-12-31') ASC, ISNULL(rc.OpenRecheckCount, 0) DESC, b.Id DESC";
  if (tab === "verified") return "ISNULL(sub.SubmittedAt, b.BookingDate) DESC, b.Id DESC";
  if (tab === "checklist") return "ISNULL(lastCall.CallDate, b.BookingDate) DESC, b.Id DESC";
  // Queue default urgency: overdue & due today first, then never called (oldest booking first), then future callbacks
  const urgencyOrder = `
    CASE
      WHEN lastCall.Id IS NOT NULL AND lastCall.NextCallDate IS NOT NULL AND lastCall.NextCallDate <= CAST(SYSDATETIME() AS DATE) THEN 0
      WHEN lastCall.Id IS NULL THEN 1
      ELSE 2
    END ${dir},
    ISNULL(lastCall.NextCallDate, b.BookingDate) ${dir},
    b.Id ASC
  `;
  return urgencyOrder;
}

// GET /board — high-scale server-paginated Welcome Calls work queues
router.get("/board", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const tab = ["queue", "checklist", "recheck", "verified"].includes(String(req.query.tab)) ? String(req.query.tab) : "queue";
    const { page, pageSize, offset } = applyPagination(req, 25, 200);

    const reqRows = pool.request();
    const reqCount = pool.request();
    const scopeConds = buildBoardScopeFilters(reqRows, req.query, req.projectScope);
    const scopeCondsCount = buildBoardScopeFilters(reqCount, req.query, req.projectScope);
    const tabConds = buildBoardTabAndFocusConds(reqRows, { ...req.query, tab });
    const tabCondsCount = buildBoardTabAndFocusConds(reqCount, { ...req.query, tab });

    const where = `WHERE ${[...scopeConds, ...tabConds].join(" AND ")}`;
    const whereCount = `WHERE ${[...scopeCondsCount, ...tabCondsCount].join(" AND ")}`;
    const orderSql = resolveBoardOrder(tab, String(req.query.sortKey || ""), String(req.query.sortDir || ""));

    reqRows.input("offset", sql.Int, offset);
    reqRows.input("pageSize", sql.Int, pageSize);

    const pagedSql = `
      ;WITH Paged AS (
        SELECT b.Id AS BookingId
        ${BOARD_BASE_FROM}
        ${where}
        ORDER BY ${orderSql}
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      )
      SELECT
        b.Id AS BookingId, b.BookingNo, b.ApplicationId, b.BookingDate,
        b.GrandTotal, b.TotalValue, b.FinancingType, b.AssignedTo,
        uOwner.name AS AssignedToName,
        a.ApplicantName, a.Mobile, a.Email, a.ApplicationNo,
        COALESCE(bn.UnitNo, um.UnitName, b.UnitNo) AS UnitNo,
        COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
        COALESCE(blk.BlockName, b.BlockName) AS BlockName,
        CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bpx WHERE bpx.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS IsPlotSale,
        lastCall.Id AS LastCallId, lastCall.Outcome AS LastOutcome, lastCall.CallDate AS LastCallDate,
        lastCall.NextCallDate, lastCall.CalledBy AS LastCalledBy, lastCall.CalledByName AS LastCalledByName,
        (SELECT COUNT(*) FROM dbo.CrmWelcomeCall wcCnt WHERE wcCnt.BookingId = b.Id) AS AttemptCount,
        CAST(CASE WHEN ${HAS_WELCOMED_SQL} THEN 1 ELSE 0 END AS BIT) AS HasWelcomedCall,
        planPref.PaymentPlanConfirmed,
        planPref.PaymentPlanDisputeReason,
        (SELECT TOP 1 wcPad.PreferredAgreementDate FROM dbo.CrmWelcomeCall wcPad WHERE wcPad.BookingId = b.Id AND wcPad.PreferredAgreementDate IS NOT NULL ORDER BY wcPad.CreatedAt DESC) AS PreferredAgreementDate,
        ${CHECKLIST_TOTAL_EXPR} AS ChecklistTotal,
        ${CHECKED_COUNT_EXPR} AS CheckedCount,
        ISNULL(rc.OpenRecheckCount, 0) AS OpenRecheckCount,
        rc.OldestFlaggedAt,
        CAST(ISNULL(sub.IsLocked, 0) AS BIT) AS IsLocked,
        sub.SubmittedAt,
        uSub.name AS SubmittedByName,
        topFlag.ItemKey AS FlaggedItemKey,
        topFlag.RecheckReason AS FlaggedReason,
        uFlag.name AS RequestedByName,
        docStats.DocsTotal,
        docStats.DocsVerified,
        STUFF((
          SELECT N', ' + bp.BankName
          FROM dbo.CrmWelcomeCallBankPreference bp
          WHERE bp.BookingId = b.Id
          ORDER BY bp.CreatedAt ASC
          FOR XML PATH(N''), TYPE
        ).value(N'.', N'NVARCHAR(MAX)'), 1, 2, N'') AS BankPrefNames,
        ag.Id AS AgreementId, ag.AgreementNo, ag.Status AS AgreementStatus,
        (
          SELECT TOP 20 Outcome
          FROM dbo.CrmWelcomeCall
          WHERE BookingId = b.Id
          ORDER BY CallDate DESC, CreatedAt DESC
          FOR JSON PATH
        ) AS RecentOutcomesJson
      FROM Paged p
      JOIN dbo.CrmBooking b ON b.Id = p.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = COALESCE(um.BlockId, b.BlockId)
      LEFT JOIN dbo.Users uOwner ON uOwner.id = b.AssignedTo
      LEFT JOIN dbo.CrmWelcomeCallSubmission sub ON sub.BookingId = b.Id
      LEFT JOIN dbo.Users uSub ON uSub.id = sub.SubmittedBy
      OUTER APPLY (
        SELECT TOP 1 wcL.Id, wcL.Outcome, wcL.CallDate, wcL.NextCallDate, wcL.CalledBy, uLast.name AS CalledByName
        FROM dbo.CrmWelcomeCall wcL
        LEFT JOIN dbo.Users uLast ON uLast.id = wcL.CalledBy
        WHERE wcL.BookingId = b.Id
        ORDER BY wcL.CallDate DESC, wcL.CreatedAt DESC
      ) lastCall
      OUTER APPLY (
        SELECT COUNT(*) AS OpenRecheckCount, MIN(ciR.RecheckRequestedAt) AS OldestFlaggedAt
        FROM dbo.CrmWelcomeChecklistItem ciR
        WHERE ciR.BookingId = b.Id AND ciR.RecheckStatus = '${CrmStatus.OPEN}'
      ) rc
      OUTER APPLY (
        SELECT TOP 1 ciF.ItemKey, ciF.RecheckReason, ciF.RecheckRequestedBy
        FROM dbo.CrmWelcomeChecklistItem ciF
        WHERE ciF.BookingId = b.Id AND ciF.RecheckStatus = '${CrmStatus.OPEN}'
        ORDER BY ciF.RecheckRequestedAt ASC
      ) topFlag
      LEFT JOIN dbo.Users uFlag ON uFlag.id = topFlag.RecheckRequestedBy
      OUTER APPLY (
        SELECT TOP 1 wcP.PaymentPlanConfirmed, wcP.PaymentPlanDisputeReason
        FROM dbo.CrmWelcomeCall wcP
        WHERE wcP.BookingId = b.Id AND wcP.PaymentPlanConfirmed IS NOT NULL
        ORDER BY wcP.CallDate DESC, wcP.CreatedAt DESC
      ) planPref
      OUTER APPLY (
        SELECT COUNT(*) AS DocsTotal, SUM(CASE WHEN bd.IsVerified = 1 THEN 1 ELSE 0 END) AS DocsVerified
        FROM dbo.CrmBookingDocument bd
        WHERE bd.BookingId = b.Id OR (bd.ApplicationId = b.ApplicationId AND bd.BookingId IS NULL)
      ) docStats
      OUTER APPLY (
        SELECT TOP 1 ag1.Id, ag1.AgreementNo, ag1.Status
        FROM dbo.CrmAgreement ag1
        WHERE ag1.BookingId = b.Id
        ORDER BY CASE WHEN ag1.Status <> 'Cancelled' THEN 0 ELSE 1 END, ag1.CreatedAt DESC
      ) ag
      ORDER BY ${orderSql}
    `;

    const [rowsRes, cntRes] = await Promise.all([
      reqRows.query(pagedSql),
      reqCount.query(`SELECT COUNT(*) AS total ${BOARD_BASE_FROM} ${whereCount}`),
    ]);

    const rows = rowsRes.recordset.map((r) => {
      let consecutiveNonReached = 0;
      try {
        const outcomes = JSON.parse(r.RecentOutcomesJson || "[]");
        consecutiveNonReached = computeStreak(outcomes.map((o) => o.Outcome));
      } catch {}
      const { RecentOutcomesJson: _, ...rest } = r;
      return { ...rest, ConsecutiveNonReached: consecutiveNonReached };
    });

    res.json({ rows, total: cntRes.recordset[0]?.total || 0, page, pageSize });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /board error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /board/counts — tab counts + per-tab focus counts across ALL matching bookings
router.get("/board/counts", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const reqB = pool.request();
    const reqH = pool.request();

    const scopeConds = buildBoardScopeFilters(reqB, req.query, req.projectScope);
    const scopeWhere = `WHERE ${scopeConds.join(" AND ")}`;

    // Build history count under the same global scope
    const hConds = [];
    if (req.projectScope) hConds.push(projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (req.query.companyId) { reqH.input("companyId", sql.Int, parseInt(req.query.companyId, 10)); hConds.push("b.CompanyId = @companyId"); }
    if (req.query.projectId) { reqH.input("projectId", sql.Int, parseInt(req.query.projectId, 10)); hConds.push("b.ProjectId = @projectId"); }
    if (req.query.blockId) {
      reqH.input("blockId", sql.Int, parseInt(req.query.blockId, 10));
      hConds.push(`(COALESCE(um.BlockId, b.BlockId) = @blockId OR EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId WHERE bp.BookingId = b.Id AND bp.Status = N'Active' AND pm.BlockId = @blockId))`);
    }
    if (req.query.assignedTo === "unassigned") hConds.push("b.AssignedTo IS NULL");
    else if (req.query.assignedTo && /^\d+$/.test(String(req.query.assignedTo))) {
      reqH.input("assignedTo", sql.Int, parseInt(req.query.assignedTo, 10));
      hConds.push("b.AssignedTo = @assignedTo");
    }
    if (req.query.search && String(req.query.search).trim()) {
      reqH.input("srch", sql.NVarChar(200), `%${String(req.query.search).trim()}%`);
      hConds.push("(a.ApplicantName LIKE @srch OR a.Mobile LIKE @srch OR b.BookingNo LIKE @srch OR COALESCE(bn.UnitNo, um.UnitName, b.UnitNo) LIKE @srch OR COALESCE(bn.ProjectName, b.ProjectName) LIKE @srch OR u.name LIKE @srch)");
    }
    const hWhere = hConds.length ? `WHERE ${hConds.join(" AND ")}` : "";

    const boardCountSql = `
      SELECT
        SUM(CASE WHEN y.HasWelcomed = 0 THEN 1 ELSE 0 END) AS TabQueue,
        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 0 THEN 1 ELSE 0 END) AS TabChecklist,
        SUM(CASE WHEN y.OpenRecheckCount > 0 THEN 1 ELSE 0 END) AS TabRecheck,
        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 1 AND y.OpenRecheckCount = 0 THEN 1 ELSE 0 END) AS TabVerified,

        SUM(CASE WHEN y.HasWelcomed = 0 AND y.LastCallId IS NULL THEN 1 ELSE 0 END) AS QNeverCalled,
        SUM(CASE WHEN y.HasWelcomed = 0 AND y.LastCallId IS NOT NULL AND y.NextCallDate IS NOT NULL AND y.NextCallDate < y.TodayDate THEN 1 ELSE 0 END) AS QOverdue,
        SUM(CASE WHEN y.HasWelcomed = 0 AND y.LastCallId IS NOT NULL AND y.NextCallDate = y.TodayDate THEN 1 ELSE 0 END) AS QDueToday,
        SUM(CASE WHEN y.HasWelcomed = 0 AND y.IsUnreachable3 = 1 THEN 1 ELSE 0 END) AS QUnreachable3,
        SUM(CASE WHEN y.HasWelcomed = 0 AND y.LastCallId IS NOT NULL AND y.NextCallDate > y.TodayDate THEN 1 ELSE 0 END) AS QScheduled,

        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 0 AND y.CheckedCount < y.ChecklistTotal THEN 1 ELSE 0 END) AS CIncomplete,
        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 0 AND y.CheckedCount >= y.ChecklistTotal AND y.OpenRecheckCount = 0 THEN 1 ELSE 0 END) AS CReadyToSubmit,
        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 0 AND y.OpenRecheckCount > 0 THEN 1 ELSE 0 END) AS CHasRecheck,
        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 0 AND y.MissingFinancing = 1 THEN 1 ELSE 0 END) AS CMissingFinancing,
        SUM(CASE WHEN y.HasWelcomed = 1 AND y.IsLocked = 0 AND y.PlanDisputed = 1 THEN 1 ELSE 0 END) AS CPlanDisputed,

        SUM(CASE WHEN y.OpenRecheckCount > 0 AND y.FlagAging = 1 THEN 1 ELSE 0 END) AS RAging,
        SUM(CASE WHEN y.OpenRecheckCount >= 2 THEN 1 ELSE 0 END) AS RMulti
      FROM (
        SELECT
          CAST(SYSDATETIME() AS DATE) AS TodayDate,
          CASE WHEN ${HAS_WELCOMED_SQL} THEN 1 ELSE 0 END AS HasWelcomed,
          ISNULL(sub.IsLocked, 0) AS IsLocked,
          lastCall.Id AS LastCallId,
          lastCall.NextCallDate,
          CASE WHEN ${STREAK_AT_LEAST_3_SQL} THEN 1 ELSE 0 END AS IsUnreachable3,
          ISNULL(rc.OpenRecheckCount, 0) AS OpenRecheckCount,
          ${CHECKLIST_TOTAL_EXPR} AS ChecklistTotal,
          ${CHECKED_COUNT_EXPR} AS CheckedCount,
          CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(b.FinancingType, N''))), N'') IS NULL THEN 1 ELSE 0 END AS MissingFinancing,
          CASE WHEN planPref.PaymentPlanConfirmed = 0 THEN 1 ELSE 0 END AS PlanDisputed,
          CASE WHEN rc.OldestFlaggedAt IS NOT NULL AND CAST(rc.OldestFlaggedAt AS DATE) <= DATEADD(day, -3, CAST(SYSDATETIME() AS DATE)) THEN 1 ELSE 0 END AS FlagAging
        ${BOARD_BASE_FROM}
        ${scopeWhere}
      ) y
    `;

    const [bRes, hRes] = await Promise.all([
      reqB.query(boardCountSql),
      reqH.query(`SELECT COUNT(*) AS total ${WC_FROM} ${hWhere}`),
    ]);

    const d = bRes.recordset[0] || {};
    res.json({
      tabs: {
        queue: Number(d.TabQueue) || 0,
        checklist: Number(d.TabChecklist) || 0,
        recheck: Number(d.TabRecheck) || 0,
        verified: Number(d.TabVerified) || 0,
        history: Number(hRes.recordset[0]?.total) || 0,
      },
      focus: {
        queue: {
          neverCalled: Number(d.QNeverCalled) || 0,
          overdue: Number(d.QOverdue) || 0,
          dueToday: Number(d.QDueToday) || 0,
          unreachable3: Number(d.QUnreachable3) || 0,
          scheduled: Number(d.QScheduled) || 0,
        },
        checklist: {
          incomplete: Number(d.CIncomplete) || 0,
          readyToSubmit: Number(d.CReadyToSubmit) || 0,
          hasRecheck: Number(d.CHasRecheck) || 0,
          missingFinancing: Number(d.CMissingFinancing) || 0,
          planDisputed: Number(d.CPlanDisputed) || 0,
        },
        recheck: {
          aging: Number(d.RAging) || 0,
          multi: Number(d.RMulti) || 0,
        },
      },
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /board/counts error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Helper to build Call History WHERE conditions (shared between GET / and GET /history-counts)
function buildHistoryFilters(req0, query, projectScope) {
  const { bookingId, pending, search, outcome, focus, calledBy, assignedTo, dateFrom, dateTo } = query;
  const companyId = query.companyId ? parseInt(query.companyId, 10) : null;
  const projectId = query.projectId ? parseInt(query.projectId, 10) : null;
  const blockId = query.blockId ? parseInt(query.blockId, 10) : null;
  const conds = [];
  if (projectScope) conds.push(projectPredicate(projectScope, "b.ProjectId", "").trim());
  if (bookingId) { req0.input("bid", sql.Int, parseInt(bookingId, 10)); conds.push("wc.BookingId = @bid"); }
  if (pending === "1") conds.push("wc.NextCallDate <= CAST(SYSDATETIME() AS DATE)");
  if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
  if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
  if (blockId) {
    req0.input("blockId", sql.Int, blockId);
    conds.push(`(COALESCE(um.BlockId, b.BlockId) = @blockId OR EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId WHERE bp.BookingId = b.Id AND bp.Status = N'Active' AND pm.BlockId = @blockId))`);
  }
  if (assignedTo === "unassigned") conds.push("b.AssignedTo IS NULL");
  else if (assignedTo && /^\d+$/.test(String(assignedTo))) {
    req0.input("assignedTo", sql.Int, parseInt(assignedTo, 10));
    conds.push("b.AssignedTo = @assignedTo");
  }
  if (calledBy && /^\d+$/.test(String(calledBy))) {
    req0.input("calledBy", sql.Int, parseInt(calledBy, 10));
    conds.push("wc.CalledBy = @calledBy");
  }
  if (outcome && OUTCOMES.includes(String(outcome))) {
    req0.input("outcome", sql.NVarChar(50), String(outcome));
    conds.push("wc.Outcome = @outcome");
  }
  if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom))) {
    req0.input("dateFrom", sql.Date, String(dateFrom));
    conds.push("CAST(ISNULL(wc.CallDate, wc.CreatedAt) AS DATE) >= @dateFrom");
  }
  if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(String(dateTo))) {
    req0.input("dateTo", sql.Date, String(dateTo));
    conds.push("CAST(ISNULL(wc.CallDate, wc.CreatedAt) AS DATE) <= @dateTo");
  }
  if (focus === "welcomed") conds.push("wc.Outcome = N'Welcomed'");
  else if (focus === "callback") conds.push("wc.Outcome = N'RequestedCallback'");
  else if (focus === "notReached") conds.push(`wc.Outcome IN (${NON_REACHED_OUTCOMES_SQL})`);
  else if (focus === "planDisputed") conds.push("wc.PaymentPlanConfirmed = 0");
  else if (focus === "submitted") conds.push("sub.IsLocked = 1");
  if (search && String(search).trim()) {
    req0.input("search", sql.NVarChar(200), `%${String(search).trim()}%`);
    conds.push("(a.ApplicantName LIKE @search OR a.Mobile LIKE @search OR b.BookingNo LIKE @search OR COALESCE(bn.UnitNo, um.UnitName, b.UnitNo) LIKE @search OR COALESCE(bn.ProjectName, b.ProjectName) LIKE @search OR u.name LIKE @search OR wc.Notes LIKE @search)");
  }
  return conds.length ? "WHERE " + conds.join(" AND ") : "";
}

// GET /history-counts — Call History focus breakdown across all matching calls
router.get("/history-counts", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const where = buildHistoryFilters(req0, { ...req.query, focus: "" }, req.projectScope);
    const r = await req0.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN wc.Outcome = N'Welcomed' THEN 1 ELSE 0 END) AS welcomed,
        SUM(CASE WHEN wc.Outcome = N'RequestedCallback' THEN 1 ELSE 0 END) AS callback,
        SUM(CASE WHEN wc.Outcome IN (${NON_REACHED_OUTCOMES_SQL}) THEN 1 ELSE 0 END) AS notReached,
        SUM(CASE WHEN wc.PaymentPlanConfirmed = 0 THEN 1 ELSE 0 END) AS planDisputed,
        SUM(CASE WHEN sub.IsLocked = 1 THEN 1 ELSE 0 END) AS submitted
      ${WC_FROM}
      ${where}
    `);
    const d = r.recordset[0] || {};
    res.json({
      total: Number(d.total) || 0,
      welcomed: Number(d.welcomed) || 0,
      callback: Number(d.callback) || 0,
      notReached: Number(d.notReached) || 0,
      planDisputed: Number(d.planDisputed) || 0,
      submitted: Number(d.submitted) || 0,
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /history-counts error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /queue — the work queue: Approved bookings that still need a welcome
// call, or have a callback due today/overdue. Never Cancelled/Rejected/
// Pending bookings — those have no business being called yet.
router.get("/queue", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    // Not paginated — this queue is naturally bounded to "still needs a
    // call" bookings, not the full historical volume. Company/Project/Block
    // still narrows it for a multi-company deployment.
    const conds = [
      `b.Status = '${CrmStatus.APPROVED}'`, "b.IsActive = 1",
      "(last.Id IS NULL OR (last.Outcome <> 'Welcomed' AND (last.NextCallDate IS NULL OR last.NextCallDate <= CAST(SYSDATETIME() AS DATE))))",
    ];
    // A user limited to some projects sees only their bookings (the queue used to list every project's).
    if (req.projectScope) conds.push(projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    const req0 = pool.request();
    if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
    if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
    if (blockId) { req0.input("blockId", sql.Int, blockId); conds.push("b.BlockId = @blockId"); }
    const result = await req0.query(`
      SELECT
        b.Id AS BookingId, b.BookingNo,
        COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
        COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
        b.BookingDate,
        a.ApplicantName, a.Mobile,
        last.Id AS LastCallId, last.Outcome AS LastOutcome, last.CallDate AS LastCallDate,
        last.NextCallDate,
        -- Ordered outcomes as JSON so JS can compute the true consecutive
        -- streak (stop counting at the first Welcomed) rather than a COUNT(*)
        -- that has no concept of a streak-breaking outcome in the middle.
        (
          SELECT TOP 20 Outcome
          FROM dbo.CrmWelcomeCall
          WHERE BookingId = b.Id
          ORDER BY CallDate DESC, CreatedAt DESC
          FOR JSON PATH
        ) AS RecentOutcomesJson
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      OUTER APPLY (
        SELECT TOP 1 Id, Outcome, CallDate, NextCallDate
        FROM dbo.CrmWelcomeCall
        WHERE BookingId = b.Id
        ORDER BY CallDate DESC, CreatedAt DESC
      ) last
      WHERE ${conds.join(" AND ")}
      ORDER BY ISNULL(last.NextCallDate, b.BookingDate)
    `);
    // Compute the real consecutive streak in JS for each row and strip the
    // raw JSON column before sending to the client.
    const rows = result.recordset.map((r) => {
      let consecutiveNonReached = 0;
      try {
        const outcomes = JSON.parse(r.RecentOutcomesJson || "[]");
        consecutiveNonReached = computeStreak(outcomes.map((o) => o.Outcome));
      } catch {}
      const { RecentOutcomesJson: _, ...rest } = r;
      return { ...rest, ConsecutiveNonReached: consecutiveNonReached };
    });
    res.json(rows);
  } catch (e) {
    console.error("[crm-welcome-calls] GET /queue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:bookingId/checklist — aggregate status of every intake step for one
// booking, so the detail panel can show a single progress checklist instead
// of staff hopping between pages to check each one manually.
router.get("/:bookingId/checklist", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid bookingId" });

    const [welcome, callCount, docs, coApplicants, bankDetail, noc, agreement] = await Promise.all([
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Outcome FROM dbo.CrmWelcomeCall WHERE BookingId = @bid ORDER BY CallDate DESC, CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmWelcomeCall WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query(`
          SELECT COUNT(*) AS Total, SUM(CASE WHEN IsVerified = 1 THEN 1 ELSE 0 END) AS Verified
          FROM dbo.CrmBookingDocument
          WHERE BookingId = @bid
             OR (ApplicationId = (
                  SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1
                ) AND BookingId IS NULL)
        `),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1"),
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 1 CASE WHEN
          NULLIF(LTRIM(RTRIM(ISNULL(BankName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AccountNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(IfscCode, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AccountHolderName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(PanNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AadhaarNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(Occupation, ''))), '') IS NOT NULL
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsComplete
        FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT Id, NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
    ]);

    res.json({
      // done: the real "Welcome Call page finished cleanly" signal (Welcomed
      // specifically). called: at least one call attempt is on file, even if
      // it hasn't landed on Welcomed yet — lets the frontend show yellow
      // ("in progress") instead of collapsing "never called" and "called but
      // not yet Welcomed" into the same blank state.
      welcomeCall: { done: welcome.recordset[0]?.Outcome === "Welcomed", called: (callCount.recordset[0]?.Cnt || 0) > 0 },
      documents: { total: docs.recordset[0]?.Total || 0, verified: docs.recordset[0]?.Verified || 0 },
      coApplicants: { count: coApplicants.recordset[0]?.Cnt || 0 },
      // started: a CrmCustomerBankDetail row exists at all (even partially
      // filled) — distinct from complete, so the frontend can show yellow
      // for "in progress" instead of only blank/green.
      bankDetails: { started: bankDetail.recordset.length > 0, complete: !!bankDetail.recordset[0]?.IsComplete },
      noc: noc.recordset,
      agreement: agreement.recordset[0] || null,
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /:bookingId/checklist error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:bookingId/call-context — everything a telecaller needs on-screen
// DURING the call: what's outstanding, what's already been invoiced, the
// customer's bank/loan preference on file, the assigned payment plan, and
// any on-account credit sitting unapplied — one fetch instead of the
// telecaller (or the page) hopping across four separate pages mid-call.
router.get("/:bookingId/call-context", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid bookingId" });

    const [bkRes, custRes, milRes, invRes, loanRes, oaRes, mrRes, recentCallsRes, padRes] = await Promise.all([
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT b.Id, b.BookingNo, b.ApplicationId, b.BookingDate, b.Status AS BookingStatus,
               b.AssignedTo, uOwner.name AS AssignedToName,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bpx WHERE bpx.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS IsPlotSale,
               COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
               COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
               COALESCE(blk.BlockName, b.BlockName) AS BlockName,
               COALESCE(bn.UnitType, b.UnitType) AS UnitType,
               b.AreaSqFt,
               b.CarpetAreaSqFt, b.BuiltUpAreaSqFt, b.SuperBuiltUpAreaSqFt, b.OpenTerraceAreaSqFt,
               b.RatePerSqFt, b.TotalValue, b.BookingAmount, b.GrandTotal,
               b.ParkingTotal, b.ExtraChargesTotal, b.UnitGstAmount,
               b.PaymentPlanId, pp.PlanName AS PaymentPlanName,
               b.FinancingType,
               a.ApplicantName, a.Mobile, a.Email
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
        LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
        LEFT JOIN dbo.BlockMaster blk ON blk.Id = COALESCE(um.BlockId, b.BlockId)
        LEFT JOIN dbo.Users uOwner ON uOwner.id = b.AssignedTo
        LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = b.PaymentPlanId
        WHERE b.Id = @bid
      `),
      // Address columns added for the "Communication address confirmed"
      // checklist item (welcome-checklist.js's PersonalContact section) —
      // this call-context route used to only carry Name/Mobile/Email/PAN,
      // so that item had no data anywhere on the page to actually check
      // against. Current* wins when set (the customer's real mailing
      // address); falls back to the permanent Address/City/State/Pincode
      // otherwise, same precedence CrmCustomers.tsx's own display uses.
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT c.CustomerName, c.Mobile, c.Email, c.PanNo,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentAddress)), ''), c.Address) AS Address,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentCity)), ''), c.City) AS City,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentState)), ''), c.State) AS State,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentPincode)), ''), c.Pincode) AS Pincode
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
        JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id
        WHERE b.Id = @bid
      `),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT MilestoneName, AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT InvoiceNo, InvoiceType, Amount, InvoiceDate FROM dbo.CrmInvoice WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT BankName, LoanAmount, SanctionStatus, LoanAccountNo FROM dbo.CrmLoanDetail WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ReceiptNo, Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ISNULL(SUM(Amount), 0) AS MRTotal FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status IN ('Pending','Approved')"),
      // Ordered calls (most-recent first) for consecutive streak calculation AND
      // inline call-history timeline inside the Welcome Call dialog.
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 20
               wc.Id, wc.BookingId, wc.CalledBy, wc.CallDate, wc.DurationSeconds,
               wc.Outcome, wc.NextCallDate, wc.Notes, wc.CustomFields,
               wc.PreferredAgreementDate, wc.PaymentPlanConfirmed,
               wc.PaymentPlanDisputeReason, wc.CreatedAt,
               u.name AS CalledByName
        FROM dbo.CrmWelcomeCall wc
        LEFT JOIN dbo.Users u ON u.id = wc.CalledBy
        WHERE wc.BookingId = @bid
        ORDER BY wc.CallDate DESC, wc.CreatedAt DESC
      `),
      // Latest NON-NULL PreferredAgreementDate across every call logged so
      // far — a follow-up call that didn't re-ask/re-enter it must not make
      // it look like nothing was ever captured. Surfaced so the "Log Call"
      // form can pre-fill/carry it forward instead of silently starting
      // blank on every new call (see the same latest-non-null fix in
      // crmAgreements.js POST / which reads this for real).
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 1 PreferredAgreementDate FROM dbo.CrmWelcomeCall
        WHERE BookingId = @bid AND PreferredAgreementDate IS NOT NULL
        ORDER BY CreatedAt DESC
      `),
    ]);
    if (!bkRes.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const milestones = milRes.recordset;
    const totalDue = sumMoney(milestones, (m) => m.AmountDue);
    const totalPaid = sumMoney(milestones, (m) => m.AmountPaid);
    const onAccountBalance = sumMoney(oaRes.recordset, (r) => Number(r.Amount) - Number(r.AppliedAmount));
    const mrReceived = Number(mrRes.recordset[0]?.MRTotal || 0);
    const consecutiveNonReached = computeStreak(recentCallsRes.recordset.map((r) => r.Outcome));

    const booking = bkRes.recordset[0];
    res.json({
      booking,
      customer: custRes.recordset[0] || null,
      outstanding: { totalDue, totalPaid, balance: totalDue - totalPaid },
      invoices: invRes.recordset,
      loan: loanRes.recordset[0] || null,
      onAccount: { payments: oaRes.recordset, availableBalance: onAccountBalance },
      mrReceived,
      consecutiveNonReached,
      recentCalls: recentCallsRes.recordset,
      // FinancingType is on CrmBooking (captured via the welcome call tab's
      // "How is this financed?" card, or later via Bank & KYC). Surfaced here
      // so the Bank Preference tab can show the current selection without an
      // additional fetch.
      financingType: booking.FinancingType || null,
      // Latest known PreferredAgreementDate, carried forward across follow-up
      // calls that didn't re-enter it — see comment on the query above.
      latestPreferredAgreementDate: padRes.recordset[0]?.PreferredAgreementDate || null,
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /:bookingId/call-context error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const HISTORY_SORT_MAP = {
  CallDate: "ISNULL(wc.CallDate, wc.CreatedAt)",
  CreatedAt: "wc.CreatedAt",
  BookingNo: "b.BookingNo",
  ApplicantName: "a.ApplicantName",
  ProjectName: "COALESCE(bn.ProjectName, b.ProjectName)",
  CalledByName: "ISNULL(u.name, N'zzzz')",
  Outcome: "ISNULL(wc.Outcome, N'')",
  DurationSeconds: "ISNULL(wc.DurationSeconds, 0)",
  NextCallDate: "ISNULL(wc.NextCallDate, '9999-12-31')",
};

// GET / — all welcome calls
router.get("/", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const countReq = pool.request();
    const where = buildHistoryFilters(req0, req.query, req.projectScope);
    const countWhere = buildHistoryFilters(countReq, req.query, req.projectScope);

    const sortKey = String(req.query.sortKey || "CallDate");
    const sortExpr = Object.hasOwn(HISTORY_SORT_MAP, sortKey) ? HISTORY_SORT_MAP[sortKey] : HISTORY_SORT_MAP.CallDate;
    const sortDir = req.query.sortDir === "asc" ? "ASC" : "DESC";
    const orderSql = `ORDER BY ${sortExpr} ${sortDir}, wc.Id DESC`;

    if (!req.query.page) {
      const result = await req0.query(`${WC_SELECT} ${where} ${orderSql}`);
      return res.json(result.recordset);
    }

    const { page, pageSize, offset } = applyPagination(req, 25, 200);
    req0.input("offset", sql.Int, offset);
    req0.input("pageSize", sql.Int, pageSize);
    const [result, countResult] = await Promise.all([
      req0.query(`${WC_SELECT} ${where} ${orderSql} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      countReq.query(`SELECT COUNT(*) AS total ${WC_FROM} ${countWhere}`),
    ]);
    res.json({ rows: result.recordset, total: countResult.recordset[0]?.total || 0, page, pageSize });
  } catch (e) {
    console.error("[crm-welcome-calls] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — log a welcome call. Requires a fully approved booking (Status =
// 'Approved') — a Pending booking has not been signed off by admin yet and
// should not progress into post-booking workflows.
router.post("/", requirePageRight("crm-welcome-calls", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const activeErr = await requireApprovedBooking(pool, parseInt(b.BookingId));
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Idempotency window: reject a duplicate log for the same booking + outcome
    // within 30 seconds (catches slow-network double-submits from the frontend).
    const recent = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .input("out", sql.NVarChar(50), b.Outcome || null)
      .query(`SELECT TOP 1 Id FROM dbo.CrmWelcomeCall
              WHERE BookingId = @bid AND Outcome = @out
              AND CreatedAt >= DATEADD(second, -30, SYSDATETIME())`);
    if (recent.recordset.length) {
      return res.status(409).json({ error: "A call log with the same outcome was just submitted for this booking — please wait a moment before submitting again." });
    }

    if (b.Outcome && !OUTCOMES.includes(b.Outcome))
      return res.status(400).json({ error: `Invalid Outcome. Must be: ${OUTCOMES.join(", ")}` });

    // A customer explicitly declining the payment plan is a real business
    // problem, not a silent checkbox left unticked — staff must say why, so
    // whoever picks it up next (Communication Log) has something to act on
    // rather than just "not confirmed".
    if (b.PaymentPlanConfirmed === false && !String(b.PaymentPlanDisputeReason || "").trim()) {
      return res.status(400).json({ error: "A reason is required when the customer does not agree to the payment plan" });
    }

    // Ad-hoc custom fields: array of {key, value} the caller can freely add
    // to at call time, no admin setup needed — stored as JSON, never parsed
    // into columns.
    let customFieldsJson = null;
    if (Array.isArray(b.CustomFields) && b.CustomFields.length) {
      const cleaned = b.CustomFields
        .filter((f) => f && String(f.key || "").trim())
        .map((f) => ({ key: String(f.key).trim(), value: String(f.value ?? "").trim() }));
      if (cleaned.length) customFieldsJson = JSON.stringify(cleaned);
    }

    const bookingId = parseInt(b.BookingId);
    const bookingRow = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BookingNo, ApplicationId, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
    const booking = bookingRow.recordset[0];

    // The call INSERT, its auto-seeded Communication Log entry, and (on a
    // decline) the payment-plan-dispute log entry describe one event and
    // must land together — wrapped so a failure partway through can't leave
    // the call logged with no trace of it in the Communication Log, or a
    // dispute recorded on the call but invisible to whoever works that page.
    // Notification stays outside (pure websocket, no DB write).
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input("bid",  sql.Int,           bookingId)
        .input("cb",   sql.Int,           b.CalledBy ? parseInt(b.CalledBy) : actorId(req))
        .input("dt",   sql.DateTime2(3),  b.CallDate || null)
        .input("dur",  sql.Int,           b.DurationSeconds ? parseInt(b.DurationSeconds) : null)
        .input("out",  sql.NVarChar(50),  b.Outcome || null)
        .input("ncd",  sql.Date,          b.NextCallDate || null)
        .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
        .input("cf",   sql.NVarChar(sql.MAX), customFieldsJson)
        .input("pad",  sql.Date,          b.PreferredAgreementDate || null)
        .input("ppc",  sql.Bit,           b.PaymentPlanConfirmed === true ? 1 : b.PaymentPlanConfirmed === false ? 0 : null)
        .input("ppcat",sql.DateTime2(3),  b.PaymentPlanConfirmed === true ? new Date() : null)
        .input("ppr",  sql.NVarChar(500), b.PaymentPlanConfirmed === false ? String(b.PaymentPlanDisputeReason).trim() : null)
        .input("acb",  sql.Int,           actorId(req))
        .query(`
          INSERT INTO dbo.CrmWelcomeCall
            (BookingId, CalledBy, CallDate, DurationSeconds, Outcome, NextCallDate, Notes, CustomFields, PreferredAgreementDate, PaymentPlanConfirmed, PaymentPlanConfirmedAt, PaymentPlanDisputeReason, CreatedBy, CreatedAt)
          VALUES (@bid, @cb, ISNULL(@dt, SYSDATETIME()), @dur, @out, @ncd, @note, @cf, @pad, @ppc, @ppcat, @ppr, @acb, SYSDATETIME())
        `);

      // Auto-flow: every logged call is itself a customer touchpoint — seed it
      // into the Communication Log automatically so that page becomes the
      // unified, continuing record of "further works and other tasks" instead
      // of staff having to separately re-log the same call there by hand.
      if (booking) {
        await tx.request()
          .input("aid",  sql.Int, booking.ApplicationId)
          .input("bid",  sql.Int, bookingId)
          .input("subj", sql.NVarChar(300), `Welcome Call${b.Outcome ? ` — ${b.Outcome}` : ""}`)
          .input("sum",  sql.NVarChar(sql.MAX), b.Notes || null)
          .input("cat",  sql.DateTime2(3), b.CallDate || null)
          .input("cb",   sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmCommunicationLog
              (ApplicationId, BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
            VALUES (@aid, @bid, 'Call', 'Outbound', @subj, @sum, ISNULL(@cat, SYSDATETIME()), @cb, SYSDATETIME())
          `);

        // A customer declining the payment plan is a real, open issue — hand
        // it to the Communication Log as its own entry (Inbound, since it's
        // the customer's own objection) so whoever works that page next has
        // something concrete to follow up on, not just a checkbox buried on
        // this page.
        if (b.PaymentPlanConfirmed === false) {
          await logCommunication(tx, {
            applicationId: booking.ApplicationId, bookingId,
            direction: "Inbound",
            subject: "Payment Plan Not Confirmed",
            summary: String(b.PaymentPlanDisputeReason).trim(),
            createdBy: actorId(req),
          });
        }
      }

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

    if (booking?.AssignedTo && b.PaymentPlanConfirmed === false) {
      await emitNotification(pool, booking.AssignedTo, "crm_payment_plan_disputed",
        "Customer Did Not Agree to Payment Plan",
        `${booking.BookingNo}: ${String(b.PaymentPlanDisputeReason).trim()}`,
        bookingId, "crm_booking");
    }

    // Auto-flow: a completed welcome call is one of two prerequisites for
    // agreement prep — fire the auto-create check (no-op if bank/PAN/Aadhaar
    // details aren't in yet) rather than waiting on staff to notice.
    if (b.Outcome === "Welcomed") {
      const created = await maybeAutoCreateAgreement(pool, bookingId, actorId(req));
      if (!created && booking?.AssignedTo) {
        await emitNotification(pool, booking.AssignedTo, "crm_bank_details_due",
          "Customer Details Needed",
          `Welcome call done for booking ${booking.BookingNo} — collect bank, PAN, and Aadhaar details to proceed to agreement.`,
          bookingId, "crm_booking");
      }
    }

    res.status(201).json({ success: true, bookingId });
  } catch (e) {
    console.error("[crm-welcome-calls] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit an already-logged call (correcting outcome, notes, dates, etc.)
router.put("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;
    if (b.Outcome && !OUTCOMES.includes(b.Outcome))
      return res.status(400).json({ error: `Invalid Outcome. Must be: ${OUTCOMES.join(", ")}` });
    if (b.PaymentPlanConfirmed === false && !String(b.PaymentPlanDisputeReason || "").trim()) {
      return res.status(400).json({ error: "A reason is required when the customer does not agree to the payment plan" });
    }

    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BookingId, Outcome, PaymentPlanConfirmed FROM dbo.CrmWelcomeCall WHERE Id = @id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Call log not found" });

    // Distinguish "field genuinely absent from this request" (preserve the
    // existing value) from "field explicitly sent, even as empty/null"
    // (apply it — including clearing it on purpose). A partial-body edit
    // (e.g. a caller that only sends { Outcome: "Welcomed" } to correct a
    // mis-entry) must never silently wipe DurationSeconds/NextCallDate/
    // Notes/CustomFields/PreferredAgreementDate just because it didn't
    // mention them — while a caller that DOES want to clear one of these
    // (e.g. NextCallDate: null, once no callback is needed anymore) must
    // still be able to. CalledBy/CallDate/Outcome/PaymentPlanConfirmed
    // already got this right via ISNULL and are unchanged below.
    const has = (key) => Object.prototype.hasOwnProperty.call(b, key);

    let customFieldsJson = null;
    if (Array.isArray(b.CustomFields)) {
      const cleaned = b.CustomFields
        .filter((f) => f && String(f.key || "").trim())
        .map((f) => ({ key: String(f.key).trim(), value: String(f.value ?? "").trim() }));
      customFieldsJson = cleaned.length ? JSON.stringify(cleaned) : null;
    }

    // CalledBy/CallDate/DurationSeconds are the factual record of when the
    // call happened, who made it, and how long it ran — that's history, not
    // an editable field, so this endpoint never touches them after creation.
    // Everything else here (outcome, follow-up, notes, custom fields) is a
    // legitimate after-the-fact correction/annotation and stays editable.
    await pool.request()
      .input("id",   sql.Int, id)
      .input("out",  sql.NVarChar(50), b.Outcome || null)
      .input("ncd",  sql.Date, b.NextCallDate || null)
      .input("ncdP", sql.Bit, has("NextCallDate") ? 1 : 0)
      .input("note", sql.NVarChar(sql.MAX), b.Notes ?? null)
      .input("noteP",sql.Bit, has("Notes") ? 1 : 0)
      .input("cf",   sql.NVarChar(sql.MAX), customFieldsJson)
      .input("cfP",  sql.Bit, has("CustomFields") ? 1 : 0)
      .input("pad",  sql.Date, b.PreferredAgreementDate || null)
      .input("padP", sql.Bit, has("PreferredAgreementDate") ? 1 : 0)
      .input("ppc",  sql.Bit,  b.PaymentPlanConfirmed != null ? (b.PaymentPlanConfirmed ? 1 : 0) : null)
      .input("ppr",  sql.NVarChar(500), b.PaymentPlanConfirmed === false ? String(b.PaymentPlanDisputeReason).trim() : null)
      .query(`
        UPDATE dbo.CrmWelcomeCall SET
          Outcome = ISNULL(@out, Outcome),
          NextCallDate = CASE WHEN @ncdP = 1 THEN @ncd ELSE NextCallDate END,
          Notes = CASE WHEN @noteP = 1 THEN @note ELSE Notes END,
          CustomFields = CASE WHEN @cfP = 1 THEN @cf ELSE CustomFields END,
          PreferredAgreementDate = CASE WHEN @padP = 1 THEN @pad ELSE PreferredAgreementDate END,
          PaymentPlanConfirmed = ISNULL(@ppc, PaymentPlanConfirmed),
          PaymentPlanConfirmedAt = CASE WHEN @ppc = 1 THEN ISNULL(PaymentPlanConfirmedAt, SYSDATETIME()) ELSE PaymentPlanConfirmedAt END,
          -- Revertible: re-confirming (true) clears any prior dispute reason;
          -- disputing (false) always overwrites with the fresh reason; a
          -- request that doesn't touch PaymentPlanConfirmed at all (@ppc
          -- NULL) leaves the existing reason untouched — @ppr is bound to
          -- NULL in that case too, but the ELSE branch below never reads it.
          PaymentPlanDisputeReason = CASE
            WHEN @ppc = 1 THEN NULL
            WHEN @ppc = 0 THEN @ppr
            ELSE PaymentPlanDisputeReason
          END
        WHERE Id = @id
      `);
    // Same auto-flow POST / fires — a welcome call can be logged with one
    // outcome and later corrected to Welcomed (e.g. a mis-entry), and that
    // correction is just as real a "prerequisite met" event as getting it
    // right the first time. maybeAutoCreateAgreement re-derives the
    // booking's actual latest-call outcome itself (not just this row), so
    // this is a safe no-op if some other, more recent call for the booking
    // still isn't Welcomed, or if the bank-detail prerequisite isn't in yet.
    if (b.Outcome === "Welcomed" && existing.recordset[0].BookingId) {
      await maybeAutoCreateAgreement(pool, existing.recordset[0].BookingId, actorId(req));
    }

    // Same "hand a real dispute to Communication Log" flow as POST / —
    // only fires on the actual transition into disputed (not on every save
    // of an already-disputed row), so editing unrelated fields on a
    // previously-disputed call doesn't spam a duplicate log entry.
    if (b.PaymentPlanConfirmed === false && existing.recordset[0].PaymentPlanConfirmed !== false) {
      const bkg = await pool.request().input("bid", sql.Int, existing.recordset[0].BookingId)
        .query("SELECT BookingNo, ApplicationId, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
      const bkgRow = bkg.recordset[0];
      if (bkgRow) {
        await logCommunication(pool, {
          applicationId: bkgRow.ApplicationId, bookingId: existing.recordset[0].BookingId,
          direction: "Inbound",
          subject: "Payment Plan Not Confirmed",
          summary: String(b.PaymentPlanDisputeReason).trim(),
          createdBy: actorId(req),
        });
        if (bkgRow.AssignedTo) {
          await emitNotification(pool, bkgRow.AssignedTo, "crm_payment_plan_disputed",
            "Customer Did Not Agree to Payment Plan",
            `${bkgRow.BookingNo}: ${String(b.PaymentPlanDisputeReason).trim()}`,
            existing.recordset[0].BookingId, "crm_booking");
        }
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-calls] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Financing Type ─────────────────────────────────────────────────────────
// PUT /:bookingId/financing-type — records whether the customer is self-funding
// or taking a home loan. Asked during the welcome call, before Milestone 1
// payment, so this endpoint deliberately has no payment-gate (contrast with
// PUT /api/crm/customer-bank-details/booking/:id which gates all writes on
// Milestone 1 being paid). The Bank & KYC page is the definitive edit path
// post-payment; this is the first-touch capture path at call time.
router.put("/:bookingId/financing-type", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid bookingId" });
    const { FinancingType } = req.body;

    if (!["SelfFunded", "LoanFinanced"].includes(FinancingType)) {
      return res.status(400).json({ error: "FinancingType must be SelfFunded or LoanFinanced" });
    }

    // Same gate as the Welcome Call itself (POST / above uses
    // requireApprovedBooking) — this whole workflow (call, financing type,
    // bank preference, checklist, co-applicant, customer bank/KYC) only ever
    // starts once the booking is actually Approved, so every action inside
    // it should require the same, not the weaker "merely still active"
    // (which also lets through Pending/Expired) requireActiveBooking.
    const activeErr = await requireApprovedBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("ft",  sql.NVarChar(20), FinancingType)
      .query("UPDATE dbo.CrmBooking SET FinancingType = @ft WHERE Id = @bid");

    res.json({ success: true, FinancingType });
  } catch (e) {
    console.error("[crm-welcome-calls] PUT /:bookingId/financing-type error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Bank Preference endpoints ─────────────────────────────────────────────
// These record which bank(s) the customer prefers for a home loan, captured
// during the welcome call. Multiple banks are supported. This is NOT the
// finalised/sanctioned loan (that lives in dbo.CrmLoanDetail).

// GET /:bookingId/bank-preferences
// Home Loan Tracking offers these as suggestions when recording the loan, so its right reads them too.
router.get("/:bookingId/bank-preferences", requireAnyPageRight(["crm-welcome-calls", "crm-loan-details"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid bookingId" });
    const result = await pool.request()
      .input("bid", sql.Int, bookingId)
      .query(`
        SELECT bp.Id, bp.BankName, bp.Remarks, bp.CreatedAt, u.name AS CreatedByName
        FROM dbo.CrmWelcomeCallBankPreference bp
        LEFT JOIN dbo.Users u ON u.id = bp.CreatedBy
        WHERE bp.BookingId = @bid
        ORDER BY bp.CreatedAt ASC
      `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-calls] GET /:bookingId/bank-preferences error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId/bank-preferences — add a preferred bank
router.post("/:bookingId/bank-preferences", requirePageRight("crm-welcome-calls", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid bookingId" });
    const { BankName, Remarks } = req.body;

    if (!BankName || !String(BankName).trim()) {
      return res.status(400).json({ error: "BankName is required" });
    }

    // Same gate as the rest of this workflow — see the comment on
    // PUT /:bookingId/financing-type above.
    const activeErr = await requireApprovedBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const result = await pool.request()
      .input("bid",    sql.Int,            bookingId)
      .input("bank",   sql.NVarChar(200),  String(BankName).trim())
      .input("rem",    sql.NVarChar(500),  Remarks ? String(Remarks).trim() : null)
      .input("cb",     sql.Int,            actorId(req))
      .query(`
        INSERT INTO dbo.CrmWelcomeCallBankPreference
          (BookingId, BankName, Remarks, CreatedBy, CreatedAt)
        OUTPUT
          INSERTED.Id, INSERTED.BankName, INSERTED.Remarks, INSERTED.CreatedAt
        VALUES (@bid, @bank, @rem, @cb, SYSDATETIME())
      `);
    res.status(201).json(result.recordset[0]);
  } catch (e) {
    console.error("[crm-welcome-calls] POST /:bookingId/bank-preferences error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:bookingId/bank-preferences/:id — remove a preferred bank
router.delete("/:bookingId/bank-preferences/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid bookingId" });
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const existing = await pool.request()
      .input("id",  sql.Int, id)
      .input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmWelcomeCallBankPreference WHERE Id = @id AND BookingId = @bid");
    if (!existing.recordset.length) {
      return res.status(404).json({ error: "Bank preference not found" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.CrmWelcomeCallBankPreference WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-calls] DELETE /:bookingId/bank-preferences/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — remove a mis-logged call entry.
// Blocked once an Agreement exists for the booking — deleting the only
// 'Welcomed' call log would leave the Agreement without its prerequisite.
router.delete("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const call = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Outcome FROM dbo.CrmWelcomeCall WHERE Id = @id");
    if (!call.recordset.length) return res.status(404).json({ error: "Call log not found" });
    const { BookingId, Outcome } = call.recordset[0];
    if (Outcome === "Welcomed") {
      const agr = await pool.request().input("bid", sql.Int, BookingId)
        .query("SELECT TOP 1 Id FROM dbo.CrmAgreement WHERE BookingId = @bid AND IsActive = 1");
      if (agr.recordset.length) {
        return res.status(400).json({ error: "This welcome call log cannot be deleted — an Agreement already exists for this booking. Delete the Agreement first if this call was mis-logged." });
      }
    }
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmWelcomeCall WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-calls] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
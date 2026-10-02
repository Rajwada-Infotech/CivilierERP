-- Migration 523: put CRM, TDS and bank-charge heads in the right account groups.
--
-- The Trial Balance, Balance Sheet and P&L (routes/financialStatements.js,
-- routes/trialBalance.js) only read heads that belong to a group
-- (LBelongsTo IS NOT NULL), and classify them by the root group they roll up
-- to. A head with no group is silently left out of every statement; a head
-- under the wrong root is shown on the wrong side. A production snapshot
-- (scripts/prodStateSnapshot.js, Oct 2026) found:
--
--   * GST Output Liability - CRM Sales (CRM-GST-OUTPUT) under TRADE
--     RECEIVABLES — an asset group. GST owed is a liability: DUTY & TAXES.
--   * Stamp Duty & Registration Expense (CRM-STAMPDUTY) and Bank Charges
--     (BNKCHG) in no group.
--   * The TDS payable heads (TDS-SECTION ..., TDS-n) in no group.
--
-- Groups are found by code where the code is shared by every environment
-- (DAT, TDSP), and by NAME under its root otherwise — the indirect-expenses
-- group is coded IE in one chart and IEXP in another. Each move only touches a
-- head that is ungrouped or sits under the wrong root, so re-running, or
-- running against a chart that is already right, changes nothing.

DECLARE @dat  INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'DAT');
DECLARE @tdsp INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'TDSP');
DECLARE @ie   INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE UPPER(LTRIM(RTRIM(Name))) = 'INDIRECT EXPENSES' ORDER BY AGId);

-- Root group of every group.
;WITH g AS (
  SELECT AGId, CAST(UPPER(Name) AS NVARCHAR(100)) AS RootName FROM dbo.AccountGroup WHERE ParentGroupId IS NULL OR ParentGroupId = 0
  UNION ALL
  SELECT c.AGId, g.RootName FROM dbo.AccountGroup c JOIN g ON c.ParentGroupId = g.AGId
)
SELECT AGId, RootName INTO #root FROM g OPTION (MAXRECURSION 20);

-- 1. GST output is a liability.
IF @dat IS NOT NULL
  UPDATE h SET LBelongsTo = @dat, UpdatedAt = SYSDATETIME()
  FROM dbo.AccountHeadMaster h
  LEFT JOIN #root r ON r.AGId = h.LBelongsTo
  WHERE h.LHeadCode = 'CRM-GST-OUTPUT' AND (h.LBelongsTo IS NULL OR ISNULL(r.RootName, '') <> 'LIABILITIES');
PRINT CONCAT('Migration 523: GST output head regrouped: ', @@ROWCOUNT);

-- 2. Stamp duty and bank charges are expenses.
IF @ie IS NOT NULL
  UPDATE dbo.AccountHeadMaster SET LBelongsTo = @ie, UpdatedAt = SYSDATETIME()
  WHERE LHeadCode IN ('CRM-STAMPDUTY', 'BNKCHG') AND LBelongsTo IS NULL;
PRINT CONCAT('Migration 523: stamp duty / bank charges grouped: ', @@ROWCOUNT);

-- 3. TDS deducted and payable to the government.
IF @tdsp IS NOT NULL
  UPDATE dbo.AccountHeadMaster SET LBelongsTo = @tdsp, UpdatedAt = SYSDATETIME()
  WHERE LBelongsTo IS NULL AND LHeadType = 'GL' AND LHeadCode LIKE 'TDS-%';
PRINT CONCAT('Migration 523: TDS heads grouped: ', @@ROWCOUNT);

DROP TABLE #root;

-- Anything still without a group is left for Finance to place by hand — the
-- right group is a judgement (e.g. project receivable heads, adjustment
-- accounts), not something to guess. Listed so the deploy log shows it.
DECLARE @left INT = (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LBelongsTo IS NULL);
PRINT CONCAT('Migration 523: heads still without a group (place in Account Head Master): ', @left);
SELECT LHeadId, LHeadCode, LHeadName, LHeadType FROM dbo.AccountHeadMaster WHERE LBelongsTo IS NULL ORDER BY LHeadId;
GO

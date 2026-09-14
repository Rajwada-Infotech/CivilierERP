-- Migration 385 seeded "Fixed Assets A/c" with a hardcoded LBelongsTo = 31
-- (dev's AGId for the FIXED ASSETS group) — same class of mistake as 383/
-- 385's sibling migrations. On production AGId 31 doesn't exist at all, so
-- the seeded head points at nothing: financialStatements.js's rootOf() walks
-- groupMap.get(31), gets undefined immediately, and returns null — which
-- silently excludes the head from every financial report entirely (worse
-- than misclassified: invisible), and Trial Balance's join renders it as an
-- orphaned "Group-31" fallback name.
--
-- Confirmed live: AccountHeadMaster.LHeadId 2446 ("Fixed Assets A/c") has
-- LBelongsTo = 31, and `SELECT * FROM AccountGroup WHERE AGId = 31` returns
-- zero rows on production.
--
-- Fixed by looking up the real FIXED ASSETS group by name, matching the
-- pattern every later migration in this batch (387/388/389) already
-- switched to instead of a hardcoded AGId.

DECLARE @FixedAssetsId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'FIXED ASSETS');

IF @FixedAssetsId IS NOT NULL
BEGIN
  UPDATE dbo.AccountHeadMaster
     SET LBelongsTo = @FixedAssetsId
   WHERE LHeadName = 'Fixed Assets A/c' AND LHeadCode = 'FIXAST';
  PRINT 'Repointed Fixed Assets A/c to the real FIXED ASSETS group (AGId ' + CAST(@FixedAssetsId AS VARCHAR) + ').';
END
ELSE
  PRINT 'WARNING: No "FIXED ASSETS" group found — Fixed Assets A/c left dangling. Investigate manually.';

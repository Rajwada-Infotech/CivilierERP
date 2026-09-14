-- The real root cause behind bank heads (UJJIVAN BANK LIMITED, AXIS BANK
-- LIMITED, BANDHAN BANK LIMITED, ICICI BANK, etc.) showing under "Other
-- Income" in production's P&L: it isn't individual heads pointing to the
-- wrong AccountGroup (migration 386 confirmed every one of them correctly
-- points to BANKS) — it's that the BANKS group itself was parented directly
-- under REVENUE (AGId 3, hardcoded as ROOT_IDS.REVENUE in
-- financialStatements.js/trialBalance.js) instead of under Assets. Every
-- head under BANKS resolves to the Revenue root as a result, regardless of
-- which specific bank head it is — a credit to ANY bank account would show
-- as income, not just the loan-related ones this was first suspected to be.
--
-- Confirmed live on production: `SELECT * FROM AccountGroup WHERE AGId =
-- 1173` returned Name='BANKS', Code='BNK', ParentGroupId=3.
--
-- Fixed by name/code (not a hardcoded AGId, since group ids are
-- environment-specific auto-increment values, not stable across
-- databases) — reparent BANKS under CURRENT ASSETS, matching the seeded
-- convention (dev's BANKS group sits under CURRENT ASSETS the same way).

DECLARE @CurrentAssetsId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'CURRENT ASSETS');

IF @CurrentAssetsId IS NOT NULL
BEGIN
  UPDATE dbo.AccountGroup
     SET ParentGroupId = @CurrentAssetsId
   WHERE Name = 'BANKS' AND Code = 'BNK';
  PRINT 'Reparented BANKS group under CURRENT ASSETS (AGId ' + CAST(@CurrentAssetsId AS VARCHAR) + ').';
END
ELSE
  PRINT 'WARNING: No "CURRENT ASSETS" group found — BANKS group left untouched. Investigate manually.';

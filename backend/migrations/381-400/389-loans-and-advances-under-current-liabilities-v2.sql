-- Redo of migration 383's intent, matched correctly this time. 383 hardcoded
-- `WHERE AGId = 79` (dev's id for the LOANS AND ADVANCES group) — production's
-- copy is AGId 1115, a completely different number, so 383 silently matched
-- zero rows there and already shows as "applied" in the migrations table
-- despite never having taken effect (confirmed live: LOANS AND ADVANCES on
-- production still has ParentGroupId = NULL). Since 383 won't run again,
-- this repeats the same update matched by Name/Code instead of a hardcoded
-- AGId — same lesson migration 387/388 already applied.

DECLARE @CurrentLiabilitiesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'CL' AND Name = 'CURRENT LIABILITIES');

IF @CurrentLiabilitiesId IS NOT NULL
BEGIN
  UPDATE dbo.AccountGroup
     SET ParentGroupId = @CurrentLiabilitiesId
   WHERE Code = 'LNA' AND Name = 'LOANS AND ADVANCES' AND ParentGroupId IS NULL;
  PRINT 'Reparented LOANS AND ADVANCES under CURRENT LIABILITIES (AGId ' + CAST(@CurrentLiabilitiesId AS VARCHAR) + ').';
END
ELSE
  PRINT 'WARNING: No "CURRENT LIABILITIES" group found — LOANS AND ADVANCES left untouched.';

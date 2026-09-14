-- A stray "NON CURRENT ASSET/ FIXED ASSET" group exists in dbo.AccountGroup
-- (production data only — not part of the seeded canonical set, which
-- already has proper NON-CURRENT ASSETS (AGId 13) and FIXED ASSETS (AGId 31)
-- groups). It renders in the Trial Balance tree right under CURRENT ASSETS.
-- Confirmed as an unused leftover — deleting it, but defensively: only if it
-- genuinely has no account heads posted under it and no child groups of its
-- own, so this can't silently drop real ledger data if it turns out to be
-- in use after all. Name matched loosely (wildcards between words) since the
-- exact spacing/slash in the stored value isn't known ahead of running this
-- against production.

DECLARE @GroupId INT = (
  SELECT TOP 1 AGId FROM dbo.AccountGroup
  WHERE UPPER(Name) LIKE '%NON%CURRENT%ASSET%FIXED%ASSET%'
);

IF @GroupId IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LBelongsTo = @GroupId)
     AND NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE ParentGroupId = @GroupId)
  BEGIN
    DELETE FROM dbo.AccountGroup WHERE AGId = @GroupId;
    PRINT 'Deleted empty "NON CURRENT ASSET/ FIXED ASSET" group (AGId ' + CAST(@GroupId AS VARCHAR) + ').';
  END
  ELSE
    PRINT 'WARNING: "NON CURRENT ASSET/ FIXED ASSET" group (AGId ' + CAST(@GroupId AS VARCHAR) + ') is not empty — left in place. Review manually.';
END
ELSE
  PRINT 'No "NON CURRENT ASSET/ FIXED ASSET" group found — nothing to do.';

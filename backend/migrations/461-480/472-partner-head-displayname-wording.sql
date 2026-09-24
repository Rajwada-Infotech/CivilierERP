-- Migration 472: reword the picker suffix on every already-existing
-- Partner's two AccountHeadMaster rows from the raw accounting terms
-- ("Capital Account" / "Current Account") to plain-language framing
-- ("for investment" / "for withdrawing") — per explicit instruction, the
-- GL heads themselves (LHeadName, groups, codes) are untouched, only the
-- DisplayName every picker across the app reads (ISNULL(DisplayName,
-- LHeadName)) changes. partnerMaster.js's own INSERT/UPDATE routes were
-- updated to use the new wording going forward; this backfills everyone
-- created before that change.
UPDATE dbo.AccountHeadMaster
SET DisplayName = LEFT(DisplayName, LEN(DisplayName) - LEN(' (Capital Account)')) + ' (for investment)'
WHERE LHeadType = 'P'
  AND DisplayName LIKE '% (Capital Account)';
GO

UPDATE dbo.AccountHeadMaster
SET DisplayName = LEFT(DisplayName, LEN(DisplayName) - LEN(' (Current Account)')) + ' (for withdrawing)'
WHERE LHeadType = 'P'
  AND DisplayName LIKE '% (Current Account)';
GO

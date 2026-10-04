-- Migration 476: reword the Partner head picker suffix again, from
-- "(for investment)" / "(for withdrawing)" (migration 472) to
-- "(For Capital)" / "(For Withdrawings)". Only DisplayName changes; GL heads,
-- groups and codes are untouched. partnerMaster.js uses the new wording for
-- new/renamed partners; this backfills every existing one.
UPDATE dbo.AccountHeadMaster
SET DisplayName = LEFT(DisplayName, LEN(DisplayName) - LEN(' (for investment)')) + ' (For Capital)'
WHERE LHeadType = 'P'
  AND DisplayName LIKE '% (for investment)';
GO

UPDATE dbo.AccountHeadMaster
SET DisplayName = LEFT(DisplayName, LEN(DisplayName) - LEN(' (for withdrawing)')) + ' (For Withdrawings)'
WHERE LHeadType = 'P'
  AND DisplayName LIKE '% (for withdrawing)';
GO

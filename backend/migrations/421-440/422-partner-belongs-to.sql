-- Migration 422: Partner Master — optional "Belongs To" reference
--
-- Lets one Partner (LHeadType='P') optionally reference another existing
-- Partner as a note-only relationship (e.g. "Misha Agarwal" tagged as
-- belonging to "Bikash Agarwal" — spouse/family, not an accounting
-- relationship, no GL effect). Stores the OTHER partner's base Partner
-- Code (e.g. "PTR-002"), not an LHeadId — a Partner's real identity in
-- this Master is its base code (see partnerMaster.js's stripSuffix), and
-- the Capital/Current head split is an implementation detail this field
-- shouldn't have to know about. Nullable — most partners won't set it.
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AccountHeadMaster' AND COLUMN_NAME = 'PartnerBelongsToCode'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD PartnerBelongsToCode NVARCHAR(20) NULL;
  PRINT 'Added AccountHeadMaster.PartnerBelongsToCode';
END
ELSE
  PRINT 'AccountHeadMaster.PartnerBelongsToCode already exists — skipped.';

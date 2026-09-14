-- Migration 182: Add ContactPartyId to dbo.Contract
-- Links the selected contact person back to their AccountHeadMaster record
-- so the party relationship is stored, not just the name string.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Contract')
    AND name = 'ContactPartyId'
)
BEGIN
  ALTER TABLE dbo.Contract
    ADD ContactPartyId INT NULL;
END

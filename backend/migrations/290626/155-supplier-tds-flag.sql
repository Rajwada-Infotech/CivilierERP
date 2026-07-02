-- Add TDS applicability flag to suppliers in AccountHeadMaster
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'AccountHeadMaster' AND COLUMN_NAME = 'IsTdsApplicable'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster
    ADD IsTdsApplicable BIT NOT NULL DEFAULT 0;
END

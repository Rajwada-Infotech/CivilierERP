-- Attendance register: store the actual labourer names alongside the
-- skilled/unskilled headcounts on dbo.DailyLabourEntry. Comma-separated
-- free text — these are day-labourers, not master-data entities worth a
-- separate table for.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DailyLabourEntry') AND name = 'SkilledLabourNames'
)
BEGIN
  ALTER TABLE dbo.DailyLabourEntry ADD SkilledLabourNames NVARCHAR(MAX) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DailyLabourEntry') AND name = 'UnskilledLabourNames'
)
BEGIN
  ALTER TABLE dbo.DailyLabourEntry ADD UnskilledLabourNames NVARCHAR(MAX) NULL;
END
GO

-- Add Floor to dbo.RoomMaster — free text ("Ground", "1", "Mezzanine", etc.)
-- since floor numbering schemes vary across projects.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'Floor'
)
BEGIN
  ALTER TABLE dbo.RoomMaster ADD Floor NVARCHAR(50) NULL;
END
GO

-- Migration 458: Incentive gains an auto-generated Document Number
-- (INC-00001 ...), unique per row, so an incentive can be referenced from
-- other screens by a stable number rather than its internal id.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.IncentiveRecord') AND name = 'DocumentNo')
  ALTER TABLE dbo.IncentiveRecord ADD DocumentNo NVARCHAR(30) NULL;
GO

-- Backfill any rows that pre-date this migration, oldest first.
;WITH numbered AS (
  SELECT IncentiveId,
         ROW_NUMBER() OVER (ORDER BY IncentiveId) AS rn
  FROM dbo.IncentiveRecord
  WHERE DocumentNo IS NULL
)
UPDATE ir
SET ir.DocumentNo = N'INC-' + RIGHT(N'00000' + CAST(
      numbered.rn + ISNULL((SELECT MAX(TRY_CAST(SUBSTRING(DocumentNo, 5, 10) AS INT))
                            FROM dbo.IncentiveRecord WHERE DocumentNo LIKE N'INC-%'), 0)
      AS NVARCHAR(10)), 5)
FROM dbo.IncentiveRecord ir
JOIN numbered ON numbered.IncentiveId = ir.IncentiveId;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.IncentiveRecord') AND name = 'DocumentNo' AND is_nullable = 1)
  ALTER TABLE dbo.IncentiveRecord ALTER COLUMN DocumentNo NVARCHAR(30) NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_IncentiveRecord_DocumentNo' AND object_id = OBJECT_ID('dbo.IncentiveRecord'))
  CREATE UNIQUE INDEX UQ_IncentiveRecord_DocumentNo ON dbo.IncentiveRecord(DocumentNo);
GO

PRINT '458-incentive-document-number applied successfully.';
GO

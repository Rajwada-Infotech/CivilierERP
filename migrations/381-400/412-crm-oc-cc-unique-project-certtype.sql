-- Migration 412: Enforce uniqueness of (ProjectId, CertType) in CrmOccupancyCertificate.
--
-- Without this constraint, staff could create multiple OC / CC rows for the
-- same project + certificate type. They appear as duplicate cards on the OC/CC
-- page and inflate the Total Projects counter.
--
-- Allows one OC, one CC, and one OC+CC row per project -- matching real world:
-- a project may hold an OC, a CC, or a combined OC+CC, not two of the same type.
--
-- If duplicates already exist, the migration prints a warning and skips.
-- Delete or merge the duplicates manually first, then re-run.

IF EXISTS (
  SELECT ProjectId, CertType, COUNT(*) AS Cnt
  FROM dbo.CrmOccupancyCertificate
  GROUP BY ProjectId, CertType
  HAVING COUNT(*) > 1
)
BEGIN
  PRINT 'WARNING: Duplicate (ProjectId, CertType) rows found in CrmOccupancyCertificate.';
  PRINT 'Delete or merge the duplicates manually, then re-run this migration.';
END
ELSE
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.CrmOccupancyCertificate')
      AND name = 'UQ_CrmOccupancyCertificate_ProjectId_CertType'
  )
  BEGIN
    ALTER TABLE dbo.CrmOccupancyCertificate
      ADD CONSTRAINT UQ_CrmOccupancyCertificate_ProjectId_CertType
      UNIQUE (ProjectId, CertType);
    PRINT 'Added UNIQUE constraint on (ProjectId, CertType).';
  END
  ELSE
  BEGIN
    PRINT 'UNIQUE constraint already exists -- no action needed.';
  END
END
GO

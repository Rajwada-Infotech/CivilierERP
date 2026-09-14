-- ============================================================
-- Migration 062: Seed Material Request doc type + fix ISS links_to
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. Remove broken NULL-EntryTypeId MR row left by previous run ─────────────
DELETE FROM dbo.TypeOfDoc
WHERE DocNoPrefix = 'MR'
  AND links_to = 'Material Request'
  AND EntryTypeId IS NULL;
GO

-- ── 2. Backfill existing rows that look like MR types but have no links_to ────
UPDATE dbo.TypeOfDoc
SET links_to   = 'Material Request',
    ModuleCode = 'MR'
WHERE IsActive = 1
  AND (links_to IS NULL OR links_to = '')
  AND (
        DocNoPrefix LIKE '%MR%'
     OR Prefix      LIKE '%MR%'
     OR Description LIKE '%Material Request%'
  );
GO

-- ── 3. Seed a default MR doc type if still none exists ────────────────────────
DECLARE @EntryTypeId UNIQUEIDENTIFIER = ISNULL(
    (SELECT TOP 1 E_Id FROM dbo.Entry_Type
     WHERE EntryType LIKE '%Material%' OR EntryType LIKE '%Purchase%'
     ORDER BY E_CreatedAt),
    (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt)
);

IF @EntryTypeId IS NULL
BEGIN
    RAISERROR('dbo.Entry_Type is empty — populate it before running this migration.', 16, 1);
    RETURN;
END

-- Clean up any partial insert from a previous failed run
DELETE FROM dbo.TypeOfDoc
WHERE DocNoPrefix = 'MR'
  AND links_to = 'Material Request'
  AND CreatedBy IS NULL;

IF NOT EXISTS (
    SELECT 1 FROM dbo.TypeOfDoc
    WHERE links_to LIKE '%Material Request%' AND IsActive = 1
)
BEGIN
    INSERT INTO dbo.TypeOfDoc
        (Prefix, DocNoPrefix, Description, links_to, ModuleCode,
         FinYearReset, IsActive, EntryTypeId, CreatedBy, CreatedAt)
    VALUES
        ('MR', 'MR', 'Material Request', 'Material Request', 'MR',
         1, 1, @EntryTypeId, 'SYSTEM', SYSDATETIME());

    PRINT 'Seeded default Material Request doc type (MR).';
END
ELSE
    PRINT 'Material Request doc type already exists — skipping seed.';
GO

-- ── 4. Backfill ISS rows that missed links_to from migration 046 ──────────────
UPDATE dbo.TypeOfDoc
SET links_to = 'Material Issue'
WHERE DocNoPrefix = 'ISS'
  AND (links_to IS NULL OR links_to = '')
  AND IsActive = 1;
GO

-- ── 5. Seed a default ISS doc type if none exists ─────────────────────────────
DECLARE @EntryTypeId2 UNIQUEIDENTIFIER = (
    SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt
);

IF NOT EXISTS (
    SELECT 1 FROM dbo.TypeOfDoc
    WHERE links_to LIKE '%Material Issue%' AND IsActive = 1
)
BEGIN
    INSERT INTO dbo.TypeOfDoc
        (Prefix, DocNoPrefix, Description, links_to, ModuleCode,
         FinYearReset, IsActive, EntryTypeId, CreatedBy, CreatedAt)
    VALUES
        ('ISS', 'ISS', 'Material Issue', 'Material Issue', 'MIS',
         1, 1, @EntryTypeId2, 'SYSTEM', SYSDATETIME());

    PRINT 'Seeded default Material Issue doc type (ISS).';
END
ELSE
    PRINT 'Material Issue doc type already exists — skipping seed.';
GO

PRINT '062-seed-mr-and-fix-iss-modulecode applied successfully.';
GO

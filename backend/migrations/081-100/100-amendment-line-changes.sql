-- ============================================================
-- Migration 100: AmendmentLineChanges
-- Per-field change log tied to each Amendment record.
-- Supports the full audit trail required by the Amendment
-- workflow (old value → new value for every changed field).
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AmendmentLineChanges'
)
BEGIN
  CREATE TABLE dbo.AmendmentLineChanges (
    Id            INT           IDENTITY(1,1) PRIMARY KEY,
    AmendmentId   INT           NOT NULL,
    FieldName     NVARCHAR(200) NOT NULL,
    FieldLabel    NVARCHAR(200) NULL,
    OldValue      NVARCHAR(MAX) NULL,
    NewValue      NVARCHAR(MAX) NULL,
    ChangedBy     NVARCHAR(200) NULL,
    ChangedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_AmendmentLineChanges_Amendments
      FOREIGN KEY (AmendmentId) REFERENCES dbo.Amendments(Id)
  );

  CREATE INDEX IX_AmendmentLineChanges_AmendmentId
    ON dbo.AmendmentLineChanges (AmendmentId);
END;

-- Add AmendedStatus column to Amendments if not present
-- (tracks whether the parent doc has been updated)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'Amendments'
    AND COLUMN_NAME  = 'PropagatedAt'
)
BEGIN
  ALTER TABLE dbo.Amendments
    ADD PropagatedAt DATETIME2 NULL,
        PropagatedBy NVARCHAR(200) NULL;
END;

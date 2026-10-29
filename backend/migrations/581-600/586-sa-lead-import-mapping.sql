-- 586-sa-lead-import-mapping.sql
-- Bulk lead import remembers how a file's columns were matched to lead fields, and the
-- source chosen, keyed by the file's set of column headings — so the next export from the
-- same place (Meta, a portal, a team sheet) maps itself.
-- Idempotent: guarded.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadImportMapping' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadImportMapping (
    Id          INT           IDENTITY(1,1) PRIMARY KEY,
    HeadingsKey CHAR(64)      NOT NULL CONSTRAINT UQ_SaLeadImportMapping_Key UNIQUE, -- SHA-256 of the sorted headings
    MappingJson NVARCHAR(MAX) NOT NULL,  -- { "<heading>": "<lead field>" }
    SourceJson  NVARCHAR(MAX) NULL,      -- the source picked last time
    UsedCount   INT           NOT NULL CONSTRAINT DF_SaLeadImportMapping_Used DEFAULT (0),
    UpdatedBy   INT           NULL,
    UpdatedAt   DATETIME2(3)  NOT NULL CONSTRAINT DF_SaLeadImportMapping_UpdatedAt DEFAULT (SYSDATETIME())
  );
END
GO

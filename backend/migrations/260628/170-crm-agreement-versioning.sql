-- ============================================================
-- Migration 170: Agreement versioning (spec Stage 6 — "version management
-- should be maintained... nothing should be overwritten").
--
-- Two things were previously silently overwritten in place:
--  1. CrmAgreement's own legal fields (LegalName/LegalAddress/PanNo/
--     AadhaarNo/AgreementDate) — every edit (e.g. after a customer recheck
--     request) replaced them with no trace of what was there before.
--  2. CrmAgreementDocument rows had no version number, so a "corrected"
--     re-upload for the same DocumentType had no way to be distinguished
--     from an accidental duplicate, and the old PUT allowed overwriting
--     DocumentUrl directly in place (removed in code — see crmAgreements.js).
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'VersionNo')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD VersionNo INT NOT NULL DEFAULT 1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmAgreementRevision' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmAgreementRevision (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    AgreementId   INT           NOT NULL REFERENCES dbo.CrmAgreement(Id),
    VersionNo     INT           NOT NULL, -- the version being superseded
    AgreementDate DATE          NULL,
    LegalName     NVARCHAR(300) NULL,
    LegalAddress  NVARCHAR(MAX) NULL,
    PanNo         NVARCHAR(20)  NULL,
    AadhaarNo     NVARCHAR(20)  NULL,
    Notes         NVARCHAR(MAX) NULL,
    Reason        NVARCHAR(200) NULL, -- e.g. "Customer requested recheck", "Staff correction"
    CreatedBy     INT           NULL,
    CreatedAt     DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmAgreementRevision_Agreement ON dbo.CrmAgreementRevision(AgreementId);
  PRINT 'Created dbo.CrmAgreementRevision';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'VersionNo')
BEGIN
  ALTER TABLE dbo.CrmAgreementDocument ADD VersionNo INT NOT NULL DEFAULT 1;
END
GO

PRINT 'Migration 170 complete — CRM Agreement versioning';

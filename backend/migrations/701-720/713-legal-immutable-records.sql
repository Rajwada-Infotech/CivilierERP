-- Legal: records that must never change once written, enforced in the database itself (not only in the app):
--   frozen versions (LegalLandRegisterSnapshot), the audit trail (LegalRecordAudit), approval decisions
--   (LegalLandDecision) and per-field verification records (LegalLandFieldCheck) — UPDATE and DELETE are refused.
--   Two exceptions: a version still a placeholder ({"rebuild":true…}) is completed once by the app; and a deliberate
--   data reset by an administrator sets SESSION_CONTEXT 'legal_reset' = 1 for its own connection.
-- Also: a "due soon" reminder date for the Deed Registry Search timelines.
IF COL_LENGTH('dbo.LegalEnquiryOfficeSearch', 'DueSoonAlertOn') IS NULL ALTER TABLE dbo.LegalEnquiryOfficeSearch ADD DueSoonAlertOn DATE NULL;
GO
CREATE OR ALTER TRIGGER dbo.TR_LegalLandRegisterSnapshot_Immutable ON dbo.LegalLandRegisterSnapshot AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF CAST(SESSION_CONTEXT(N'legal_reset') AS INT) = 1 RETURN;
  IF EXISTS (SELECT 1 FROM deleted d WHERE d.Remarks LIKE N'Version %' AND d.SnapshotJson NOT LIKE N'{"rebuild":true%')
  BEGIN
    RAISERROR(N'A frozen land version cannot be changed or deleted.', 16, 1);
    ROLLBACK TRANSACTION;
  END
END
GO
CREATE OR ALTER TRIGGER dbo.TR_LegalRecordAudit_Immutable ON dbo.LegalRecordAudit AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF CAST(SESSION_CONTEXT(N'legal_reset') AS INT) = 1 RETURN;
  RAISERROR(N'The Legal audit trail cannot be changed or deleted.', 16, 1);
  ROLLBACK TRANSACTION;
END
GO
IF OBJECT_ID('dbo.LegalLandDecision', 'U') IS NOT NULL
  EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_LegalLandDecision_Immutable ON dbo.LegalLandDecision AFTER UPDATE, DELETE AS
  BEGIN
    SET NOCOUNT ON;
    IF CAST(SESSION_CONTEXT(N''legal_reset'') AS INT) = 1 RETURN;
    RAISERROR(N''Approval decisions cannot be changed or deleted.'', 16, 1);
    ROLLBACK TRANSACTION;
  END');
GO
IF OBJECT_ID('dbo.LegalLandFieldCheck', 'U') IS NOT NULL
  EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_LegalLandFieldCheck_Immutable ON dbo.LegalLandFieldCheck AFTER UPDATE, DELETE AS
  BEGIN
    SET NOCOUNT ON;
    IF CAST(SESSION_CONTEXT(N''legal_reset'') AS INT) = 1 RETURN;
    RAISERROR(N''Field verification records cannot be changed or deleted.'', 16, 1);
    ROLLBACK TRANSACTION;
  END');
GO

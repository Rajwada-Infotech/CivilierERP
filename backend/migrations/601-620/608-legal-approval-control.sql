-- 608 · Legal Approval Control.
-- The super admin names who may verify records and documents, and who approves deeds at L1 and at L2.
-- The approval setup pages (Approval Control, Approval Workflow, Reminder & SLA) can only be changed by an
-- administrator, so other users are offered view / export on them in Menu Rights.
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.LegalApprovalAuthority', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalApprovalAuthority (
    AuthorityId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalApprovalAuthority PRIMARY KEY,
    Stage NVARCHAR(20) NOT NULL CONSTRAINT CK_LegalApprovalAuthority_Stage CHECK (Stage IN (N'Verifier', N'L1 Approver', N'L2 Approver')),
    ApproverId INT NOT NULL CONSTRAINT FK_LegalApprovalAuthority_User REFERENCES dbo.users(id),
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalApprovalAuthority_IsActive DEFAULT 1,
    CreatedBy INT NULL CONSTRAINT FK_LegalApprovalAuthority_CreatedBy REFERENCES dbo.users(id),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalApprovalAuthority_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL CONSTRAINT FK_LegalApprovalAuthority_UpdatedBy REFERENCES dbo.users(id),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalApprovalAuthority UNIQUE (Stage, ApproverId)
  );
END
GO

-- ── Menu rights ───────────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-approval-authority-master')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'legal-approval-authority-master', N'Approval Control', N'Legal', N'Legal Masters - Workflow', N'view,export', 115, 1, N'migration-608', SYSDATETIME());
GO

-- Only an administrator changes the approval setup; everyone else can at most see it.
UPDATE dbo.PageDefinitions SET Actions = N'view,export', UpdatedAt = SYSDATETIME()
WHERE PageKey IN (N'legal-approval-authority-master', N'legal-approval-workflow-master', N'legal-reminder-sla-master');
GO

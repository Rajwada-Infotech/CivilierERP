-- 698: Amendments to a registered land. Schema only; safe to re-run.
--  Once a land is Registered its details are locked; a change is asked for as an amendment (which fields, old → new,
--  why), approved or rejected with a remark by an "Amendment Approver" (Setup → Approval Control). An approved
--  amendment is applied to the land and saved as a new "after registration" version (Legal Flow Chart).
IF OBJECT_ID('dbo.LegalLandAmendment', 'U') IS NULL
CREATE TABLE dbo.LegalLandAmendment (
  AmendmentId     INT IDENTITY(1,1) CONSTRAINT PK_LegalLandAmendment PRIMARY KEY,
  LandId          INT NOT NULL CONSTRAINT FK_LegalLandAmendment_Land REFERENCES dbo.LegalLand (LandId),
  AmendmentNo     INT NOT NULL,
  AmendType       NVARCHAR(60) NOT NULL,
  Reason          NVARCHAR(1000) NOT NULL,
  ChangesJson     NVARCHAR(MAX) NOT NULL,            -- [{ field, label, from, to }]
  ReferenceNo     NVARCHAR(150) NULL,                -- order / deed / report number behind the change
  Status          NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalLandAmendment_Status DEFAULT N'Pending',
  RequestedBy     INT NULL,
  RequestedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_LegalLandAmendment_RequestedAt DEFAULT SYSUTCDATETIME(),
  DecidedBy       INT NULL,
  DecidedAt       DATETIME2(0) NULL,
  DecisionRemarks NVARCHAR(1000) NULL,
  VersionNo       INT NULL,                          -- the land version it became
  CONSTRAINT CK_LegalLandAmendment_Status CHECK (Status IN (N'Pending', N'Approved', N'Rejected', N'Withdrawn')),
  CONSTRAINT UQ_LegalLandAmendment_No UNIQUE (LandId, AmendmentNo)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandAmendment_Status')
  CREATE INDEX IX_LegalLandAmendment_Status ON dbo.LegalLandAmendment (Status, RequestedAt);
GO
-- Approval Control: add the "Amendment Approver" role.
IF OBJECT_ID('dbo.LegalApprovalAuthority', 'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage' AND definition NOT LIKE N'%Amendment Approver%')
    ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage')
    ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage
      CHECK (Stage IN (N'Verifier', N'L1 Approver', N'L2 Approver', N'Legal Reviewer', N'Amendment Approver'));
END
GO

-- 649: Legal due diligence before Final Verification (Phase 1). Schema only; safe to re-run.
--  • Ownership & seller details on the land (type, source, seller ID / authority, all owners' consent).
--  • One due-diligence status per area (Ownership & Seller, Inheritance, Title, Documents), set by a Verifier.
--  • Risk assessments (history) and legal reviews (history). Inheritance gets "dispute pending" and a family tree copy.
--  • New approval role "Legal Reviewer" (Setup → Approval Control) — only it gives final legal clearance.
IF COL_LENGTH('dbo.LegalLand', 'OwnershipType') IS NULL ALTER TABLE dbo.LegalLand ADD OwnershipType NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.LegalLand', 'OwnershipSource') IS NULL ALTER TABLE dbo.LegalLand ADD OwnershipSource NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.LegalLand', 'SellerIdStatus') IS NULL ALTER TABLE dbo.LegalLand ADD SellerIdStatus NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.LegalLand', 'SellerAuthority') IS NULL ALTER TABLE dbo.LegalLand ADD SellerAuthority NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.LegalLand', 'OwnersConsent') IS NULL ALTER TABLE dbo.LegalLand ADD OwnersConsent NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.LegalLand', 'SellerContact') IS NULL ALTER TABLE dbo.LegalLand ADD SellerContact NVARCHAR(200) NULL;
GO
IF OBJECT_ID('dbo.LegalDiligenceArea', 'U') IS NULL
CREATE TABLE dbo.LegalDiligenceArea (
  LandId    INT NOT NULL CONSTRAINT FK_LegalDiligenceArea_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  Area      NVARCHAR(30) NOT NULL,
  Status    NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalDiligenceArea_Status DEFAULT N'Pending',
  Remarks   NVARCHAR(1000) NULL,
  CheckedBy INT NULL,
  CheckedAt DATETIME2 NULL,
  CONSTRAINT PK_LegalDiligenceArea PRIMARY KEY (LandId, Area)
);
GO
IF OBJECT_ID('dbo.LegalRiskAssessment', 'U') IS NULL
CREATE TABLE dbo.LegalRiskAssessment (
  RiskId     INT IDENTITY(1,1) PRIMARY KEY,
  LandId     INT NOT NULL CONSTRAINT FK_LegalRiskAssessment_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  RiskLevel  NVARCHAR(20) NOT NULL,
  AutoFlags  NVARCHAR(2000) NULL,
  Remarks    NVARCHAR(2000) NOT NULL,
  FileId     INT NULL,
  AssessedBy INT NULL,
  AssessedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRiskAssessment_At DEFAULT SYSUTCDATETIME()
);
GO
IF OBJECT_ID('dbo.LegalReview', 'U') IS NULL
CREATE TABLE dbo.LegalReview (
  ReviewId        INT IDENTITY(1,1) PRIMARY KEY,
  LandId          INT NOT NULL CONSTRAINT FK_LegalReview_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  Status          NVARCHAR(40) NOT NULL,
  AdvocateId      INT NULL,
  ReviewerUserId  INT NULL,
  AssignedOn      DATE NULL,
  CompletedOn     DATE NULL,
  Opinion         NVARCHAR(4000) NULL,
  Observations    NVARCHAR(2000) NULL,
  AdditionalDocs  NVARCHAR(1000) NULL,
  Recommendation  NVARCHAR(1000) NULL,
  FileId          INT NULL,
  CreatedBy       INT NULL,
  CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_LegalReview_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalRiskAssessment_Land') CREATE INDEX IX_LegalRiskAssessment_Land ON dbo.LegalRiskAssessment (LandId, AssessedAt DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalReview_Land') CREATE INDEX IX_LegalReview_Land ON dbo.LegalReview (LandId, CreatedAt DESC);
GO
IF COL_LENGTH('dbo.LegalInheritance', 'DisputePending') IS NULL ALTER TABLE dbo.LegalInheritance ADD DisputePending NVARCHAR(10) NULL;
IF COL_LENGTH('dbo.LegalInheritance', 'FamilyTreeFileId') IS NULL ALTER TABLE dbo.LegalInheritance ADD FamilyTreeFileId INT NULL;
GO
-- Approval Control: add the "Legal Reviewer" role.
IF OBJECT_ID('dbo.LegalApprovalAuthority', 'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage')
    ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
  ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage
    CHECK (Stage IN (N'Verifier', N'L1 Approver', N'L2 Approver', N'Legal Reviewer'));
END

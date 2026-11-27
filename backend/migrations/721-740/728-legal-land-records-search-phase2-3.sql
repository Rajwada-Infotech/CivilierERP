-- Land Records Search, phases 2 and 3 (each enquiry; frozen once converted):
--   LegalLandDiscrepancy   — differences between records to investigate (type, severity, status, assignee, resolution).
--   LegalLandAltHistory    — alternative land history / other claims: government land, other acquisition, tenancy,
--                            disputed / possession claims (subcategories in a Setup list; "Other…" adds to it).
--   LegalLandPossession    — who actually occupies the land (separate from recorded ownership).
--   LegalLandSearchReview  — legal review and risk assessment, one row per review (the latest counts).
--   LegalEnquirySearchSnapshot — the whole search frozen (JSON + SHA-256) when the enquiry becomes a land.
-- None of these establish ownership by themselves.

IF OBJECT_ID('dbo.LegalLandDiscrepancy', 'U') IS NULL
  CREATE TABLE dbo.LegalLandDiscrepancy (
    DiscrepancyId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandDiscrepancy PRIMARY KEY,
    EnquiryId INT NOT NULL CONSTRAINT FK_LegalLandDiscrepancy_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    DiscrepancyType NVARCHAR(60) NOT NULL, RelatedRecord NVARCHAR(200) NULL,
    PreviousInfo NVARCHAR(500) NULL, CurrentInfo NVARCHAR(500) NULL, Description NVARCHAR(2000) NULL, EvidenceFileId INT NULL,
    Severity NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalLandDiscrepancy_Sev DEFAULT N'Medium',
    InvestigationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandDiscrepancy_St DEFAULT N'Open',
    AssignedUserId INT NULL, ResolutionRemarks NVARCHAR(2000) NULL, SourceMapId INT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandDiscrepancy_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandDiscrepancy_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalLandDiscrepancy_Sev CHECK (Severity IN (N'Low', N'Medium', N'High', N'Critical')),
    CONSTRAINT CK_LegalLandDiscrepancy_St CHECK (InvestigationStatus IN (N'Open', N'Under Investigation', N'Resolved', N'Unresolved', N'Referred to Legal Team')));
GO
IF OBJECT_ID('dbo.LegalLandAltHistory', 'U') IS NULL
  CREATE TABLE dbo.LegalLandAltHistory (
    AltId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandAltHistory PRIMARY KEY,
    EnquiryId INT NOT NULL CONSTRAINT FK_LegalLandAltHistory_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    Category NVARCHAR(60) NOT NULL, SubcategoryId INT NULL, ReferenceNo NVARCHAR(100) NULL, IssuingAuthority NVARCHAR(200) NULL,
    HolderClaimant NVARCHAR(200) NULL, RelevantDate DATE NULL, ValidFrom DATE NULL, ValidTo DATE NULL, PermittedUse NVARCHAR(200) NULL, Conditions NVARCHAR(1000) NULL,
    Area DECIMAL(18,4) NULL, AreaUnitId INT NULL, DagKhatianRef NVARCHAR(200) NULL, DocFileId INT NULL, Source NVARCHAR(200) NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandAltHistory_St DEFAULT N'Pending', Remarks NVARCHAR(2000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandAltHistory_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandAltHistory_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL);
GO
IF OBJECT_ID('dbo.LegalLandPossession', 'U') IS NULL
  CREATE TABLE dbo.LegalLandPossession (
    PossessionId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandPossession PRIMARY KEY,
    EnquiryId INT NOT NULL CONSTRAINT FK_LegalLandPossession_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    OccupantName NVARCHAR(200) NOT NULL, StartDate DATE NULL, EndDate DATE NULL, PossessionType NVARCHAR(40) NOT NULL, Purpose NVARCHAR(200) NULL,
    DagKhatianRef NVARCHAR(200) NULL, AreaOccupied DECIMAL(18,4) NULL, AreaUnitId INT NULL, DocFileId INT NULL, Source NVARCHAR(200) NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandPossession_St DEFAULT N'Pending', Remarks NVARCHAR(2000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandPossession_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandPossession_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalLandPossession_Dates CHECK (EndDate IS NULL OR StartDate IS NULL OR EndDate >= StartDate));
GO
IF OBJECT_ID('dbo.LegalLandSearchReview', 'U') IS NULL
  CREATE TABLE dbo.LegalLandSearchReview (
    ReviewId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandSearchReview PRIMARY KEY,
    EnquiryId INT NOT NULL CONSTRAINT FK_LegalLandSearchReview_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    OverallSearchStatus NVARCHAR(30) NULL, OwnershipChainStatus NVARCHAR(30) NULL, RecordMatchingStatus NVARCHAR(30) NULL,
    RegistryDeedStatus NVARCHAR(30) NULL, PossessionStatus NVARCHAR(30) NULL, DiscrepancyStatus NVARCHAR(30) NULL,
    RiskLevel NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandSearchReview_Risk DEFAULT N'Pending Assessment',
    Recommendation NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalLandSearchReview_Rec DEFAULT N'Pending Legal Review',
    Remarks NVARCHAR(4000) NOT NULL, Conditions NVARCHAR(2000) NULL, EvidenceFileId INT NULL,
    ReviewedBy INT NULL, ReviewDate DATE NOT NULL CONSTRAINT DF_LegalLandSearchReview_Date DEFAULT CAST(GETDATE() AS DATE),
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandSearchReview_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandSearchReview_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalLandSearchReview_Risk CHECK (RiskLevel IN (N'Low', N'Medium', N'High', N'Critical', N'Pending Assessment')),
    CONSTRAINT CK_LegalLandSearchReview_Rec CHECK (Recommendation IN (N'Recommended to Proceed', N'Proceed with Conditions', N'Hold for Further Investigation', N'Not Recommended', N'Pending Legal Review')));
GO
IF OBJECT_ID('dbo.LegalEnquirySearchSnapshot', 'U') IS NULL
  CREATE TABLE dbo.LegalEnquirySearchSnapshot (
    SnapshotId INT IDENTITY(1,1) CONSTRAINT PK_LegalEnquirySearchSnapshot PRIMARY KEY,
    EnquiryId INT NOT NULL, LandId INT NULL, SnapshotJson NVARCHAR(MAX) NOT NULL, SnapshotHash CHAR(64) NOT NULL,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalEnquirySearchSnapshot_At DEFAULT SYSUTCDATETIME());
GO
-- Subcategories of alternative land history (Setup list; a value typed with Other… is added here).
INSERT INTO dbo.LegalLookupValue (Category, Name, SortOrder, IsActive)
SELECT N'alt-land-subcategory', v.n, v.s, 1
FROM (VALUES (N'Khas Land', 1), (N'Vested Land', 2), (N'Government Patta', 3), (N'Government Lease', 4), (N'Government Settlement', 5), (N'Departmental Allotment', 6),
             (N'Gift', 11), (N'Inheritance Reference', 12), (N'Family Partition', 13), (N'Exchange', 14), (N'Court Order', 15), (N'Historical Allotment', 16),
             (N'Agricultural Lease', 21), (N'Non-Agricultural Lease', 22), (N'Bargadar / Sharecropper', 23), (N'Tenant', 24), (N'Licensee', 25), (N'Sub-Lease', 26),
             (N'Unauthorized Occupation', 31), (N'Forcible Possession / Encroachment', 32), (N'Boundary Dispute', 33), (N'Adverse Possession Claim', 34), (N'Other Disputed Claim', 35)) v(n, s)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLookupValue x WHERE x.Category = N'alt-land-subcategory' AND x.Name = v.n);
GO
-- Setup page right for the subcategory list (same group as the other Land records lists).
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT N'legal-alt-land-subcategory-master', N'Alternative History Subcategory Master', N'Legal', N'Legal Masters - Land records', N'view,create,edit,delete,print,export', 217, 1, N'migration-728', SYSDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-alt-land-subcategory-master');
GO

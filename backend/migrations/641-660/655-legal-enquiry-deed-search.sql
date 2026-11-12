-- 655: Project-first enquiries and the enquiry Deed Registry Search.
--   • A land enquiry belongs to a project (picked first on Land Enquiries) and carries its RS / LR Dag and Khatian numbers,
--     so the search can find it by any of them.
--   • Deed Registry Search: per enquiry land, a search is requested at one registration office for one calendar year
--     (1956 → this year). Each office type has its own time limit (ADSR 7 days, DSR 7, RA Calcutta 10, BLRO 1);
--     past it, the request shows on the dashboard and its people are notified. What is found is stored on the enquiry.
-- Schema + reference list only.
IF COL_LENGTH('dbo.LegalLandEnquiry', 'ProjectId') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD ProjectId INT NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'RsDagNo') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD RsDagNo NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'LrDagNo') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD LrDagNo NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'RsKhatianNo') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD RsKhatianNo NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'LrKhatianNo') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD LrKhatianNo NVARCHAR(30) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandEnquiry_Project')
  CREATE INDEX IX_LegalLandEnquiry_Project ON dbo.LegalLandEnquiry (ProjectId, EnquiryDate DESC);
GO

-- Time limit per registration office type (days to finish a search).
IF OBJECT_ID('dbo.LegalRegistryOfficeSla', 'U') IS NULL
CREATE TABLE dbo.LegalRegistryOfficeSla (
  OfficeType NVARCHAR(60) NOT NULL CONSTRAINT PK_LegalRegistryOfficeSla PRIMARY KEY,
  Days       INT NOT NULL CONSTRAINT CK_LegalRegistryOfficeSla_Days CHECK (Days BETWEEN 1 AND 365),
  SortOrder  INT NOT NULL CONSTRAINT DF_LegalRegistryOfficeSla_Sort DEFAULT 0
);
GO
MERGE dbo.LegalRegistryOfficeSla AS t
USING (VALUES (N'ADSR', 7, 1), (N'DSR', 7, 2), (N'RA Calcutta', 10, 3), (N'BLRO', 1, 4)) AS s (OfficeType, Days, SortOrder)
ON t.OfficeType = s.OfficeType
WHEN NOT MATCHED THEN INSERT (OfficeType, Days, SortOrder) VALUES (s.OfficeType, s.Days, s.SortOrder);
GO

IF OBJECT_ID('dbo.LegalEnquiryDeedSearch', 'U') IS NULL
CREATE TABLE dbo.LegalEnquiryDeedSearch (
  SearchId      INT IDENTITY(1,1) CONSTRAINT PK_LegalEnquiryDeedSearch PRIMARY KEY,
  EnquiryId     INT NOT NULL CONSTRAINT FK_LegalEnquiryDeedSearch_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId) ON DELETE CASCADE,
  OfficeType    NVARCHAR(60) NOT NULL,
  OfficeId      INT NULL CONSTRAINT FK_LegalEnquiryDeedSearch_Office REFERENCES dbo.LegalRegistrationOffice (OfficeId),
  CalendarYear  INT NOT NULL CONSTRAINT CK_LegalEnquiryDeedSearch_Year CHECK (CalendarYear BETWEEN 1956 AND 2200),
  Status        NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalEnquiryDeedSearch_Status DEFAULT N'Requested'
                CONSTRAINT CK_LegalEnquiryDeedSearch_Status CHECK (Status IN (N'Requested', N'Found', N'Not Found')),
  SlaDays       INT NOT NULL,
  DueDate       DATE NOT NULL,
  DeedNo        NVARCHAR(100) NULL,
  DeedDate      DATE NULL,
  Parties       NVARCHAR(500) NULL,
  Details       NVARCHAR(2000) NULL,
  SiteName      NVARCHAR(200) NULL,
  RequestedBy   INT NULL,
  RequestedAt   DATETIME2 NOT NULL CONSTRAINT DF_LegalEnquiryDeedSearch_At DEFAULT SYSUTCDATETIME(),
  CompletedBy   INT NULL,
  CompletedAt   DATETIME2 NULL,
  OverdueAlertOn DATE NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalEnquiryDeedSearch_Enquiry')
  CREATE INDEX IX_LegalEnquiryDeedSearch_Enquiry ON dbo.LegalEnquiryDeedSearch (EnquiryId, CalendarYear DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalEnquiryDeedSearch_Due')
  CREATE INDEX IX_LegalEnquiryDeedSearch_Due ON dbo.LegalEnquiryDeedSearch (Status, DueDate);
GO

-- 637: Registry search records — before applying for deed registration, a user looks the land up (Land ID or enquiry
-- number), picks the registration office and financial year, checks the RS / LR references on the government site and
-- records what was found against the land. Schema only.
IF OBJECT_ID('dbo.LegalRegistrySearch', 'U') IS NULL
CREATE TABLE dbo.LegalRegistrySearch (
  SearchId     INT IDENTITY(1,1) PRIMARY KEY,
  LandId       INT NOT NULL CONSTRAINT FK_LegalRegistrySearch_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  OfficeId     INT NULL,
  FinYear      NVARCHAR(20) NULL,
  RsDagNo      NVARCHAR(30) NULL,
  RsKhatianNo  NVARCHAR(30) NULL,
  LrDagNo      NVARCHAR(30) NULL,
  LrKhatianNo  NVARCHAR(30) NULL,
  SiteName     NVARCHAR(200) NULL,
  Result       NVARCHAR(40) NOT NULL,
  DeedNoFound  NVARCHAR(100) NULL,
  Details      NVARCHAR(2000) NULL,
  FileId       INT NULL,
  CreatedBy    INT NULL,
  CreatedAt    DATETIME2 NOT NULL CONSTRAINT DF_LegalRegistrySearch_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalRegistrySearch_Land')
  CREATE INDEX IX_LegalRegistrySearch_Land ON dbo.LegalRegistrySearch (LandId, CreatedAt DESC);

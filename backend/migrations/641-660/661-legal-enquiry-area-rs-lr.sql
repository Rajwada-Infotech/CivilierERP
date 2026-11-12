-- 661: Land enquiry — Total area and Deed area, and RS / LR records of their own (an enquiry can cover several Dags).
-- The enquiry's RS / LR Dag and Khatian columns become a summary kept from these records (used by search and lists),
-- widened to hold several numbers. Land Conversion copies the records to the land. Existing single numbers become
-- one RS and one LR record each (derived from the enquiry, not sample data).
IF COL_LENGTH('dbo.LegalLandEnquiry', 'DeedArea') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD DeedArea DECIMAL(18,6) NULL;
GO
ALTER TABLE dbo.LegalLandEnquiry ALTER COLUMN RsDagNo NVARCHAR(400) NULL;
ALTER TABLE dbo.LegalLandEnquiry ALTER COLUMN LrDagNo NVARCHAR(400) NULL;
ALTER TABLE dbo.LegalLandEnquiry ALTER COLUMN RsKhatianNo NVARCHAR(400) NULL;
ALTER TABLE dbo.LegalLandEnquiry ALTER COLUMN LrKhatianNo NVARCHAR(400) NULL;
GO
IF OBJECT_ID('dbo.LegalEnquiryRsRecord', 'U') IS NULL
CREATE TABLE dbo.LegalEnquiryRsRecord (
  RsRecordId     INT IDENTITY(1,1) CONSTRAINT PK_LegalEnquiryRsRecord PRIMARY KEY,
  EnquiryId      INT NOT NULL CONSTRAINT FK_LegalEnquiryRsRecord_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId) ON DELETE CASCADE,
  MouzaId        INT NULL CONSTRAINT FK_LegalEnquiryRsRecord_Mouza REFERENCES dbo.LegalMouza (MouzaId),
  RsKhatianNo    NVARCHAR(30) NOT NULL,
  RsDagNo        NVARCHAR(30) NOT NULL,
  RecordedHolder NVARCHAR(200) NULL,
  Area           DECIMAL(18,6) NULL,
  AreaUnitId     INT NULL,
  Share          NVARCHAR(30) NULL,
  Remarks        NVARCHAR(1000) NULL,
  IsActive       BIT NOT NULL CONSTRAINT DF_LegalEnquiryRsRecord_Active DEFAULT 1,
  CreatedBy      INT NULL,
  CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalEnquiryRsRecord_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy      INT NULL,
  UpdatedAt      DATETIME2 NULL
);
IF OBJECT_ID('dbo.LegalEnquiryLrRecord', 'U') IS NULL
CREATE TABLE dbo.LegalEnquiryLrRecord (
  LrRecordId     INT IDENTITY(1,1) CONSTRAINT PK_LegalEnquiryLrRecord PRIMARY KEY,
  EnquiryId      INT NOT NULL CONSTRAINT FK_LegalEnquiryLrRecord_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId) ON DELETE CASCADE,
  MouzaId        INT NULL CONSTRAINT FK_LegalEnquiryLrRecord_Mouza REFERENCES dbo.LegalMouza (MouzaId),
  LrKhatianNo    NVARCHAR(30) NOT NULL,
  LrDagNo        NVARCHAR(30) NOT NULL,
  MatchingRsRecordId INT NULL,
  RecordedHolder NVARCHAR(200) NULL,
  Area           DECIMAL(18,6) NULL,
  AreaUnitId     INT NULL,
  Share          NVARCHAR(30) NULL,
  Remarks        NVARCHAR(1000) NULL,
  IsActive       BIT NOT NULL CONSTRAINT DF_LegalEnquiryLrRecord_Active DEFAULT 1,
  CreatedBy      INT NULL,
  CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalEnquiryLrRecord_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy      INT NULL,
  UpdatedAt      DATETIME2 NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalEnquiryRsRecord_Enq') CREATE INDEX IX_LegalEnquiryRsRecord_Enq ON dbo.LegalEnquiryRsRecord (EnquiryId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalEnquiryLrRecord_Enq') CREATE INDEX IX_LegalEnquiryLrRecord_Enq ON dbo.LegalEnquiryLrRecord (EnquiryId);
GO
INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, Area, AreaUnitId, CreatedBy)
SELECT e.EnquiryId, e.MouzaId, ISNULL(e.RsKhatianNo, N'—'), e.RsDagNo, e.ApproxArea, e.AreaUnitId, e.CreatedBy FROM dbo.LegalLandEnquiry e
WHERE e.RsDagNo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryRsRecord x WHERE x.EnquiryId = e.EnquiryId);
INSERT INTO dbo.LegalEnquiryLrRecord (EnquiryId, MouzaId, LrKhatianNo, LrDagNo, Area, AreaUnitId, CreatedBy)
SELECT e.EnquiryId, e.MouzaId, ISNULL(e.LrKhatianNo, N'—'), e.LrDagNo, e.ApproxArea, e.AreaUnitId, e.CreatedBy FROM dbo.LegalLandEnquiry e
WHERE e.LrDagNo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryLrRecord x WHERE x.EnquiryId = e.EnquiryId);
GO

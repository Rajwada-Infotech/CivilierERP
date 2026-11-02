-- 603 · Legal module finishing touches
--   LegalLandPhoto: several photographs per land property (the document's "Land Photos — multiple image upload").
--   Workflow status of every land recalculated from its step states (sample data had set the steps directly).
-- Additive only.
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.LegalLandPhoto', 'U') IS NULL
  CREATE TABLE dbo.LegalLandPhoto (
    PhotoId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandPhoto PRIMARY KEY,
    LandId INT NOT NULL,
    Caption NVARCHAR(200) NOT NULL,
    PhotoFileId INT NOT NULL,
    TakenOn DATE NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandPhoto_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandPhoto_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalLandPhoto_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandPhoto_PhotoFileId FOREIGN KEY (PhotoFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

UPDATE l SET WorkflowStatus = ISNULL((
    SELECT TOP 1 s.StepName FROM dbo.LegalWorkflowStep s
    LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = l.LandId
    WHERE s.IsActive = 1 AND ISNULL(st.Status, 'Not Started') NOT IN ('Completed', 'Skipped')
    ORDER BY s.StepNo), 'Completed')
FROM dbo.LegalLand l;
GO

PRINT '603-legal-land-photos-status-sync applied successfully.';
GO

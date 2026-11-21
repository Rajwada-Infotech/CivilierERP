-- Land Flowchart: the verifier's step-by-step review of a land's next version, then the Approver's decision.
-- Approved reviews make the versions (LegalLandRegisterSnapshot, Remarks "Version N approved — Land review approved").
IF OBJECT_ID('dbo.LegalLandReview', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalLandReview (
    ReviewId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalLandReview PRIMARY KEY,
    LandId      INT NOT NULL CONSTRAINT FK_LegalLandReview_Land REFERENCES dbo.LegalLand (LandId),
    VersionNo   INT NOT NULL,
    Status      NVARCHAR(20) NOT NULL CONSTRAINT CK_LegalLandReview_Status CHECK (Status IN (N'Verifying', N'Submitted', N'Approved', N'Returned')),
    ChecksJson  NVARCHAR(MAX) NULL,
    SubmittedBy INT NULL,
    SubmittedAt DATETIME2 NULL,
    DecidedBy   INT NULL,
    DecidedAt   DATETIME2 NULL,
    Remarks     NVARCHAR(1000) NULL,
    CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_LegalLandReview_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_LegalLandReview_Land ON dbo.LegalLandReview (LandId, Status);
END
GO

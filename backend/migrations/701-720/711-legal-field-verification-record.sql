-- Land verification: one permanent record per field per verification round (what was checked, its value at that
-- moment, the verifier's decision and remark). Written when the verifier saves a version or sends the land back;
-- the live marks while verifying stay in LegalLandReview.ChecksJson.
IF OBJECT_ID('dbo.LegalLandFieldCheck', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalLandFieldCheck (
    FieldCheckId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalLandFieldCheck PRIMARY KEY,
    LandId        INT NOT NULL CONSTRAINT FK_LegalLandFieldCheck_Land REFERENCES dbo.LegalLand (LandId),
    ReviewId      INT NOT NULL,                -- the verification round (submission)
    VersionNo     INT NOT NULL,                -- the version it was for
    Outcome       NVARCHAR(20) NOT NULL,       -- Verified (version saved) / Sent back
    SectionKey    NVARCHAR(30) NOT NULL,
    FieldKey      NVARCHAR(200) NOT NULL,      -- entry kind # entry id # field
    FieldLabel    NVARCHAR(200) NULL,
    ValueSnapshot NVARCHAR(MAX) NULL,          -- the value the verifier saw
    Status        NVARCHAR(10) NOT NULL CONSTRAINT CK_LegalLandFieldCheck_Status CHECK (Status IN (N'ok', N'bad', N'na')),
    Remarks       NVARCHAR(500) NULL,
    VerifiedBy    NVARCHAR(150) NULL,
    VerifiedAt    DATETIME2 NULL,
    CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_LegalLandFieldCheck_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_LegalLandFieldCheck_Land ON dbo.LegalLandFieldCheck (LandId, VersionNo);
  CREATE INDEX IX_LegalLandFieldCheck_Review ON dbo.LegalLandFieldCheck (ReviewId);
END
GO

-- 692: Face verification + geofence for Employee Portal punches. Schema only; safe to re-run.
--  • EmployeeFaceTemplate: one encrypted face template per enrollment (AES-256-GCM; the key lives outside SQL Server).
--    Only one Active row per employee; revoked / replaced rows stay for the audit trail.
--  • EmployeeFaceVerification: every enroll / verify outcome (score, result, geofence). No images, no embeddings.
--  • AttendanceChallenge: short-lived single-use nonce for each punch (expiry + replay protection).
--  • EmployeeMaster.FaceExempt: HR exemption — punches without face match, still geofenced, flagged for HR review.
--  • EmployeeAttendance: which location / distance / face score each In and Out passed with, and the review flag.
-- HR tables in this database have no tenant key (one database per deployment), so none is added here.
IF OBJECT_ID('dbo.EmployeeFaceTemplate', 'U') IS NULL
CREATE TABLE dbo.EmployeeFaceTemplate (
  FaceTemplateId INT IDENTITY(1,1) CONSTRAINT PK_EmployeeFaceTemplate PRIMARY KEY,
  EmployeeId     INT NOT NULL CONSTRAINT FK_EmployeeFaceTemplate_Employee REFERENCES dbo.EmployeeMaster (EmployeeId) ON DELETE CASCADE,
  Status         NVARCHAR(20) NOT NULL CONSTRAINT DF_EmployeeFaceTemplate_Status DEFAULT N'Active',
  TemplateCipher VARBINARY(MAX) NOT NULL,
  KeyId          NVARCHAR(100) NOT NULL,
  ModelVersion   NVARCHAR(60) NOT NULL,
  SampleCount    INT NOT NULL,
  QualityScore   DECIMAL(5,3) NULL,
  ConsentAt      DATETIME2(0) NOT NULL,
  EnrolledBy     INT NULL CONSTRAINT FK_EmployeeFaceTemplate_EnrolledBy REFERENCES dbo.users (id),
  EnrolledAt     DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeFaceTemplate_EnrolledAt DEFAULT SYSUTCDATETIME(),
  RevokedBy      INT NULL CONSTRAINT FK_EmployeeFaceTemplate_RevokedBy REFERENCES dbo.users (id),
  RevokedAt      DATETIME2(0) NULL,
  RevokeReason   NVARCHAR(500) NULL,
  CONSTRAINT CK_EmployeeFaceTemplate_Status CHECK (Status IN (N'Pending', N'Active', N'Revoked', N'Replaced'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EmployeeFaceTemplate_OneActive')
  CREATE UNIQUE INDEX UX_EmployeeFaceTemplate_OneActive ON dbo.EmployeeFaceTemplate (EmployeeId) WHERE Status = N'Active';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeFaceTemplate_Employee')
  CREATE INDEX IX_EmployeeFaceTemplate_Employee ON dbo.EmployeeFaceTemplate (EmployeeId, EnrolledAt DESC);
GO
IF OBJECT_ID('dbo.EmployeeFaceVerification', 'U') IS NULL
CREATE TABLE dbo.EmployeeFaceVerification (
  VerificationId INT IDENTITY(1,1) CONSTRAINT PK_EmployeeFaceVerification PRIMARY KEY,
  EmployeeId     INT NOT NULL CONSTRAINT FK_EmployeeFaceVerification_Employee REFERENCES dbo.EmployeeMaster (EmployeeId) ON DELETE CASCADE,
  Purpose        NVARCHAR(20) NOT NULL,            -- enroll | in | out
  Result         NVARCHAR(20) NOT NULL,            -- Pass | Fail | Error | Exempt
  Stage          NVARCHAR(20) NULL,                -- challenge | geofence | quality | match
  Score          DECIMAL(6,4) NULL,
  Reason         NVARCHAR(300) NULL,
  LocationId     INT NULL,
  DistanceM      INT NULL,
  AccuracyM      INT NULL,
  FaceTemplateId INT NULL,
  IpAddress      NVARCHAR(64) NULL,
  CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeFaceVerification_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeFaceVerification_Employee')
  CREATE INDEX IX_EmployeeFaceVerification_Employee ON dbo.EmployeeFaceVerification (EmployeeId, CreatedAt DESC) INCLUDE (Result, Stage);
GO
IF OBJECT_ID('dbo.AttendanceChallenge', 'U') IS NULL
CREATE TABLE dbo.AttendanceChallenge (
  ChallengeId INT IDENTITY(1,1) CONSTRAINT PK_AttendanceChallenge PRIMARY KEY,
  EmployeeId  INT NOT NULL CONSTRAINT FK_AttendanceChallenge_Employee REFERENCES dbo.EmployeeMaster (EmployeeId) ON DELETE CASCADE,
  Nonce       CHAR(64) NOT NULL CONSTRAINT UQ_AttendanceChallenge_Nonce UNIQUE,
  Purpose     NVARCHAR(10) NOT NULL,
  ExpiresAt   DATETIME2(0) NOT NULL,
  UsedAt      DATETIME2(0) NULL,
  CreatedAt   DATETIME2(0) NOT NULL CONSTRAINT DF_AttendanceChallenge_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AttendanceChallenge_Expires')
  CREATE INDEX IX_AttendanceChallenge_Expires ON dbo.AttendanceChallenge (ExpiresAt);
GO
IF COL_LENGTH('dbo.EmployeeMaster', 'FaceExempt') IS NULL
  ALTER TABLE dbo.EmployeeMaster ADD FaceExempt BIT NOT NULL CONSTRAINT DF_EmployeeMaster_FaceExempt DEFAULT 0, FaceExemptReason NVARCHAR(300) NULL;
GO
IF COL_LENGTH('dbo.EmployeeAttendance', 'InLocationId') IS NULL
  ALTER TABLE dbo.EmployeeAttendance ADD
    InLocationId  INT NULL CONSTRAINT FK_EmployeeAttendance_InLocation REFERENCES dbo.WorkLocationMaster (LocationId),
    InDistanceM   INT NULL,
    InFaceScore   DECIMAL(6,4) NULL,
    OutLocationId INT NULL CONSTRAINT FK_EmployeeAttendance_OutLocation REFERENCES dbo.WorkLocationMaster (LocationId),
    OutDistanceM  INT NULL,
    OutFaceScore  DECIMAL(6,4) NULL,
    NeedsReview   BIT NOT NULL CONSTRAINT DF_EmployeeAttendance_NeedsReview DEFAULT 0,
    ReviewReason  NVARCHAR(300) NULL;
GO
PRINT '692-attendance-face-geofence applied successfully.';
GO

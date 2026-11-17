-- 691: Legal — LA (Land Acquisition) and ULC (Urban Land Ceiling) clearance per land. Schema only; safe to re-run.
--  One row per land per kind: applied (date, application no.) → obtained (date, certificate no.) or rejected,
--  with the certificate copy attached at Post-Registration once it is successful. Every change goes to the audit trail.
IF OBJECT_ID('dbo.LegalLandClearance', 'U') IS NULL
CREATE TABLE dbo.LegalLandClearance (
  ClearanceId   INT IDENTITY(1,1) PRIMARY KEY,
  LandId        INT NOT NULL CONSTRAINT FK_LegalLandClearance_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  Kind          NVARCHAR(10) NOT NULL,                       -- 'LA' | 'ULC'
  Status        NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandClearance_Status DEFAULT N'Not Applied',
  AppliedOn     DATE NULL,
  ApplicationNo NVARCHAR(100) NULL,
  ObtainedOn    DATE NULL,
  CertificateNo NVARCHAR(100) NULL,
  Remarks       NVARCHAR(1000) NULL,
  FileId        INT NULL,
  UpdatedBy     INT NULL,
  UpdatedAt     DATETIME2 NULL,
  CONSTRAINT UQ_LegalLandClearance UNIQUE (LandId, Kind)
);

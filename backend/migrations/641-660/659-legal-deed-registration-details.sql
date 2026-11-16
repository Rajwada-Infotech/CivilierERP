-- 659: Deed Registration in full, step by step on one page:
--   1. Consideration — total amount, rate, advance, mode of payment (Setup → Payment Mode).
--   2. Registration & Stamp Duty — each query to the office: query date, amount, fee type (Setup → Registration Fee Type).
--   3. Apply to deed register (existing).
--   4. Final Registration — date, office of registration (Setup → Deed Registration Office), mode of registration
--      (Setup → Registration Mode), registered deed number; then the registered deed copy is uploaded (existing).
--   5. Physical Deed / IGR tracking — IGR status-tracking link, IGR status (Setup → IGR Status), where the physical deed is
--      (Setup → Deed Location); every update is kept as history.
-- Schema + reference lists for the three new Setup lists.
IF COL_LENGTH('dbo.LegalLand', 'ConsTotalAmount') IS NULL ALTER TABLE dbo.LegalLand ADD ConsTotalAmount DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.LegalLand', 'ConsRate') IS NULL ALTER TABLE dbo.LegalLand ADD ConsRate DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.LegalLand', 'ConsRateUnitId') IS NULL ALTER TABLE dbo.LegalLand ADD ConsRateUnitId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'ConsAdvanceAmount') IS NULL ALTER TABLE dbo.LegalLand ADD ConsAdvanceAmount DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.LegalLand', 'ConsPaymentModeId') IS NULL ALTER TABLE dbo.LegalLand ADD ConsPaymentModeId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'ConsRemarks') IS NULL ALTER TABLE dbo.LegalLand ADD ConsRemarks NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegFinalDate') IS NULL ALTER TABLE dbo.LegalLand ADD RegFinalDate DATE NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegOfficeId') IS NULL ALTER TABLE dbo.LegalLand ADD RegOfficeId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegModeId') IS NULL ALTER TABLE dbo.LegalLand ADD RegModeId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegDeedNo') IS NULL ALTER TABLE dbo.LegalLand ADD RegDeedNo NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.LegalLand', 'IgrTrackingUrl') IS NULL ALTER TABLE dbo.LegalLand ADD IgrTrackingUrl NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.LegalLand', 'IgrStatusId') IS NULL ALTER TABLE dbo.LegalLand ADD IgrStatusId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedLocationId') IS NULL ALTER TABLE dbo.LegalLand ADD DeedLocationId INT NULL;
GO

IF OBJECT_ID('dbo.LegalStampDutyQuery', 'U') IS NULL
CREATE TABLE dbo.LegalStampDutyQuery (
  QueryId     INT IDENTITY(1,1) CONSTRAINT PK_LegalStampDutyQuery PRIMARY KEY,
  LandId      INT NOT NULL CONSTRAINT FK_LegalStampDutyQuery_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  QueryDate   DATE NOT NULL,
  FeeTypeId   INT NULL,
  Amount      DECIMAL(18,2) NOT NULL,
  Remarks     NVARCHAR(1000) NULL,
  CreatedBy   INT NULL,
  CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_LegalStampDutyQuery_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalStampDutyQuery_Land')
  CREATE INDEX IX_LegalStampDutyQuery_Land ON dbo.LegalStampDutyQuery (LandId, QueryDate DESC);
GO

IF OBJECT_ID('dbo.LegalDeedTracking', 'U') IS NULL
CREATE TABLE dbo.LegalDeedTracking (
  TrackId        INT IDENTITY(1,1) CONSTRAINT PK_LegalDeedTracking PRIMARY KEY,
  LandId         INT NOT NULL CONSTRAINT FK_LegalDeedTracking_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  StatusDate     DATE NOT NULL,
  IgrStatusId    INT NULL,
  DeedLocationId INT NULL,
  TrackingUrl    NVARCHAR(500) NULL,
  Remarks        NVARCHAR(1000) NULL,
  CreatedBy      INT NULL,
  CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalDeedTracking_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalDeedTracking_Land')
  CREATE INDEX IX_LegalDeedTracking_Land ON dbo.LegalDeedTracking (LandId, StatusDate DESC);
GO

-- Reference lists (editable in Setup).
MERGE dbo.LegalLookupValue AS t
USING (VALUES
  (N'registration-mode', N'Physical (at office)', 10), (N'registration-mode', N'e-Registration', 20), (N'registration-mode', N'Commission (at residence)', 30),
  (N'igr-status', N'Applied', 10), (N'igr-status', N'Under scrutiny', 20), (N'igr-status', N'Registered — deed pending', 30),
  (N'igr-status', N'Ready for delivery', 40), (N'igr-status', N'Delivered', 50),
  (N'deed-location', N'In registration office', 10), (N'deed-location', N'With advocate', 20), (N'deed-location', N'In company office', 30),
  (N'deed-location', N'In company locker / vault', 40)
) AS s (Category, Name, SortOrder)
ON t.Category = s.Category AND t.Name = s.Name
WHEN NOT MATCHED THEN INSERT (Category, Name, SortOrder) VALUES (s.Category, s.Name, s.SortOrder);
GO
MERGE dbo.PageDefinitions AS t
USING (VALUES
  (N'legal-registration-mode-master', N'Registration Mode Master', 162),
  (N'legal-igr-status-master', N'IGR Status Master', 163),
  (N'legal-deed-location-master', N'Deed Location Master', 164)
) AS s (PageKey, Label, SortOrder)
ON t.PageKey = s.PageKey
WHEN NOT MATCHED THEN INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (s.PageKey, s.Label, N'Legal', N'Legal Masters - Registration', N'view,create,edit,delete,print,export', s.SortOrder, 1, N'migration-659', SYSDATETIME());
GO

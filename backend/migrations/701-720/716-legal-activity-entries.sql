-- Legal V2 phase 2: detail entries of the verification activities (searches, applications, Dag mapping, owner
-- matching, deed chain, map sheets, Khajna receipts, surveys). Fields per activity are defined and checked in
-- backend/routes/legal/activityEntries.js; DataJson holds them. Removing an entry only deactivates it.

IF OBJECT_ID('dbo.LegalActivityEntry', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityEntry (
    EntryId    INT IDENTITY(1,1) CONSTRAINT PK_LegalActivityEntry PRIMARY KEY,
    ActivityId INT NOT NULL CONSTRAINT FK_LegalActivityEntry_Activity REFERENCES dbo.LegalVerificationActivity (ActivityId),
    DataJson   NVARCHAR(MAX) NOT NULL CONSTRAINT CK_LegalActivityEntry_Json CHECK (ISJSON(DataJson) = 1),
    IsActive   BIT NOT NULL CONSTRAINT DF_LegalActivityEntry_IsActive DEFAULT 1,
    RemovedReason NVARCHAR(500) NULL,
    CreatedBy  INT NULL,
    CreatedAt  DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityEntry_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT NULL,
    UpdatedAt  DATETIME2 NULL
  );
  CREATE INDEX IX_LegalActivityEntry_Activity ON dbo.LegalActivityEntry (ActivityId, IsActive);
END
GO

-- An entry's old values are kept in the activity history (LegalActivityHistory.Remarks + this column).
IF COL_LENGTH('dbo.LegalActivityHistory', 'EntryId') IS NULL
  ALTER TABLE dbo.LegalActivityHistory ADD EntryId INT NULL, OldDataJson NVARCHAR(MAX) NULL;
GO

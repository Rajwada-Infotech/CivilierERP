-- An operational reminder needs a human audit trail: who changed the plan,
-- previewed it, enabled/disabled it, or paused it.  Snapshots make the
-- original rule recoverable even after later edits.
IF OBJECT_ID('dbo.CrmReminderAudit', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmReminderAudit (
    Id BIGINT IDENTITY(1,1) CONSTRAINT PK_CrmReminderAudit PRIMARY KEY,
    RuleId INT NULL CONSTRAINT FK_CrmReminderAudit_Rule FOREIGN KEY REFERENCES dbo.CrmReminderRule(Id),
    BookingId INT NULL,
    Action NVARCHAR(40) NOT NULL,
    Detail NVARCHAR(500) NULL,
    SnapshotJson NVARCHAR(MAX) NULL,
    ChangedBy INT NULL,
    ChangedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmReminderAudit_ChangedAt DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmReminderAudit_Rule ON dbo.CrmReminderAudit(RuleId, ChangedAt DESC);
  CREATE INDEX IX_CrmReminderAudit_Booking ON dbo.CrmReminderAudit(BookingId, ChangedAt DESC);
END
GO

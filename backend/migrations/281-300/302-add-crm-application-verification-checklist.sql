-- Migration 302: dbo.CrmApplicationVerificationChecklist
--
-- Backs the Level-1 per-field verification checklist on CrmApplication
-- (see backend/services/crmApplicationChecklist.js). One row per
-- (ApplicationId, Level, ItemKey) — Level is included now even though only
-- Level 1 exists today, so a Level 2 checklist can be added later purely by
-- data (a second CHECKLIST_ITEMS set + level param) with no schema change.

IF OBJECT_ID(N'dbo.CrmApplicationVerificationChecklist', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CrmApplicationVerificationChecklist (
    Id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ApplicationId INT NOT NULL,
    Level         INT NOT NULL DEFAULT 1,
    ItemKey       NVARCHAR(50)   NOT NULL,
    -- Snapshot of the label at the time this row was created, so a later
    -- reword of CHECKLIST_ITEMS doesn't rewrite what an already-checked
    -- historical row is showing on old applications.
    ItemLabel     NVARCHAR(200)  NOT NULL,
    IsChecked     BIT NOT NULL DEFAULT 0,
    -- 'Pending' (not yet reviewed) | 'Checked' (verified ok) | 'NeedsRecheck' (flagged, remark required)
    CheckStatus   NVARCHAR(20) NOT NULL DEFAULT 'Pending',
    Remarks       NVARCHAR(1000) NULL,
    CheckedBy     INT NULL,
    CheckedAt     DATETIME2 NULL,
    CreatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_CrmApplicationVerificationChecklist_App_Level_Item
      UNIQUE (ApplicationId, Level, ItemKey),
    CONSTRAINT FK_CrmApplicationVerificationChecklist_Application
      FOREIGN KEY (ApplicationId) REFERENCES dbo.CrmApplication(Id)
  );

  CREATE INDEX IX_CrmApplicationVerificationChecklist_ApplicationId
    ON dbo.CrmApplicationVerificationChecklist (ApplicationId);
END
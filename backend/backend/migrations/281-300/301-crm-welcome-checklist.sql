-- ============================================================================
-- Migration: Welcome Call verification checklist (per-item checkbox + remarks
-- + send-for-recheck) and final submission lock.
--
-- Run this against the same database CrmBooking/CrmWelcomeCall already live
-- in. Safe to re-run (guarded with IF NOT EXISTS).
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmWelcomeChecklistItem')
BEGIN
  CREATE TABLE dbo.CrmWelcomeChecklistItem (
    Id                    INT IDENTITY(1,1) PRIMARY KEY,
    BookingId             INT NOT NULL,
    Section               NVARCHAR(50)  NOT NULL,   -- ProjectUnit | PaymentPlan | BankNominee | CoApplicant | PersonalContact
    ItemKey               NVARCHAR(80)  NOT NULL,   -- see CHECKLIST_TEMPLATE in crmWelcomeChecklist.js
    IsChecked             BIT NOT NULL DEFAULT 0,
    Remarks               NVARCHAR(1000) NULL,
    CheckedBy             INT NULL,
    CheckedAt             DATETIME2(3) NULL,

    -- RecheckStatus: NULL = never flagged, 'Open' = flagged & blocking submit,
    -- 'Resolved' = fixed, item must be re-ticked before it counts again.
    RecheckStatus         NVARCHAR(20) NULL,
    RecheckReason         NVARCHAR(1000) NULL,
    RecheckRequestedBy    INT NULL,
    RecheckRequestedAt    DATETIME2(3) NULL,
    ResolvedBy            INT NULL,
    ResolvedAt            DATETIME2(3) NULL,

    UpdatedAt             DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_CrmWelcomeChecklistItem_Booking FOREIGN KEY (BookingId) REFERENCES dbo.CrmBooking(Id),
    CONSTRAINT UQ_CrmWelcomeChecklistItem_BookingItem UNIQUE (BookingId, ItemKey)
  );

  CREATE INDEX IX_CrmWelcomeChecklistItem_RecheckOpen
    ON dbo.CrmWelcomeChecklistItem (RecheckStatus)
    WHERE RecheckStatus = 'Open';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmWelcomeCallSubmission')
BEGIN
  CREATE TABLE dbo.CrmWelcomeCallSubmission (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    BookingId     INT NOT NULL UNIQUE,
    IsLocked      BIT NOT NULL DEFAULT 0,
    SubmittedBy   INT NULL,
    SubmittedAt   DATETIME2(3) NULL,
    ReopenedBy    INT NULL,
    ReopenedAt    DATETIME2(3) NULL,
    CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_CrmWelcomeCallSubmission_Booking FOREIGN KEY (BookingId) REFERENCES dbo.CrmBooking(Id)
  );
END
GO
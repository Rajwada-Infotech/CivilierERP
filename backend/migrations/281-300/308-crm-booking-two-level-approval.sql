-- ============================================================
-- 308-crm-booking-two-level-approval.sql
-- ============================================================
-- New Booking workflow (replaces the old Application-L1 gate +
-- Booking-L2 gate as separate admin steps):
--
--   Application submit  ->  Booking auto-created (Pending)
--   Stage 'Review'      ->  staff do the data-entry review on the
--                           booking page (confirm unit/plan boxes +
--                           booking amount payment), then Submit for
--                           Approval.
--   Stage 'MarketingHeadApproval'  -> marketing_head / super_admin
--   Stage 'DirectorApproval'       -> director / super_admin
--   Stage 'Confirmed'    -> Status becomes 'Approved'; the existing
--                           downstream flow (Welcome Call, Bank
--                           Details, Agreement, Payments) proceeds.
--
-- Rejection at ANY stage never terminally cancels: it bounces the
-- booking back exactly one stage with a mandatory remark (stored in
-- StageRemarks and surfaced highlighted at that stage), so the
-- preparer/approver can correct and re-submit. The loop repeats until
-- every stage clears, or the booking is genuinely cancelled via the
-- Cancellation Request flow / SLA expiry.
--
-- The two approval levels themselves live in dbo.ApprovalWorkflows
-- (module key 'crm-bookings', seeded below) so Admin > Approval Setup
-- can edit labels / assign specific user ids / change the order later
-- with no code change. approvalService.transition() already reads
-- LevelsData and enforces per-level roles.

-- 1) Seed the director role (idempotent)
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'director')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('director', 'DIR', 'Director', 'system');
GO

-- 2) Booking workflow-stage columns
--    WorkflowStage: Review | MarketingHeadApproval | DirectorApproval | Confirmed
IF COL_LENGTH('dbo.CrmBooking', 'WorkflowStage') IS NULL
    ALTER TABLE dbo.CrmBooking ADD WorkflowStage NVARCHAR(40) NOT NULL
        CONSTRAINT DF_CrmBooking_WorkflowStage DEFAULT 'Review';
GO
IF COL_LENGTH('dbo.CrmBooking', 'StageRemarks') IS NULL
    ALTER TABLE dbo.CrmBooking ADD StageRemarks NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'RejectedFromStage') IS NULL
    ALTER TABLE dbo.CrmBooking ADD RejectedFromStage NVARCHAR(40) NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'RejectedBy') IS NULL
    ALTER TABLE dbo.CrmBooking ADD RejectedBy INT NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'RejectedAt') IS NULL
    ALTER TABLE dbo.CrmBooking ADD RejectedAt DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'MarketingHeadApprovedAt') IS NULL
    ALTER TABLE dbo.CrmBooking ADD MarketingHeadApprovedAt DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'MarketingHeadApprovedBy') IS NULL
    ALTER TABLE dbo.CrmBooking ADD MarketingHeadApprovedBy INT NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'DirectorApprovedAt') IS NULL
    ALTER TABLE dbo.CrmBooking ADD DirectorApprovedAt DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'DirectorApprovedBy') IS NULL
    ALTER TABLE dbo.CrmBooking ADD DirectorApprovedBy INT NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'ConfirmedAt') IS NULL
    ALTER TABLE dbo.CrmBooking ADD ConfirmedAt DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.CrmBooking', 'ConfirmedBy') IS NULL
    ALTER TABLE dbo.CrmBooking ADD ConfirmedBy INT NULL;
GO

-- 3) Stage history log (every advance, bounce, and confirmation)
IF OBJECT_ID(N'dbo.CrmBookingStageLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CrmBookingStageLog (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BookingId INT NOT NULL,
        Stage NVARCHAR(40) NOT NULL,
        [Action] NVARCHAR(60) NOT NULL,
        Remarks NVARCHAR(MAX) NULL,
        ActorId INT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_CrmBookingStageLog_BookingId
        ON dbo.CrmBookingStageLog (BookingId, CreatedAt);
END
GO

-- 4) Seed the crm-bookings two-level approval workflow.
--    approvalService.getWorkflow('crm-bookings') matches this via
--    modules LIKE '%"crm-bookings"%' and enforces level 1 roles /
--    level 2 roles from LevelsData. super_admin is a parallel approver
--    on BOTH levels; admin retained for continuity with today's
--    CRM_APPROVER_ROLES. Editable later from Admin > Approval Setup.
IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE '%"crm-bookings"%')
BEGIN
    INSERT INTO dbo.ApprovalWorkflows
        (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
    VALUES
        ('CRM Booking Approval (Marketing Head -> Director)', 'sequential',
         '["crm-bookings"]',
         '[{"id":1,"label":"Marketing Head","roles":["admin","super_admin","marketing_head"],"userIds":[]},{"id":2,"label":"Director","roles":["admin","super_admin","director"],"userIds":[]}]',
         1, 'system', SYSDATETIME(), 'crm-bookings', 2, 'Active');
END
GO

-- 5) Existing Pending bookings (none Confirmed yet) start at Review so
--    the new stage machine has a sane default for pre-existing data.
UPDATE dbo.CrmBooking
SET WorkflowStage = 'Review'
WHERE WorkflowStage IS NULL OR WorkflowStage = '';
GO

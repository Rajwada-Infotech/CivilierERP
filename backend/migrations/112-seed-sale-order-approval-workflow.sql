-- ============================================================
-- Migration: 112-seed-sale-order-approval-workflow.sql
--
-- Seeds a single-level "Sale Order Approval" workflow row so that
-- ApprovalStatusChain (status badge on the Sale Order page) has a
-- workflow to render against, and so the Pending -> Approved/Rejected
-- transition() flow has its expected Levels count.
--
-- The level's approvers are every currently active user with an
-- approver role (admin / super_admin / dba) — the same role list
-- already enforced by approvalService.js's APPROVER_ROLES and by
-- ApprovalActions.tsx's client-side check. If you want a different
-- or smaller set of approvers, edit the level afterwards from
-- Admin > Approval Setup — this migration only seeds it once and
-- will not overwrite an existing Sale Order workflow on re-run.
--
-- Depends on migration 111 (adds the LevelsData column — see that
-- file for why the originally-planned 'levels' column never
-- actually existed). Must run after 111.
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM dbo.ApprovalWorkflows
    WHERE modules LIKE '%SaleOrder%'
)
BEGIN
    DECLARE @ApproverIds NVARCHAR(MAX);
    SELECT @ApproverIds = COALESCE(
        (
            SELECT STRING_AGG(CAST(id AS NVARCHAR(20)), ',')
            FROM dbo.users
            WHERE discontinue = 0
              AND LOWER(ISNULL(role, '')) IN ('admin', 'super_admin', 'dba')
        ),
        ''
    );

    DECLARE @LevelsJson NVARCHAR(MAX) =
        N'[{"id":1,"label":"Approval","userIds":[' + ISNULL(@ApproverIds, '') + N']}]';

    INSERT INTO dbo.ApprovalWorkflows
        (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt,
         Module, Levels, Status)
    VALUES
        (N'Sale Order Approval', N'sequential', N'["SaleOrder"]', @LevelsJson, 1,
         N'migration-111', SYSDATETIME(),
         N'SaleOrder', 1, N'Active');

    PRINT 'Seeded Sale Order Approval workflow.';
END
ELSE
    PRINT 'A Sale Order workflow already exists — skipped seeding.';
GO

PRINT '================================================================';
PRINT '112-seed-sale-order-approval-workflow applied successfully.';
PRINT '================================================================';
GO

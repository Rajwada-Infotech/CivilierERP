-- ============================================================
-- 029-cleanup-expensebooking-generic-approval-columns.sql
--
-- Purpose:
-- phase3_migration.sql added generic workflow columns to dbo.ExpenseBooking:
--   Status, ApprovedBy, ApprovedAt, RejectedBy, RejectedAt,
--   RejectionNote, UpdatedBy, UpdatedAt
--
-- The live ExpenseBooking route + approval engine use E-prefixed columns:
--   EStatus, ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy, ECompanyId
-- and ApprovalAuditLog for approval history.
--
-- This cleanup migration is intentionally conservative:
-- 1. It verifies the E-prefixed columns exist.
-- 2. It verifies the generic columns exist.
-- 3. It ABORTS if the generic columns contain meaningful data.
-- 4. It drops only the orphaned generic columns after dropping the default
--    constraint on Status, if present.
--
-- Safe pattern expected before this runs:
--   Status IN ('Draft') or NULL for every row
--   ApprovedBy / ApprovedAt / RejectedBy / RejectedAt /
--   RejectionNote / UpdatedBy / UpdatedAt are all NULL
-- ============================================================

BEGIN TRY
  BEGIN TRANSACTION;

  -- ------------------------------------------------------------
  -- Preconditions: the canonical E* columns must already exist
  -- ------------------------------------------------------------
  IF COL_LENGTH('dbo.ExpenseBooking', 'EStatus') IS NULL
     OR COL_LENGTH('dbo.ExpenseBooking', 'ECreatedAt') IS NULL
     OR COL_LENGTH('dbo.ExpenseBooking', 'EUpdatedAt') IS NULL
     OR COL_LENGTH('dbo.ExpenseBooking', 'ECreatedBy') IS NULL
     OR COL_LENGTH('dbo.ExpenseBooking', 'EApprovedBy') IS NULL
  BEGIN
    THROW 50001, 'Abort: canonical E* columns are missing on dbo.ExpenseBooking.', 1;
  END;

  -- ------------------------------------------------------------
  -- If the generic phase3 columns are not present, this migration
  -- is already effectively complete.
  -- ------------------------------------------------------------
  IF COL_LENGTH('dbo.ExpenseBooking', 'Status') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'ApprovedBy') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'ApprovedAt') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'RejectedBy') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'RejectedAt') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'RejectionNote') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'UpdatedBy') IS NULL
     AND COL_LENGTH('dbo.ExpenseBooking', 'UpdatedAt') IS NULL
  BEGIN
    PRINT 'No generic phase3 columns found on dbo.ExpenseBooking. Nothing to do.';
    COMMIT TRANSACTION;
    RETURN;
  END;

  -- ------------------------------------------------------------
  -- Safety check:
  -- Abort if the generic columns contain anything other than the
  -- known stale/default pattern.
  -- ------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM dbo.ExpenseBooking
    WHERE
      (
        COL_LENGTH('dbo.ExpenseBooking', 'Status') IS NOT NULL
        AND ISNULL(LTRIM(RTRIM(CAST(Status AS NVARCHAR(50)))), '') NOT IN ('', 'Draft')
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'ApprovedBy') IS NOT NULL
        AND ApprovedBy IS NOT NULL
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'ApprovedAt') IS NOT NULL
        AND ApprovedAt IS NOT NULL
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'RejectedBy') IS NOT NULL
        AND RejectedBy IS NOT NULL
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'RejectedAt') IS NOT NULL
        AND RejectedAt IS NOT NULL
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'RejectionNote') IS NOT NULL
        AND RejectionNote IS NOT NULL
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'UpdatedBy') IS NOT NULL
        AND UpdatedBy IS NOT NULL
      )
      OR (
        COL_LENGTH('dbo.ExpenseBooking', 'UpdatedAt') IS NOT NULL
        AND UpdatedAt IS NOT NULL
      )
  )
  BEGIN
    THROW 50002, 'Abort: generic phase3 columns on dbo.ExpenseBooking contain non-default data. Review and reconcile manually before dropping.', 1;
  END;

  -- ------------------------------------------------------------
  -- Drop default constraint on generic Status first, if SQL Server
  -- auto-created one during phase3_migration.sql
  -- ------------------------------------------------------------
  DECLARE @dropDefaultSql NVARCHAR(MAX) = N'';

  SELECT @dropDefaultSql = STRING_AGG(
    N'ALTER TABLE dbo.ExpenseBooking DROP CONSTRAINT [' + dc.name + N']',
    N'; '
  )
  FROM sys.default_constraints dc
  INNER JOIN sys.columns c
    ON c.default_object_id = dc.object_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.ExpenseBooking')
    AND c.name = 'Status';

  IF @dropDefaultSql IS NOT NULL AND LEN(@dropDefaultSql) > 0
  BEGIN
    EXEC sp_executesql @dropDefaultSql;
  END;

  -- ------------------------------------------------------------
  -- Drop only the generic/orphaned columns that still exist
  -- ------------------------------------------------------------
  IF COL_LENGTH('dbo.ExpenseBooking', 'Status') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN Status;

  IF COL_LENGTH('dbo.ExpenseBooking', 'ApprovedBy') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN ApprovedBy;

  IF COL_LENGTH('dbo.ExpenseBooking', 'ApprovedAt') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN ApprovedAt;

  IF COL_LENGTH('dbo.ExpenseBooking', 'RejectedBy') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN RejectedBy;

  IF COL_LENGTH('dbo.ExpenseBooking', 'RejectedAt') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN RejectedAt;

  IF COL_LENGTH('dbo.ExpenseBooking', 'RejectionNote') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN RejectionNote;

  IF COL_LENGTH('dbo.ExpenseBooking', 'UpdatedBy') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN UpdatedBy;

  IF COL_LENGTH('dbo.ExpenseBooking', 'UpdatedAt') IS NOT NULL
    ALTER TABLE dbo.ExpenseBooking DROP COLUMN UpdatedAt;

  COMMIT TRANSACTION;
  PRINT 'ExpenseBooking generic phase3 columns cleaned up successfully.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;

-- Optional verification
SELECT
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ExpenseBooking'
ORDER BY ORDINAL_POSITION;

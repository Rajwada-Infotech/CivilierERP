-- Migration 448: Repair CrmCustomerBankDetail BookingId uniqueness for
-- Application-stage KYC rows.
--
-- Migration 200 originally dropped one SQL Server generated UNIQUE
-- constraint name. Production generated a different name, so the original
-- BookingId INT NOT NULL UNIQUE constraint survived there and all
-- Application-stage inserts with BookingId = NULL collided. Replace any
-- single-column unfiltered BookingId uniqueness with the intended filtered
-- unique index: one row per booking only when BookingId is present.

IF OBJECT_ID('dbo.CrmCustomerBankDetail', 'U') IS NOT NULL
BEGIN
  DECLARE @ConstraintName NVARCHAR(128);
  DECLARE @DropConstraintSql NVARCHAR(MAX);

  DECLARE booking_unique_constraints CURSOR LOCAL FAST_FORWARD FOR
    SELECT kc.name
    FROM sys.key_constraints kc
    JOIN sys.index_columns ic
      ON ic.object_id = kc.parent_object_id
     AND ic.index_id = kc.unique_index_id
    JOIN sys.columns c
      ON c.object_id = ic.object_id
     AND c.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
      AND kc.[type] = 'UQ'
      AND c.name = 'BookingId'
      AND NOT EXISTS (
        SELECT 1
        FROM sys.index_columns ic2
        WHERE ic2.object_id = ic.object_id
          AND ic2.index_id = ic.index_id
          AND ic2.column_id <> ic.column_id
      );

  OPEN booking_unique_constraints;
  FETCH NEXT FROM booking_unique_constraints INTO @ConstraintName;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @DropConstraintSql =
      N'ALTER TABLE dbo.CrmCustomerBankDetail DROP CONSTRAINT ' + QUOTENAME(@ConstraintName);
    EXEC sp_executesql @DropConstraintSql;

    FETCH NEXT FROM booking_unique_constraints INTO @ConstraintName;
  END

  CLOSE booking_unique_constraints;
  DEALLOCATE booking_unique_constraints;

  DECLARE @IndexName NVARCHAR(128);
  DECLARE @DropIndexSql NVARCHAR(MAX);

  DECLARE booking_unique_indexes CURSOR LOCAL FAST_FORWARD FOR
    SELECT i.name
    FROM sys.indexes i
    JOIN sys.index_columns ic
      ON ic.object_id = i.object_id
     AND ic.index_id = i.index_id
    JOIN sys.columns c
      ON c.object_id = ic.object_id
     AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
      AND i.is_unique = 1
      AND i.is_unique_constraint = 0
      AND ISNULL(i.has_filter, 0) = 0
      AND c.name = 'BookingId'
      AND NOT EXISTS (
        SELECT 1
        FROM sys.index_columns ic2
        WHERE ic2.object_id = i.object_id
          AND ic2.index_id = i.index_id
          AND ic2.column_id <> ic.column_id
      );

  OPEN booking_unique_indexes;
  FETCH NEXT FROM booking_unique_indexes INTO @IndexName;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @DropIndexSql =
      N'DROP INDEX ' + QUOTENAME(@IndexName) + N' ON dbo.CrmCustomerBankDetail';
    EXEC sp_executesql @DropIndexSql;

    FETCH NEXT FROM booking_unique_indexes INTO @IndexName;
  END

  CLOSE booking_unique_indexes;
  DEALLOCATE booking_unique_indexes;

  IF COL_LENGTH('dbo.CrmCustomerBankDetail', 'ApplicationId') IS NULL
    ALTER TABLE dbo.CrmCustomerBankDetail ADD ApplicationId INT NULL;

  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
      AND name = 'BookingId'
      AND is_nullable = 0
  )
    ALTER TABLE dbo.CrmCustomerBankDetail ALTER COLUMN BookingId INT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
      AND name = 'UX_CrmCustomerBankDetail_BookingId'
  )
    CREATE UNIQUE INDEX UX_CrmCustomerBankDetail_BookingId
      ON dbo.CrmCustomerBankDetail (BookingId)
      WHERE BookingId IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
      AND name = 'UX_CrmCustomerBankDetail_ApplicationId'
  )
    CREATE UNIQUE INDEX UX_CrmCustomerBankDetail_ApplicationId
      ON dbo.CrmCustomerBankDetail (ApplicationId)
      WHERE ApplicationId IS NOT NULL;

  PRINT 'Repaired CrmCustomerBankDetail BookingId unique constraint for nullable Application-stage rows';
END
GO

-- Migration 555: one LIVE sale deed per booking, not one ever.
--
-- dbo.CrmSalesDeed.BookingId was created with a plain UNIQUE constraint, so a
-- cancelled deed kept its booking forever: a deed cancelled to correct it (its
-- figures lock once it is sent to the customer) could never be replaced, and
-- the booking could never be conveyed. The rule becomes a filtered unique
-- index — at most one deed per booking that is not Cancelled. Cancelled deeds
-- stay as they are, for the record.

DECLARE @uq SYSNAME = (
  SELECT TOP 1 kc.name
  FROM sys.key_constraints kc
  JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmSalesDeed') AND kc.type = 'UQ' AND c.name = 'BookingId'
    AND (SELECT COUNT(*) FROM sys.index_columns ic2 WHERE ic2.object_id = kc.parent_object_id AND ic2.index_id = kc.unique_index_id) = 1);
IF @uq IS NOT NULL
BEGIN
  DECLARE @sql NVARCHAR(400) = N'ALTER TABLE dbo.CrmSalesDeed DROP CONSTRAINT ' + QUOTENAME(@uq);
  EXEC sp_executesql @sql;
  PRINT CONCAT('Migration 555: dropped ', @uq, ' (unique BookingId across every deed).');
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'UX_CrmSalesDeed_LiveBooking')
  CREATE UNIQUE INDEX UX_CrmSalesDeed_LiveBooking ON dbo.CrmSalesDeed (BookingId) WHERE Status <> 'Cancelled';
GO

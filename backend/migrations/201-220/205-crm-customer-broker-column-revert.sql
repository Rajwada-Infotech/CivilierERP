-- Reverts 204-crm-customer-broker-column.sql — broker selection was moved
-- back to being introduced at Application time (see CrmApplication.BrokerId,
-- added in 203), not at the Customer record. Drop the FK first, then the
-- column, mirroring the guarded conditional-drop pattern used elsewhere.
IF EXISTS (
  SELECT 1 FROM sys.foreign_keys fk
  WHERE fk.parent_object_id = OBJECT_ID('dbo.CrmCustomer')
    AND EXISTS (SELECT 1 FROM sys.foreign_key_columns fkc
                JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
                WHERE fkc.constraint_object_id = fk.object_id AND c.name = 'BrokerId')
)
BEGIN
  DECLARE @fkName NVARCHAR(200) = (
    SELECT TOP 1 fk.name FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID('dbo.CrmCustomer')
      AND EXISTS (SELECT 1 FROM sys.foreign_key_columns fkc
                  JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
                  WHERE fkc.constraint_object_id = fk.object_id AND c.name = 'BrokerId')
  );
  EXEC('ALTER TABLE dbo.CrmCustomer DROP CONSTRAINT ' + @fkName);
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomer') AND name = 'BrokerId')
  ALTER TABLE dbo.CrmCustomer DROP COLUMN BrokerId;
GO

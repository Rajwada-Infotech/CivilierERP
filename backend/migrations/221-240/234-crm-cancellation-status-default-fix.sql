-- CrmCancellation.Status was created with DEFAULT 'Requested' (migration
-- 150-crm-aftersales-workflow.sql) but crmCancellations.js POST / has always
-- explicitly inserted 'Pending' — the default was never actually exercised,
-- and 'Requested' isn't a value used anywhere else in the module's status
-- vocabulary (Pending/Approved/Rejected/Refunded). Correcting the default
-- so the schema matches the real, only-ever-used status set.
DECLARE @constraintName NVARCHAR(200);
SELECT @constraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmCancellation') AND c.name = 'Status' AND dc.definition = '(''Requested'')';

IF @constraintName IS NOT NULL
BEGIN
  EXEC('ALTER TABLE dbo.CrmCancellation DROP CONSTRAINT ' + @constraintName);
  EXEC('ALTER TABLE dbo.CrmCancellation ADD CONSTRAINT DF_CrmCancellation_Status DEFAULT ''Pending'' FOR Status');
END
GO

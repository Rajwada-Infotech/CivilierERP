-- 612 · The Legal module's Customer master is "Legal Customer", so it is not confused with the Sales / CRM
-- customers in Menu Rights. Only the label changes; the page key and data stay.
SET NOCOUNT ON;
GO
UPDATE dbo.PageDefinitions SET Label = N'Legal Customer Master', UpdatedAt = SYSDATETIME()
WHERE PageKey = N'legal-customer-master';
GO

-- Deed Registry Search: clear statuses per year and office — Found, Not Found, Not Applicable (the office has no records
-- for that year / not relevant), Under Review (asked for, waiting for the office or a certified copy). A year with no
-- row is Pending (not searched). Years before 1956 can be searched when needed (an office's search can start earlier).
DECLARE @c SYSNAME;
SELECT @c = name FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.LegalEnquiryDeedSearch') AND definition LIKE N'%Not Found%';
IF @c IS NOT NULL EXEC(N'ALTER TABLE dbo.LegalEnquiryDeedSearch DROP CONSTRAINT [' + @c + N']');
SET @c = NULL;
SELECT @c = name FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.LegalEnquiryDeedSearch') AND definition LIKE N'%CalendarYear%';
IF @c IS NOT NULL EXEC(N'ALTER TABLE dbo.LegalEnquiryDeedSearch DROP CONSTRAINT [' + @c + N']');
GO
ALTER TABLE dbo.LegalEnquiryDeedSearch ADD CONSTRAINT CK_LegalEnquiryDeedSearch_Status
  CHECK (Status IN (N'Found', N'Not Found', N'Not Applicable', N'Under Review', N'Requested'));
ALTER TABLE dbo.LegalEnquiryDeedSearch ADD CONSTRAINT CK_LegalEnquiryDeedSearch_Year CHECK (CalendarYear BETWEEN 1800 AND 2200);
GO

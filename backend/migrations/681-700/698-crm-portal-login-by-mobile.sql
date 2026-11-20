-- 698: Customers sign in to the portal / Civilier Home with their registered mobile number (CrmCustomer.Mobile,
--  unique per active customer — UQ_CrmCustomer_Mobile), so a portal account no longer needs an email: the account's
--  Email becomes optional. Schema only; safe to re-run.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerPortalUser') AND name = 'Email' AND is_nullable = 0)
  ALTER TABLE dbo.CrmCustomerPortalUser ALTER COLUMN Email NVARCHAR(200) NULL;
GO

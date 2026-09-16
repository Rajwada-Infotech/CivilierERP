-- Migration 445: make CrmApplication.Mobile optional, matching the business
-- decision that a customer's own Mobile is no longer mandatory.
--
-- CrmCustomer.Mobile was already made nullable in migration 425, with its
-- unique index already filtered to exclude blank/null values (allows any
-- number of no-mobile customers to coexist — verified, no change needed
-- there). CrmApplication.Mobile was still NOT NULL (migration 149's
-- original definition), so an Application created for a mobile-less
-- customer would still hit a raw SQL constraint error even after the
-- Customer-side requirement was dropped. This closes that last gap so
-- "Mobile is optional" is actually true end-to-end, not just on the
-- Customer form.
--
-- Application code already handles a null Mobile gracefully downstream:
--   - crmEntityCreation.js no longer requires it (see createCrmApplicationRecord)
--   - crmPortalProvision.js already checks `if (!row.Mobile)` and returns a
--     clean "cannot provision portal login" result instead of crashing —
--     a customer with no mobile simply doesn't get a portal login, which is
--     the correct behavior (there's no mobile to use as the login credential).

IF EXISTS (
  SELECT 1 FROM sys.columns c
  JOIN sys.tables t ON t.object_id = c.object_id
  WHERE t.name = 'CrmApplication' AND c.name = 'Mobile' AND c.is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmApplication ALTER COLUMN Mobile NVARCHAR(20) NULL;
  PRINT 'CrmApplication.Mobile is now nullable.';
END
ELSE
BEGIN
  PRINT 'CrmApplication.Mobile is already nullable — nothing to do.';
END
GO

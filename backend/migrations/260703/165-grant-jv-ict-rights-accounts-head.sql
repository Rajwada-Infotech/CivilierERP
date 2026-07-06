-- Migration 165: Grant Journal Voucher + Inter-Company Transfer creation
-- rights to Sourav (accounts@civilier.in, UserId 9, role "Account's Head").
--
-- Per the concept: only Accounts Head logins may initiate a Journal
-- Voucher or an Inter-Company Stock Transfer; every one of them is then
-- approved by a super_admin login (already enforced in code via
-- MODULE_APPROVER_ROLE_OVERRIDES in backend/services/approvalService.js).
--
-- His rights are stored per-user (dbo.UserPageRightsJson), not via the
-- "Account's Head" role's RoleRights (which is currently empty), so this
-- adds the two missing entries to his existing JSON:
--   - "stock-transfers": had ["view","print"] -> adds "create"
--   - "journal-voucher": was entirely absent -> adds ["view","create"]
--
-- Guarded to only apply if his row still holds the exact JSON captured at
-- the time this migration was written, so it's a no-op (and visibly so)
-- if his rights changed via the Rights UI in the meantime.

DECLARE @UserId INT = 9;
DECLARE @ExpectedCurrentJson NVARCHAR(MAX) = N'[{"page":"trial-balance","actions":["view","create","edit","delete","print","export"]},{"page":"finance-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"new-payment","actions":["view","create","edit","delete","print","export"]},{"page":"received-payment","actions":["view","create","edit","delete","print","export"]},{"page":"brs","actions":["view","create","edit","delete","print","export"]},{"page":"records","actions":["view","create","edit","delete","print","export"]},{"page":"bank-master","actions":["view","create","edit","delete","print","export"]},{"page":"expenses-master","actions":["view","create","edit","delete","print","export"]},{"page":"financial-year-master","actions":[]},{"page":"cheque-master","actions":["view","create","edit","delete","print","export"]},{"page":"card-master","actions":["view","create","edit","delete","print","export"]},{"page":"tds-master","actions":["view","create","edit","delete","print","export"]},{"page":"account-head","actions":["view","create","edit","delete","print","export"]},{"page":"general-ledger","actions":["view","create","edit","delete","print","export"]},{"page":"billing-terms","actions":["view","create","edit","delete","print","export"]},{"page":"debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"material-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"grn-master","actions":["view","print"]},{"page":"vehicle-in-out","actions":["view","print"]},{"page":"expense-booking","actions":["view","create","edit","delete","print","export"]},{"page":"material-debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"purchase-orders","actions":["view","create","edit","delete","print","export"]},{"page":"stock-ledger","actions":["view","print"]},{"page":"stock-transfers","actions":["view","print"]},{"page":"t-c-master","actions":["view","create","edit","delete","print","export"]},{"page":"contractor-master","actions":["view","create","edit","delete","print","export"]},{"page":"supplier-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-group","actions":["view","create","edit","delete","print","export"]},{"page":"hsn-master","actions":["view","create","edit","delete","print","export"]},{"page":"unit-of-measurement","actions":["view","create","edit","delete","print","export"]},{"page":"sale-order","actions":["view","create","edit","delete"]},{"page":"sale-invoice","actions":["view","create"]},{"page":"sales-payment","actions":["view","create"]}]';
DECLARE @NewJson NVARCHAR(MAX) = N'[{"page":"trial-balance","actions":["view","create","edit","delete","print","export"]},{"page":"finance-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"new-payment","actions":["view","create","edit","delete","print","export"]},{"page":"received-payment","actions":["view","create","edit","delete","print","export"]},{"page":"brs","actions":["view","create","edit","delete","print","export"]},{"page":"records","actions":["view","create","edit","delete","print","export"]},{"page":"bank-master","actions":["view","create","edit","delete","print","export"]},{"page":"expenses-master","actions":["view","create","edit","delete","print","export"]},{"page":"financial-year-master","actions":[]},{"page":"cheque-master","actions":["view","create","edit","delete","print","export"]},{"page":"card-master","actions":["view","create","edit","delete","print","export"]},{"page":"tds-master","actions":["view","create","edit","delete","print","export"]},{"page":"account-head","actions":["view","create","edit","delete","print","export"]},{"page":"general-ledger","actions":["view","create","edit","delete","print","export"]},{"page":"billing-terms","actions":["view","create","edit","delete","print","export"]},{"page":"debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"material-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"grn-master","actions":["view","print"]},{"page":"vehicle-in-out","actions":["view","print"]},{"page":"expense-booking","actions":["view","create","edit","delete","print","export"]},{"page":"material-debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"purchase-orders","actions":["view","create","edit","delete","print","export"]},{"page":"stock-ledger","actions":["view","print"]},{"page":"stock-transfers","actions":["view","print","create"]},{"page":"t-c-master","actions":["view","create","edit","delete","print","export"]},{"page":"contractor-master","actions":["view","create","edit","delete","print","export"]},{"page":"supplier-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-group","actions":["view","create","edit","delete","print","export"]},{"page":"hsn-master","actions":["view","create","edit","delete","print","export"]},{"page":"unit-of-measurement","actions":["view","create","edit","delete","print","export"]},{"page":"sale-order","actions":["view","create","edit","delete"]},{"page":"sale-invoice","actions":["view","create"]},{"page":"sales-payment","actions":["view","create"]},{"page":"journal-voucher","actions":["view","create"]}]';

IF EXISTS (
  SELECT 1 FROM dbo.UserPageRightsJson
  WHERE UserId = @UserId AND IsActive = 1 AND RightsJson = @ExpectedCurrentJson
)
BEGIN
  UPDATE dbo.UserPageRightsJson
  SET RightsJson = @NewJson, UpdatedAt = GETDATE()
  WHERE UserId = @UserId;
  PRINT 'Updated: granted journal-voucher (view,create) and stock-transfers create to UserId 9';
END
ELSE
BEGIN
  PRINT 'Skipped: UserId 9 RightsJson has changed since this migration was written — check current rights via the Permission Editor and grant "journal-voucher" (view, create) and add "create" to "stock-transfers" manually.';
END
GO

SELECT UserId, RightsJson FROM dbo.UserPageRightsJson WHERE UserId = 9;
GO

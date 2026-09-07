-- dbo.SaleInvoices.SaleOrderID used to be constrained to only ever point
-- into dbo.CustomerSaleOrders (FK_SI_SaleOrder) — but createSaleInvoiceInternal
-- (routes/saleInvoices.js) legitimately creates invoices against TWO
-- different tables now: dbo.SaleOrders (the Sale Invoice page's own
-- "Generate Invoice" tab, sourced from the real Draft->Pending->Approved
-- Sale Order feature) and dbo.CustomerSaleOrders (the Inter-Company
-- Transfer orchestrator's own auto-created row). A single FK to one table
-- can't validate both, and every "Generate Invoice" attempt against a real
-- dbo.SaleOrders row was failing at INSERT with:
--   "The INSERT statement conflicted with the FOREIGN KEY constraint
--    'FK_SI_SaleOrder' ... table 'dbo.CustomerSaleOrders', column
--    'SaleOrderID'."
-- Referential integrity for whichever table a given invoice's SaleOrderID
-- actually points to is enforced in application code instead (both
-- createSaleInvoiceInternal branches SELECT the row before inserting).

IF EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SI_SaleOrder'
)
  ALTER TABLE dbo.SaleInvoices DROP CONSTRAINT FK_SI_SaleOrder;

-- Migration 568: a customer's GSTIN, when the buyer is GST-registered (a
-- company, firm or registered professional buying a property).
--
-- A tax invoice or credit note to a registered buyer must carry their GSTIN,
-- and it goes into a different part of GSTR-1 (B2B / CDNR, which the buyer
-- sees in their own GSTR-2B and claims input credit on) from one to an
-- individual (B2C / CDNUR). Empty for an individual buyer — nothing changes
-- for them. Checked (format, check digit, PAN inside it) by services/gstin.js.
IF COL_LENGTH('dbo.CrmCustomer', 'GstNo') IS NULL
  ALTER TABLE dbo.CrmCustomer ADD GstNo NVARCHAR(15) NULL;
GO

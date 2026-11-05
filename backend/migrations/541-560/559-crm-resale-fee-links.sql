-- Migration 559: the transfer fee of a resale case (migration 558).
--
-- CrmInvoice.ResaleId — the fee invoice belongs to the case: billed to the
-- NEW buyer (the booking is still the seller's when it is issued), with the
-- fee's own GST (a service, its own HSN / rate) rather than the property's.
-- ReceivedPayment.SourceCrmResaleId — the buyer's fee payment, approved in
-- Finance like any receipt, credits the buyer's own customer account (not a
-- name lookup, and not the booking's on-account money).

IF COL_LENGTH('dbo.CrmInvoice', 'ResaleId') IS NULL ALTER TABLE dbo.CrmInvoice ADD ResaleId INT NULL;
IF COL_LENGTH('dbo.ReceivedPayment', 'SourceCrmResaleId') IS NULL ALTER TABLE dbo.ReceivedPayment ADD SourceCrmResaleId INT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'FeeReceivedPaymentId') IS NULL ALTER TABLE dbo.CrmUnitResale ADD FeeReceivedPaymentId INT NULL;
GO

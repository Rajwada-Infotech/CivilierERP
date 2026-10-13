-- Migration 566: a credit note / refund voucher (migration 565) issued in
-- error is cancelled, never deleted — it keeps its number (the series stays
-- unbroken for the GST return), says who cancelled it and why, and a fresh
-- one can be issued for the same refund (ReplacesId points back).
IF COL_LENGTH('dbo.CrmGstNote', 'CancelledAt') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD CancelledAt DATETIME2 NULL, CancelledBy NVARCHAR(200) NULL, CancelReason NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.CrmGstNote', 'ReplacesId') IS NULL
  ALTER TABLE dbo.CrmGstNote ADD ReplacesId INT NULL;
GO

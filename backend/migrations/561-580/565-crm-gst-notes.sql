-- Migration 565: GST documents for money given back to a CRM customer.
--
-- GST on a CRM booking is charged when the money comes in (it sits as an
-- advance; an invoice later turns it into income). So when a refund is paid:
--   * the part of it that was never invoiced gets a REFUND VOUCHER
--     (CGST Act s.31(3)(e), Rule 51) against the receipts it came from;
--   * the part that was invoiced gets a CREDIT NOTE against each invoice
--     (s.34, Rule 53), declarable only until 30 November after the invoice's
--     financial year (or the annual return, if filed earlier). Past that it
--     is recorded as TimeBarred: no credit note can be issued, and the buyer
--     claims that GST from the department (Circular 188/20/2022).
-- Money kept as cancellation charges gets no document (its GST stays due).
-- One set per refund (services/crmGstNotes.js), issued when Finance's refund
-- payout is approved; nothing already on file is changed.
IF OBJECT_ID('dbo.CrmGstNote', 'U') IS NULL
CREATE TABLE dbo.CrmGstNote (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  DocNo NVARCHAR(16) NULL,                       -- Rule 51/53: unique per FY, at most 16 characters
  DocType NVARCHAR(20) NOT NULL,                 -- RefundVoucher | CreditNote
  Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmGstNote_Status DEFAULT N'Issued', -- Issued | TimeBarred
  RefundId INT NOT NULL,
  BookingId INT NOT NULL,
  CustomerId INT NULL,
  CompanyId INT NULL,
  ProjectId INT NULL,
  InvoiceId INT NULL,                            -- credit note: the invoice it reduces
  AgainstRef NVARCHAR(400) NULL,                 -- invoice no., or the receipts the money came from
  AgainstDate DATE NULL,
  DocDate DATE NOT NULL,
  TaxableValue DECIMAL(18,2) NOT NULL,
  GstRate DECIMAL(9,4) NULL,
  GstAmount DECIMAL(18,2) NOT NULL,
  TotalAmount DECIMAL(18,2) NOT NULL,
  DeadlineDate DATE NULL,                        -- credit note: last day it can be declared
  Remarks NVARCHAR(500) NULL,
  CreatedBy NVARCHAR(200) NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmGstNote_Created DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmGstNote_Refund' AND object_id = OBJECT_ID('dbo.CrmGstNote'))
  CREATE INDEX IX_CrmGstNote_Refund ON dbo.CrmGstNote (RefundId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmGstNote_Booking' AND object_id = OBJECT_ID('dbo.CrmGstNote'))
  CREATE INDEX IX_CrmGstNote_Booking ON dbo.CrmGstNote (BookingId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmGstNote_DocNo' AND object_id = OBJECT_ID('dbo.CrmGstNote'))
  CREATE UNIQUE INDEX UX_CrmGstNote_DocNo ON dbo.CrmGstNote (DocNo) WHERE DocNo IS NOT NULL;
GO

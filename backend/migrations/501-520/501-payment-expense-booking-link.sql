-- 501-payment-expense-booking-link.sql
--
-- Lets one Payment settle MULTIPLE ExpenseBooking invoices at once ("merge
-- invoices"), as long as they share the same Company, Project and supplier.
-- Until now dbo.NewPayment.PExpenseRef was a single NVARCHAR ref to exactly
-- one ExpenseBooking.EDocNo — a payment could only ever pay one invoice.
--
-- Mirrors dbo.ExpenseHeadAllocation's (migration 303) child-table pattern:
-- one row per (payment, invoice, amount), rows replaced wholesale on save.
-- A merged payment leaves PExpenseRef NULL and is identified by having rows
-- here instead; a normal single-invoice payment keeps using PExpenseRef as
-- before and never gets rows in this table. AllocatedAmount is that one
-- invoice's own full remaining balance (TDS already netted out) at the
-- moment the merge was made — full settlement only, no partial-merge
-- splitting (see Payment.tsx's merge picker).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PaymentExpenseBookingLink')
BEGIN
  CREATE TABLE dbo.PaymentExpenseBookingLink (
    LinkId            INT IDENTITY(1,1) PRIMARY KEY,
    PPaymentID        INT NOT NULL,
    ExpenseBookingId  INT NOT NULL,
    -- Snapshot, same convention as PExpenseRef elsewhere — survives even if
    -- the invoice's own EDocNo were ever renumbered, and lets every query
    -- that already matches payments by EDocNo string (syncBillStatus, the
    -- chain/history views) join against this table the same way.
    EDocNo            NVARCHAR(100) NOT NULL,
    AllocatedAmount   DECIMAL(18, 2) NOT NULL,
    -- This invoice's own TDS, carried along purely for display/audit on the
    -- merged payment's breakdown — TDS itself was already withheld as its
    -- own GL liability leg when the INVOICE was posted (see
    -- expenseBooking.js's post-to-gl), never re-touched here.
    TDSAmount         DECIMAL(18, 2) NOT NULL DEFAULT 0,
    CreatedAt         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PaymentExpenseBookingLink_Payment FOREIGN KEY (PPaymentID)
      REFERENCES dbo.NewPayment(PPaymentID) ON DELETE CASCADE,
    CONSTRAINT FK_PaymentExpenseBookingLink_ExpenseBooking FOREIGN KEY (ExpenseBookingId)
      REFERENCES dbo.ExpenseBooking(Eid)
  );

  CREATE INDEX IX_PaymentExpenseBookingLink_Payment ON dbo.PaymentExpenseBookingLink(PPaymentID);
  CREATE INDEX IX_PaymentExpenseBookingLink_ExpenseBooking ON dbo.PaymentExpenseBookingLink(ExpenseBookingId);
  CREATE INDEX IX_PaymentExpenseBookingLink_EDocNo ON dbo.PaymentExpenseBookingLink(EDocNo);

  PRINT 'Created dbo.PaymentExpenseBookingLink.';
END
ELSE
BEGIN
  PRINT 'dbo.PaymentExpenseBookingLink already exists — skipping.';
END
GO

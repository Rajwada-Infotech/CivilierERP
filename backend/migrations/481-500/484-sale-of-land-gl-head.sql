-- Migration 484: GL head for recognising income from the sale of LAND.
--
-- Land and construction are two different revenue streams and must never
-- share an income head. The sale of land is outside GST altogether
-- (Schedule III, CGST Act — neither a supply of goods nor of services),
-- whereas building and selling a flat or villa is a taxable supply. Keeping
-- them in one head would make it impossible to reconcile the P&L against
-- the GST returns, because part of the turnover in that head would carry no
-- output tax by design and there would be nothing to show why.
--
-- Mirrors migration 472's 'Sale of Flat/Parking' exactly, including its
-- classification: land sales in a plotted development ARE the company's core
-- operating revenue, so REVENUE FROM OPERATIONS (Code 'RO'), not OTHER INCOME.
--
-- The recognition rule is unchanged from 472 and applies identically here:
-- receipts sit in Advance from Customer until the full consideration is
-- collected, and generating the invoice is what moves it —
-- Dr Advance from Customer / Cr Sale of Land. Which of the two income heads
-- gets credited is decided by what the booking actually sold (UnitKind on its
-- units, migration 483), never by the project's type.

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Sale of Land' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated, LBelongsTo)
  VALUES
    ('Sale of Land', 'CRM-SALE-LAND', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1,
     (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'RO'));
  PRINT 'Seeded GL head: Sale of Land';
END
ELSE PRINT 'GL head "Sale of Land" already exists — skipping';
GO

-- 155: Rename Expense Booking doc prefixes from ExB to INV
-- Invoice page moved to Finance module; prefix updated to INV to match.

UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV',     Prefix = 'INV'     WHERE DocNoPrefix = 'ExB';
UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV-PO',  Prefix = 'INV-PO'  WHERE DocNoPrefix = 'ExB-PO';
UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV-WO',  Prefix = 'INV-WO'  WHERE DocNoPrefix = 'ExB-WO';
UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV-GRN', Prefix = 'INV-GRN' WHERE DocNoPrefix = 'ExB-GRN';

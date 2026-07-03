-- 155: Rename Expense Booking doc prefixes from ExB to INV
-- Invoice page moved to Finance module; prefix updated to INV to match.

UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV',     DocType = 'INV'     WHERE DocNoPrefix = 'ExB';
UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV-PO',  DocType = 'INV-PO'  WHERE DocNoPrefix = 'ExB-PO';
UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV-WO',  DocType = 'INV-WO'  WHERE DocNoPrefix = 'ExB-WO';
UPDATE dbo.TypeOfDoc SET DocNoPrefix = 'INV-GRN', DocType = 'INV-GRN' WHERE DocNoPrefix = 'ExB-GRN';

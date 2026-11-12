-- Migration 636: vendors (Vendor Master: LHeadType 'S' Supplier / Landlord, 'V' Vendor) have no approval stage.
-- New ones are saved as Active (routes/accountHeadMaster.js); this moves existing ones out of Draft / Pending /
-- Rejected / Approved into the same Active state. Status is only the workflow field — LHeadStatus (active/inactive) is
-- untouched, so nobody's vendor is switched on or off by this.
UPDATE dbo.AccountHeadMaster
SET Status = 'Active'
WHERE RTRIM(LHeadType) IN ('S', 'V') AND ISNULL(Status, '') <> 'Active';
GO

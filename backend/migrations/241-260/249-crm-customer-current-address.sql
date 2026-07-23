-- crmCustomers.js/CrmCustomers.tsx already read/write a Current-address
-- block (separate from the existing Permanent Address/City/State/Pincode
-- columns) plus a same-as-permanent toggle, but the columns were never
-- created — every request against dbo.CrmCustomer has been failing with
-- "Invalid column name 'IsCurrentSameAsPermanent'" (500), which is why the
-- Customers list showed empty.
ALTER TABLE dbo.CrmCustomer ADD
  CurrentAddress NVARCHAR(500) NULL,
  CurrentCity NVARCHAR(100) NULL,
  CurrentState NVARCHAR(100) NULL,
  CurrentPincode NVARCHAR(10) NULL,
  IsCurrentSameAsPermanent BIT NOT NULL DEFAULT 1;
GO

-- Backfill existing rows so IsCurrentSameAsPermanent=1 rows already have a
-- real Current* value instead of NULL, matching resolveCurrentAddress()'s
-- guarantee for every row created/edited going forward.
UPDATE dbo.CrmCustomer SET
  CurrentAddress = Address, CurrentCity = City, CurrentState = State, CurrentPincode = Pincode;

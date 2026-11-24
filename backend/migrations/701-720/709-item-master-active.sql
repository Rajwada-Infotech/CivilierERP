-- Item Master: an item can be disabled (M_IsActive = 0). A disabled item keeps its history and still shows on
-- existing documents, but is no longer offered in the item pickers of new Material Requests, POs, Work Orders,
-- Expense Bookings or activity item links.
IF COL_LENGTH('dbo.Item_Master_Group', 'M_IsActive') IS NULL
  ALTER TABLE dbo.Item_Master_Group ADD M_IsActive BIT NOT NULL CONSTRAINT DF_Item_Master_Group_M_IsActive DEFAULT (1);

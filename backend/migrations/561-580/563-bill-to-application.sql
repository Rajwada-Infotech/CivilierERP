-- Migration 563: a maintenance / electricity bill remembers who it was billed to.
--
-- Bills found their customer through the booking's CURRENT application, so
-- once a property changed hands (a resale, or an ownership change after the
-- sale deed — migration 562) the previous owner's bills showed the new
-- owner's name. BillToApplicationId is the application the bill was raised
-- on: new bills set it; existing bills keep NULL (= the booking's current
-- owner, unchanged) and are stamped with the previous owner's application at
-- the moment a booking moves (services/crmResaleTransfer.js
-- moveBookingToCustomer). Nothing already on file is rewritten here.
IF COL_LENGTH('dbo.MaintenanceBill', 'BillToApplicationId') IS NULL
  ALTER TABLE dbo.MaintenanceBill ADD BillToApplicationId INT NULL;
IF OBJECT_ID('dbo.ElectricityBill', 'U') IS NOT NULL AND COL_LENGTH('dbo.ElectricityBill', 'BillToApplicationId') IS NULL
  ALTER TABLE dbo.ElectricityBill ADD BillToApplicationId INT NULL;
GO

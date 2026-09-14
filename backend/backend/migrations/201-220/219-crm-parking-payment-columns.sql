-- Standalone parking sales (BookingId IS NULL) have no CrmPaymentMilestone/
-- CrmPaymentReceipt to hang payment details off of — PUT /mark-paid just
-- flipped PaymentStatus with zero payment metadata and zero GL trail. These
-- columns let it record a real receipt (mode/date/doc no) the same way
-- every other CRM payment does.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'PaymentMode')
  ALTER TABLE dbo.CrmParkingAllotment ADD PaymentMode NVARCHAR(50) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'PaymentReceivedDate')
  ALTER TABLE dbo.CrmParkingAllotment ADD PaymentReceivedDate DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'ReceiptNo')
  ALTER TABLE dbo.CrmParkingAllotment ADD ReceiptNo NVARCHAR(30) NULL;
GO

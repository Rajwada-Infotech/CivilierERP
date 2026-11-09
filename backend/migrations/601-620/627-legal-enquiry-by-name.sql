-- 627: Land Enquiry "Enquiry by" — the name of whoever brought the enquiry (typed; any person). The logged-in user who
-- saves it is "Entry by" (CreatedBy), reached on their WhatsApp number. Schema only.
IF COL_LENGTH('dbo.LegalLandEnquiry', 'EnquiryByName') IS NULL
  ALTER TABLE dbo.LegalLandEnquiry ADD EnquiryByName NVARCHAR(150) NULL;

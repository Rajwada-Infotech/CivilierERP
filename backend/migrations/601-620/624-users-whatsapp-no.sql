-- 624: a WhatsApp number on each user, so others can chat with whoever created a record
-- (first used by Legal → Land Enquiries / Land Register: "Enquiry by" with a WhatsApp link). Schema only.
IF COL_LENGTH('dbo.users', 'WhatsAppNo') IS NULL
  ALTER TABLE dbo.users ADD WhatsAppNo NVARCHAR(20) NULL;

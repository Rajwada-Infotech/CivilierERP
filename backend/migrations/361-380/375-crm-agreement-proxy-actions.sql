-- Migration 375: Staff proxy actions on behalf of non-portal customers
-- Adds ProxyMethod to the approval log so staff can record HOW a customer
-- communicated their decision (Phone, InPerson, Email, WhatsApp, Other)
-- without the customer ever needing to log into the portal.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmAgreementApprovalLog') AND name = 'ProxyMethod'
)
BEGIN
  ALTER TABLE dbo.CrmAgreementApprovalLog
    ADD ProxyMethod  NVARCHAR(30)  NULL,  -- Phone/InPerson/Email/WhatsApp/Other
        ProxyCreatedBy INT         NULL REFERENCES dbo.Users(id);
  PRINT 'Added ProxyMethod, ProxyCreatedBy to dbo.CrmAgreementApprovalLog';
END
GO

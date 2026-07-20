-- Broker selection now starts at the Customer record — the same broker who
-- brought in the customer, rather than being picked fresh on every
-- Application. CrmApplication.BrokerId (added in 203) is still the field the
-- rest of the workflow (Booking, CrmBrokerageMaster) actually reads; this
-- column is only the origin point that auto-fills it, mirroring how
-- CrmCustomer.LeadId auto-fills the Application's Source chain today.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomer') AND name = 'BrokerId')
  ALTER TABLE dbo.CrmCustomer ADD BrokerId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
GO

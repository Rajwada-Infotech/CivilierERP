-- Migration 163: Seed the "Dummy Bank" system ledger head
--
-- backend/routes/receivedPayment.js and backend/routes/newPayment.js both
-- look up a bank via:
--   SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster
--   WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'
--
-- No such row exists in this DB (confirmed via live query — zero rows
-- match LHeadCode/LHeadName LIKE '%dummy%'), so both the existing
-- Sale-Invoice-sourced Received Payment flow and the new Inter-Company
-- Stock Transfer feature's payment legs 500 with "Dummy Bank account not
-- found" whenever exercised.
--
-- This is NOT a real bank account — it is a purely internal ledger head
-- used to close the double-entry bookkeeping for system-generated,
-- no-real-cash-movement transactions (inter-company stock transfers,
-- sale-order Cash payments settled internally). No real money moves
-- through it; it exists so the GL/approval workflow can complete without
-- requiring an actual bank transaction between two separate companies.
--
-- Note: real bank rows in this table use Status='Active' (see e.g. "State
-- Bank of India"), but the two lookup queries above specifically filter on
-- Status='Approved' — this row must match that literal value to be found.

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK')
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadCode,
     LHeadStatus, Status, LCountry, LDescription, CreatedBy, CreatedAt)
  VALUES
    ('Dummy Bank (System)', 'N/A', 'B', 'N/A', 'DUMMY-BANK',
     1, 'Approved', 'India',
     'Internal-only ledger head for system-generated transactions (Inter-Company Stock Transfer, Sale Order Cash payments) that must close the GL without a real bank transaction. Not a real bank account.',
     'migration', GETDATE());

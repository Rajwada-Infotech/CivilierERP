-- Backfills dbo.CancelledCheque.BankName/AccountNumber for rows written before
-- the fix to backend/routes/chequeCancellation.js — that route was joining
-- dbo.BankMaster (a legacy, unpopulated table) to resolve a cheque's bank,
-- instead of dbo.AccountHeadMaster (the real bank ledger table every other
-- route — newPayment.js, chequeMaster.js, bankMaster.js — already joins on).
-- The join always returned NULL, so every cancellation recorded a BankId but
-- no BankName, which is why the Cancelled Cheques list shows a blank Bank
-- column. BankId itself was captured correctly (it's copied straight from
-- np.PBankID / cm.BankId, both already AccountHeadMaster.LHeadId values), so
-- this only needs to re-resolve the display name from it — no data was lost.

UPDATE cc
SET cc.BankName = ahm.LHeadName
FROM dbo.CancelledCheque cc
JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = cc.BankId
WHERE cc.BankId IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(ISNULL(cc.BankName, ''))), '') IS NULL;
GO

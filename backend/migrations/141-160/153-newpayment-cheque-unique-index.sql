-- Migration 153: enforce cheque-number uniqueness on NewPayment
--
-- Before this, the same physical cheque number could be assigned to two
-- payments: /deduct-cheque and the create path do a check-then-insert with
-- no transaction and no DB constraint, so two concurrent requests both pass
-- the "already used?" check and both insert the same (lot, number). This
-- index makes a duplicate physically impossible.
--
-- Filtered: only rows where BOTH a lot and a number are present participate,
-- so the many payments that are not cheque-based (NULL cheque fields) are
-- unaffected and can coexist freely.
--
-- Safety: if legacy duplicates already exist the CREATE would fail with an
-- opaque error mid-deploy. We detect them first and RAISERROR with the
-- offending (lot, number) pairs so an operator can reconcile them before the
-- constraint goes on. This is intentional — a silent skip would leave the
-- guarantee unenforced.

IF EXISTS (
  SELECT 1
  FROM dbo.NewPayment
  WHERE PChequeLotId IS NOT NULL AND PChequeNo IS NOT NULL
  GROUP BY PChequeLotId, PChequeNo
  HAVING COUNT(*) > 1
)
BEGIN
  -- Build the list in two steps: COUNT(*) cannot be nested directly inside
  -- STRING_AGG (SQL Server rejects an aggregate of an aggregate), so the
  -- per-pair counts are computed in a derived table first, then aggregated.
  DECLARE @dupes NVARCHAR(MAX);
  SELECT @dupes = STRING_AGG(txt, '; ')
  FROM (
    SELECT CONCAT('lot ', PChequeLotId, ' / cheque ', PChequeNo, ' (x', COUNT(*), ')') AS txt
    FROM dbo.NewPayment
    WHERE PChequeLotId IS NOT NULL AND PChequeNo IS NOT NULL
    GROUP BY PChequeLotId, PChequeNo
    HAVING COUNT(*) > 1
  ) d;
  RAISERROR(
    'Cannot add cheque-uniqueness index: duplicate cheque assignments exist and must be reconciled first -> %s',
    16, 1, @dupes
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_NewPayment_ChequeLot_ChequeNo'
    AND object_id = OBJECT_ID('dbo.NewPayment')
)
BEGIN
  CREATE UNIQUE INDEX UX_NewPayment_ChequeLot_ChequeNo
    ON dbo.NewPayment (PChequeLotId, PChequeNo)
    WHERE PChequeLotId IS NOT NULL AND PChequeNo IS NOT NULL;
  PRINT 'Created unique index UX_NewPayment_ChequeLot_ChequeNo';
END
ELSE
  PRINT 'UX_NewPayment_ChequeLot_ChequeNo already exists - skipping';
GO

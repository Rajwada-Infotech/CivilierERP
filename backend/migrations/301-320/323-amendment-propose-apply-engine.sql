-- Migration 323: Amendment redesign — replace the free-text "type old/new
-- values manually" popup with a real propose→approve→apply engine that
-- reuses the document's own edit form.
--
-- ProposedChanges carries the exact field/value map the document's own PUT
-- route would have written (JSON) — captured at propose time, applied
-- verbatim on approval. AmendmentLineChanges keeps working as the diff
-- audit trail, just auto-computed now instead of hand-typed by the user.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Amendments') AND name = 'ProposedChanges'
)
BEGIN
  ALTER TABLE dbo.Amendments ADD ProposedChanges NVARCHAR(MAX) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Amendments') AND name = 'AppliedAt'
)
BEGIN
  ALTER TABLE dbo.Amendments ADD AppliedAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Amendments') AND name = 'ApplyError'
)
BEGIN
  -- Applying (writing ProposedChanges back to the source doc + GL
  -- reverse/repost) happens AFTER the approval status commit, same
  -- "never block the approval on a downstream side-effect" discipline
  -- generalLedger.js already uses for GL posting. If apply fails, the
  -- amendment stays Approved (the approval decision itself is real) but
  -- this column records why the underlying document was never actually
  -- updated, so it's discoverable instead of silently lost.
  ALTER TABLE dbo.Amendments ADD ApplyError NVARCHAR(500) NULL;
END
GO

PRINT '323-amendment-propose-apply-engine applied successfully.';
GO

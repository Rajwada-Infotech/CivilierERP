-- Migration 484: Civil Work DPR Quality Check — rate each checkpoint Poor/
-- Good/Excellent instead of a plain Pass/Fail toggle. Passed is kept (and
-- still drives the existing approve-requires-all-passed rule) but is now
-- derived from Rating: Poor -> failed, Good/Excellent -> passed. Any Poor
-- rating forces the whole decision to Rework — enforced in the decision
-- route, not just the UI.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityQcCheck') AND name = 'Rating'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityQcCheck ADD Rating NVARCHAR(10) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityQcCheck_Rating')
BEGIN
  ALTER TABLE dbo.DependencyActivityQcCheck
    ADD CONSTRAINT CK_DependencyActivityQcCheck_Rating CHECK (Rating IN ('POOR', 'GOOD', 'EXCELLENT'));
END
GO

PRINT '484-qc-check-rating applied successfully.';
GO

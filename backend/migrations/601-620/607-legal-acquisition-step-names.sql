-- 607 · The land pipeline is the company acquiring a land; selling it is a separate section.
-- Steps that still said "Purchase / Sale" or "Receipt" now read as purchase steps.
SET NOCOUNT ON;
GO

DECLARE @n TABLE (Code NVARCHAR(40), NewName NVARCHAR(100));
INSERT INTO @n VALUES
  (N'PURCHASE_SALE', N'Purchase Details'),
  (N'AGREEMENT', N'Purchase Agreement'),
  (N'PARTY_APPROVAL', N'Seller & Buyer Consent'),
  (N'PAYMENT', N'Purchase Payment & Advance');

-- Lands currently on one of these steps show the new name too.
UPDATE l SET WorkflowStatus = n.NewName
FROM dbo.LegalLand l JOIN dbo.LegalWorkflowStep s ON s.StepName = l.WorkflowStatus JOIN @n n ON n.Code = s.StepCode;
UPDATE s SET StepName = n.NewName FROM dbo.LegalWorkflowStep s JOIN @n n ON n.Code = s.StepCode;
GO

PRINT '607-legal-acquisition-step-names applied successfully.';
GO

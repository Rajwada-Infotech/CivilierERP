-- Migration 434: Offer Letter — DesignationId, reusing the existing
-- dbo.DesignationMaster (same master Interview/Candidate flows don't
-- currently touch, but Offer Letter needs it to state the role being
-- offered) rather than a free-text field or a second designation list.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.OfferLetter') AND name = 'DesignationId'
)
BEGIN
  ALTER TABLE dbo.OfferLetter ADD DesignationId INT NULL;
  ALTER TABLE dbo.OfferLetter ADD CONSTRAINT FK_OfferLetter_Designation
    FOREIGN KEY (DesignationId) REFERENCES dbo.DesignationMaster(Id);
  CREATE INDEX IX_OfferLetter_DesignationId ON dbo.OfferLetter(DesignationId);
END
GO

PRINT '434-offer-letter-designation applied successfully.';
GO

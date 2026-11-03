-- 605 · A land's RS / LR records linked to the RS Khatian, RS Plot and LR RoR registers.
--   LegalLandRsRecord: RsKhatianId, RsPlotId   LegalLandLrRecord: LrRorId   (optional links)
-- Existing records are linked where the Mouza and Khatian / Dag numbers match a register entry.
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.LegalLandRsRecord', 'RsKhatianId') IS NULL ALTER TABLE dbo.LegalLandRsRecord ADD RsKhatianId INT NULL, RsPlotId INT NULL;
IF COL_LENGTH('dbo.LegalLandLrRecord', 'LrRorId') IS NULL ALTER TABLE dbo.LegalLandLrRecord ADD LrRorId INT NULL;
GO
IF OBJECT_ID('dbo.FK_LegalLandRsRecord_RsKhatianId', 'F') IS NULL
  ALTER TABLE dbo.LegalLandRsRecord ADD CONSTRAINT FK_LegalLandRsRecord_RsKhatianId FOREIGN KEY (RsKhatianId) REFERENCES dbo.LegalRsKhatian(RsKhatianId);
IF OBJECT_ID('dbo.FK_LegalLandRsRecord_RsPlotId', 'F') IS NULL
  ALTER TABLE dbo.LegalLandRsRecord ADD CONSTRAINT FK_LegalLandRsRecord_RsPlotId FOREIGN KEY (RsPlotId) REFERENCES dbo.LegalRsPlot(RsPlotId);
IF OBJECT_ID('dbo.FK_LegalLandLrRecord_LrRorId', 'F') IS NULL
  ALTER TABLE dbo.LegalLandLrRecord ADD CONSTRAINT FK_LegalLandLrRecord_LrRorId FOREIGN KEY (LrRorId) REFERENCES dbo.LegalLrRor(LrRorId);
GO

UPDATE r SET RsKhatianId = k.RsKhatianId
FROM dbo.LegalLandRsRecord r JOIN dbo.LegalRsKhatian k ON k.MouzaId = r.MouzaId AND k.KhatianNo = r.RsKhatianNo
WHERE r.RsKhatianId IS NULL;
UPDATE r SET RsPlotId = p.RsPlotId
FROM dbo.LegalLandRsRecord r JOIN dbo.LegalRsPlot p ON p.MouzaId = r.MouzaId AND p.PlotNo = r.RsDagNo
WHERE r.RsPlotId IS NULL;
UPDATE r SET LrRorId = x.LrRorId
FROM dbo.LegalLandLrRecord r JOIN dbo.LegalLrRor x ON x.MouzaId = r.MouzaId AND x.LrKhatianNo = r.LrKhatianNo AND x.LrPlotNo = r.LrDagNo
WHERE r.LrRorId IS NULL;
GO

PRINT '605-legal-link-land-records-to-registers applied successfully.';
GO

-- Migration 577: OC / CC worked out block by block, the project from its blocks.
--
-- Rules (one place - every screen, gate and the GST exemption read these views):
--  * A block has OC/CC when it has its own Received certificate, or a Received
--    project-wide certificate COVERS it.
--  * A project-wide certificate covers the blocks that existed when it was
--    received (CrmOccupancyCertificateBlock). A block added later is not
--    covered - it needs its own certificate.
--  * A project has OC/CC when every active block has it (automatically - no
--    separate record). A new block puts the project back to "not yet" until
--    that block's certificate arrives. A project with no blocks uses its
--    project-wide certificate, as before.
--  * A booking is cleared when its own block(s) have it (unit's block and any
--    plot's block); a booking with no block follows the project.
--
-- Nothing changes for existing data: every Received project-wide certificate
-- is backfilled to cover all the blocks that exist today, so each booking that
-- was cleared stays cleared, with the same date. Safe to run again.

IF OBJECT_ID(N'dbo.CrmOccupancyCertificateBlock', N'U') IS NULL
  CREATE TABLE dbo.CrmOccupancyCertificateBlock (
    CertificateId INT NOT NULL,
    BlockId       INT NOT NULL,
    CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_CrmOccCertBlock_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT PK_CrmOccupancyCertificateBlock PRIMARY KEY (CertificateId, BlockId)
  );
GO

INSERT INTO dbo.CrmOccupancyCertificateBlock (CertificateId, BlockId)
SELECT oc.Id, bm.Id
FROM dbo.CrmOccupancyCertificate oc
JOIN dbo.BlockMaster bm ON bm.ProjectId = oc.ProjectId
WHERE oc.BlockId IS NULL AND oc.Status = 'Received'
  AND NOT EXISTS (SELECT 1 FROM dbo.CrmOccupancyCertificateBlock cb WHERE cb.CertificateId = oc.Id AND cb.BlockId = bm.Id);
GO

-- Per block (active or not): is it covered, and from when. A block's own
-- certificate date wins, as the old gate did; else the covering project
-- certificate's date.
CREATE OR ALTER VIEW dbo.vw_CrmBlockOcCc AS
SELECT bm.Id AS BlockId, bm.ProjectId, bm.BlockName, bm.IsActive,
       CASE WHEN own.Has = 1 OR proj.Has = 1 THEN 1 ELSE 0 END AS Covered,
       CASE WHEN own.Has = 1 THEN 'block' WHEN proj.Has = 1 THEN 'project' ELSE NULL END AS Source,
       CASE WHEN own.Has = 1 THEN own.D ELSE proj.D END AS CoveredDate,
       CASE WHEN own.Has = 1 THEN own.CertId ELSE proj.CertId END AS CertificateId
FROM dbo.BlockMaster bm
OUTER APPLY (
  SELECT TOP 1 1 AS Has, oc.ReceivedDate AS D, oc.Id AS CertId
  FROM dbo.CrmOccupancyCertificate oc
  WHERE oc.BlockId = bm.Id AND oc.Status = 'Received'
  ORDER BY oc.ReceivedDate ASC
) own
OUTER APPLY (
  SELECT TOP 1 1 AS Has, oc.ReceivedDate AS D, oc.Id AS CertId
  FROM dbo.CrmOccupancyCertificate oc
  JOIN dbo.CrmOccupancyCertificateBlock cb ON cb.CertificateId = oc.Id
  WHERE cb.BlockId = bm.Id AND oc.BlockId IS NULL AND oc.Status = 'Received'
  ORDER BY oc.ReceivedDate ASC
) proj;
GO

-- Per project: received when every ACTIVE block is covered (date = when the
-- last one was); a project without blocks uses its project-wide certificate.
CREATE OR ALTER VIEW dbo.vw_CrmProjectOcCc AS
SELECT p.ProjectId,
       ISNULL(b.ActiveBlocks, 0) AS ActiveBlocks,
       ISNULL(b.CoveredBlocks, 0) AS CoveredBlocks,
       CASE WHEN ISNULL(b.ActiveBlocks, 0) > 0
            THEN CASE WHEN b.CoveredBlocks = b.ActiveBlocks THEN 1 ELSE 0 END
            ELSE CASE WHEN bl.Has = 1 THEN 1 ELSE 0 END END AS Received,
       CASE WHEN ISNULL(b.ActiveBlocks, 0) > 0
            THEN CASE WHEN b.CoveredBlocks = b.ActiveBlocks THEN b.LastDate END
            ELSE bl.D END AS ReceivedDate,
       CASE WHEN ISNULL(b.ActiveBlocks, 0) > 0 THEN 'blocks' ELSE 'project' END AS Basis
FROM (
  SELECT ProjectId FROM dbo.BlockMaster WHERE ProjectId IS NOT NULL
  UNION
  SELECT ProjectId FROM dbo.CrmOccupancyCertificate WHERE ProjectId IS NOT NULL
) p
OUTER APPLY (
  SELECT COUNT(*) AS ActiveBlocks, SUM(v.Covered) AS CoveredBlocks, MAX(v.CoveredDate) AS LastDate
  FROM dbo.vw_CrmBlockOcCc v WHERE v.ProjectId = p.ProjectId AND v.IsActive = 1
) b
OUTER APPLY (
  SELECT TOP 1 1 AS Has, oc.ReceivedDate AS D
  FROM dbo.CrmOccupancyCertificate oc
  WHERE oc.ProjectId = p.ProjectId AND oc.BlockId IS NULL AND oc.Status = 'Received'
  ORDER BY oc.ReceivedDate ASC
) bl;
GO

-- Per booking: its blocks are the unit's block plus any active plot's block.
CREATE OR ALTER VIEW dbo.vw_CrmBookingOcCc AS
SELECT bk.Id AS BookingId, bk.ProjectId,
       ISNULL(x.BlockCount, 0) AS BlockCount,
       CASE WHEN ISNULL(x.BlockCount, 0) > 0
            THEN CASE WHEN x.CoveredCount = x.BlockCount THEN 1 ELSE 0 END
            ELSE ISNULL(pv.Received, 0) END AS Received,
       CASE WHEN ISNULL(x.BlockCount, 0) > 0
            THEN CASE WHEN x.CoveredCount = x.BlockCount THEN x.LastDate END
            ELSE pv.ReceivedDate END AS ReceivedDate,
       CASE WHEN ISNULL(x.BlockCount, 0) > 0 THEN 'block' ELSE 'project' END AS Source
FROM dbo.CrmBooking bk
OUTER APPLY (
  SELECT COUNT(*) AS BlockCount, SUM(ISNULL(v.Covered, 0)) AS CoveredCount, MAX(v.CoveredDate) AS LastDate
  FROM (
    SELECT um.BlockId FROM dbo.UnitMaster um WHERE um.Id = bk.UnitId AND um.BlockId IS NOT NULL
    UNION
    SELECT pm.BlockId FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId
    WHERE bp.BookingId = bk.Id AND bp.Status = N'Active' AND pm.BlockId IS NOT NULL
  ) blocks
  LEFT JOIN dbo.vw_CrmBlockOcCc v ON v.BlockId = blocks.BlockId
) x
LEFT JOIN dbo.vw_CrmProjectOcCc pv ON pv.ProjectId = bk.ProjectId;
GO

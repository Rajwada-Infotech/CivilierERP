-- Migration 353: Blueprint Annotation revision history — the Activity
-- Detail modal's Blueprint tab lets a user step back through past markup
-- states ("◀ Rev N ▶"), but dbo.ActivityBlueprintAnnotation (migration 345)
-- only ever holds the CURRENT state — every save UPDATEs that one row in
-- place, so nothing before the latest save survives.
--
-- This table archives what a save is about to overwrite: right before the
-- PUT /:rungId/blueprint-annotation route updates the live row, it inserts
-- the row's pre-update ShapesJson/Thumbnail/Version/UpdatedBy/UpdatedAt
-- here first. The live row itself is always the current/highest version;
-- this table holds every version before it.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ActivityBlueprintAnnotationHistory' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ActivityBlueprintAnnotationHistory (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    AnnotationId  INT NOT NULL,
    Version       INT NOT NULL,
    ShapesJson    NVARCHAR(MAX) NULL,
    ThumbnailBase64 NVARCHAR(MAX) NULL,
    UpdatedBy     NVARCHAR(200) NULL,
    UpdatedAt     DATETIME2(3) NULL,
    CONSTRAINT FK_ActivityBlueprintAnnotationHistory_Annotation
      FOREIGN KEY (AnnotationId) REFERENCES dbo.ActivityBlueprintAnnotation(Id) ON DELETE CASCADE,
    CONSTRAINT UX_ActivityBlueprintAnnotationHistory_Annotation_Version UNIQUE (AnnotationId, Version)
  );
END
GO

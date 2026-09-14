-- Migration 193: Ad creative file uploads + keypoints
-- ImageUrl/VideoUrl/MediaUrls on dbo.SaAd were plain text fields — staff
-- had to paste an already-hosted URL, with no way to actually upload the
-- creative (image/video) from this system. Adds a real per-ad attachment
-- table (mirrors dbo.CrmBookingAttachment's shape/pattern exactly) plus a
-- Keypoints column for the ad-copy talking points the spec calls out
-- ("image, video, keypoint(words) management generation [upload] sections").

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaAd') AND name = 'Keypoints')
BEGIN
  ALTER TABLE dbo.SaAd ADD Keypoints NVARCHAR(MAX) NULL;
  PRINT 'Added SaAd.Keypoints';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaAdCreative' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaAdCreative (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    AdId        INT           NOT NULL REFERENCES dbo.SaAd(Id),
    MediaType   NVARCHAR(20)  NOT NULL,  -- 'Image' | 'Video'
    Label       NVARCHAR(200) NULL,
    FileName    NVARCHAR(300) NOT NULL,
    StoredName  NVARCHAR(300) NOT NULL,
    FileSize    INT           NULL,
    MimeType    NVARCHAR(150) NULL,
    UploadedBy  INT           NULL,
    UploadedAt  DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_SaAdCreative_Ad ON dbo.SaAdCreative(AdId);
  PRINT 'Created dbo.SaAdCreative';
END
GO

PRINT '193-sa-ad-creatives-keypoints: done';

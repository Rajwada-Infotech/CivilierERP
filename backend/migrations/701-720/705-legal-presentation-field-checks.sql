-- Legal presentation data (704): show the field-by-field ✓ / ✗ verification on DEMO/00001.
--   Basic Information  ✓ on every field except the address and LR Dag (not marked yet) → Pending
--   Ownership History  ✓ on every field                                                → Verified
--   Acquisition        ✓ except the transfer value, marked ✗                          → Verified · 1 ✗ wrong
--   Land Records       ✓ except the LR record holder, marked ✗                          → Verified · ✗ wrong
--   the other sections not started                                                     → Pending
-- The app turns these into field decisions the first time the land is opened (landFlow.js healPlaceholders).
UPDATE r SET ChecksJson =
  N'{"basic":{"auto":"ok","pending":["LocationAddress","LrDagNo"],"by":"Verifier","at":"' + CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127) + N'"},'
  + N'"ownership":{"auto":"ok","by":"Verifier","at":"' + CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127) + N'"},'
  + N'"acquisition":{"auto":"ok","bad":["TransferValue"],"by":"Verifier","at":"' + CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127) + N'"},'
  + N'"records":{"auto":"ok","bad":["RecordedHolder"],"by":"Verifier","at":"' + CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127) + N'"}}'
FROM dbo.LegalLandReview r JOIN dbo.LegalLand l ON l.LandId = r.LandId
WHERE l.LandCode = N'DEMO/00001/2026-27' AND r.Status = N'Verifying';
GO
-- Approved / submitted demo versions: every field marked — ✓ on filled fields, N/A on empty ones (shown in the versions).
DECLARE @At NVARCHAR(30) = CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127);
DECLARE @All NVARCHAR(MAX) = N'{' + STUFF((SELECT N',"' + k + N'":{"auto":"ok","by":"Verifier","at":"' + @At + N'"}'
  FROM (VALUES (N'basic'),(N'ownership'),(N'acquisition'),(N'records'),(N'legal'),(N'loans'),(N'mutation'),(N'payments'),(N'tax'),(N'survey'),(N'documents'),(N'photos')) v(k)
  FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, N'') + N'}';
UPDATE r SET ChecksJson = @All
FROM dbo.LegalLandReview r JOIN dbo.LegalLand l ON l.LandId = r.LandId
WHERE l.LandCode LIKE N'DEMO/%' AND r.Status IN (N'Approved', N'Submitted');
GO
-- New route: the verifier's own "Verify & save version" makes the version (no "Submitted" step). DEMO/00003's
-- submitted review becomes a verification with every field marked, ready to verify and save as version 2.
UPDATE r SET Status = N'Verifying', SubmittedBy = NULL, SubmittedAt = NULL, Remarks = N'Survey report added'
FROM dbo.LegalLandReview r JOIN dbo.LegalLand l ON l.LandId = r.LandId
WHERE l.LandCode LIKE N'DEMO/%' AND r.Status = N'Submitted';
GO

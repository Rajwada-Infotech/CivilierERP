-- 660: A land's project comes from its enquiry (enquiries are raised under a project). Land Conversion copies it; this
-- fills it on lands already converted. Land without an enquiry (existing / backlog land) keeps its own project setting.
UPDATE l SET ProjectId = e.ProjectId
FROM dbo.LegalLand l JOIN dbo.LegalLandEnquiry e ON e.LandId = l.LandId
WHERE l.ProjectId IS NULL AND e.ProjectId IS NOT NULL;
GO

-- 629: Land Enquiry "Financial year" (April–March, e.g. 2026-27; picked, back years allowed). Land Conversion
-- numbers the new Land ID as <district code>/<running no>/<financial year>. Schema only.
IF COL_LENGTH('dbo.LegalLandEnquiry', 'FinYear') IS NULL
  ALTER TABLE dbo.LegalLandEnquiry ADD FinYear NVARCHAR(20) NULL;

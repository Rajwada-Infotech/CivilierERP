-- Legal enquiry searches: besides the deed registry offices, every enquiry now searches the land records —
-- CS (Cadastral Survey, from 1920), RS (Revisional Survey, from 1956) and LR (Land Reforms, from 1985) — year by
-- year, the same way. Other searches can be added to one enquiry from the Deed Search page; a new name typed there
-- is added to Setup → Registration Office Types (not on every enquiry) so it is offered next time.
--   LegalEnquiryOfficeSearch.ManualAdd: a search added by hand to one enquiry (never removed automatically).
IF COL_LENGTH('dbo.LegalEnquiryOfficeSearch', 'ManualAdd') IS NULL
  ALTER TABLE dbo.LegalEnquiryOfficeSearch ADD ManualAdd BIT NOT NULL CONSTRAINT DF_LegalEnquiryOfficeSearch_ManualAdd DEFAULT 0;
GO
INSERT INTO dbo.LegalRegistrationOfficeType (TypeName, Code, StateName, SlaDays, FromYear, OnEnquiry, Description, SortOrder, IsActive)
SELECT v.n, v.c, N'West Bengal', 7, v.y, 1, v.d, v.s, 1
FROM (VALUES (N'CS Record', N'CS', 1920, N'Cadastral Survey record of rights (oldest survey, before RS)', 11),
             (N'RS Record', N'RS', 1956, N'Revisional Survey record (RS Khatian / Dag)', 12),
             (N'LR Record', N'LR', 1985, N'Land Reforms record of rights (LR Khatian / Dag, Banglarbhumi)', 13)) v(n, c, y, d, s)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalRegistrationOfficeType t WHERE t.TypeName = v.n AND ISNULL(t.StateName, N'') = N'West Bengal');
GO

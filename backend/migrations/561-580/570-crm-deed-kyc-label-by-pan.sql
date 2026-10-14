-- Migration 570: a deed's KYC paper is named by the party's PAN type.
--
-- Business decision 2026-10-14: an individual (PAN 4th letter P) gives PAN +
-- Aadhaar; a company / firm / HUF / trust gives PAN + address proof (no
-- Aadhaar). New deeds already label it that way (services/crmTransferDeed.js
-- requiredDocs). This re-labels the KYC slots of deeds still open, where the
-- party's PAN is a well-formed non-individual PAN. Only the label changes;
-- documents, statuses and closed deeds are untouched. Safe to run again.
UPDATE d
   SET d.Label = CASE d.Party WHEN N'Seller' THEN N'Seller''s KYC (PAN & address proof)' ELSE N'Buyer''s KYC (PAN & address proof)' END
  FROM dbo.CrmTransferDeedDocument d
  JOIN dbo.CrmTransferDeed td ON td.Id = d.DeedId
  JOIN dbo.CrmUnitResale r ON r.Id = td.ResaleId
  JOIN dbo.CrmCustomer c ON c.Id = CASE d.Party WHEN N'Seller' THEN r.FromCustomerId ELSE r.ToCustomerId END
 WHERE d.IsActive = 1
   AND d.DocumentType IN (N'SellerKyc', N'BuyerKyc')
   AND d.Label LIKE N'%(PAN & Aadhaar)'
   AND td.Status NOT IN (N'Registered', N'Cancelled')
   AND UPPER(LTRIM(RTRIM(c.PanNo))) LIKE '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'
   AND SUBSTRING(UPPER(LTRIM(RTRIM(c.PanNo))), 4, 1) <> 'P';
GO

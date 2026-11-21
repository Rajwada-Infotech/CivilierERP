-- 622 · A converted land enquiry shows the location its land now records (district, mouza, GPS).
-- From here the Land Register keeps them in step on every save; this brings already-converted enquiries in line once.
SET NOCOUNT ON;
GO
UPDATE e
SET e.DistrictId = l.DistrictId, e.MouzaId = l.MouzaId, e.GpsLatitude = l.GpsLatitude, e.GpsLongitude = l.GpsLongitude
FROM dbo.LegalLandEnquiry e
JOIN dbo.LegalLand l ON l.LandId = e.LandId
WHERE e.LandId IS NOT NULL;
GO
-- Land converted from an enquiry was given the old purchase-step name as its status ("Land Property Master").
-- Every land now follows the record approval (Draft → Verified → L1 → L2): put that status back where it is missing.
UPDATE dbo.LegalLand
SET WorkflowStatus = CASE
      WHEN L2Status = N'Approved' THEN N'Approved'
      WHEN L2Status = N'Rejected' THEN N'Rejected'
      WHEN L1Status = N'Approved' THEN N'L2 Pending'
      WHEN VerificationStatus = N'Verified' THEN N'Verified (Pending L1)'
      ELSE N'Draft (Verification Pending)' END
WHERE ISNULL(WorkflowStatus, N'') NOT IN (N'Draft (Verification Pending)', N'Draft (Re-Verification Required)', N'Verified (Pending L1)',
      N'L1 Pending', N'L2 Pending', N'L1 Returned (Draft)', N'L2 Returned to L1', N'Approved', N'Rejected');
GO

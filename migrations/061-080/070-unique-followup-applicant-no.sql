-- Migration 070: Enforce unique generated applicant numbers

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_FollowupApplicants_ApplicantNo'
      AND object_id = OBJECT_ID('dbo.FollowupApplicants')
)
BEGIN
    CREATE UNIQUE INDEX UX_FollowupApplicants_ApplicantNo
    ON dbo.FollowupApplicants(ApplicantNo)
    WHERE ApplicantNo IS NOT NULL;
END;

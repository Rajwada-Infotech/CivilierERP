-- Migration 444: backfill CrmLegalMilestone rows whose CurrentStep got
-- permanently stuck behind a step that was never actually going to be
-- ticked, even though later steps (and the real Agreement) moved on fine.
--
-- Root cause (see recomputeLegalMilestoneCurrentStep in
-- crmWorkflowGuards.js, and the matching fix in crmAgreements.js POST /):
--   - DocCollection's trigger (the customer's Identity Proof document being
--     Verified) is deliberately NOT mandatory — maybeAutoCreateAgreement's
--     own comment says the real gate is the Sale Agreement paperwork, not
--     this KYC document. Plenty of real agreements never verify it.
--   - LegalReview's trigger only fired on a later (re)assignment PUT, never
--     when LegalExecutiveId was supplied directly at Agreement creation —
--     a real code gap, now closed, but existing trackers created that way
--     are still stuck.
-- CurrentStep is computed as "the first step still Pending" — so either gap
-- freezes the whole tracker at that step forever, showing e.g. "Document
-- Collection pending" on a booking whose Agreement is already Registered.
--
-- Fix: for every tracker, whichever step is the LAST one (by sequence
-- position) already genuinely Completed proves every step before it must
-- have happened too — auto-complete any of those still sitting Pending,
-- then recompute CurrentStep. Idempotent: a tracker with no such gap is
-- left untouched, and re-running this after a clean pass finds nothing left
-- to fix.

DECLARE @id INT, @lastDoneIdx INT;
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM dbo.CrmLegalMilestone;
OPEN cur;
FETCH NEXT FROM cur INTO @id;

WHILE @@FETCH_STATUS = 0
BEGIN
  SELECT @lastDoneIdx = (
    SELECT MAX(v.idx) FROM (VALUES
      (1, DocCollectionStatus), (2, LegalReviewStatus), (3, DraftingStatus), (4, InternalApprovalStatus),
      (5, DocSharedStatus), (6, MutualAgreementStatus), (7, DirectorMeetingStatus), (8, FinalExecutionStatus)
    ) AS v(idx, status)
    WHERE v.status = 'Completed'
  )
  FROM dbo.CrmLegalMilestone WHERE Id = @id;

  IF @lastDoneIdx IS NOT NULL AND @lastDoneIdx > 1
  BEGIN
    UPDATE dbo.CrmLegalMilestone SET
      DocCollectionDone    = CASE WHEN 1 < @lastDoneIdx AND DocCollectionStatus    <> 'Completed' THEN ISNULL(DocCollectionDone,    CAST(SYSDATETIME() AS DATE)) ELSE DocCollectionDone    END,
      DocCollectionStatus  = CASE WHEN 1 < @lastDoneIdx AND DocCollectionStatus    <> 'Completed' THEN 'Completed' ELSE DocCollectionStatus END,
      DocCollectionNotes   = CASE WHEN 1 < @lastDoneIdx AND DocCollectionStatus    <> 'Completed' THEN ISNULL(DocCollectionNotes,  'Auto-completed — a later step was already done, so this one must have happened too') ELSE DocCollectionNotes END,
      LegalReviewDone      = CASE WHEN 2 < @lastDoneIdx AND LegalReviewStatus      <> 'Completed' THEN ISNULL(LegalReviewDone,     CAST(SYSDATETIME() AS DATE)) ELSE LegalReviewDone      END,
      LegalReviewStatus    = CASE WHEN 2 < @lastDoneIdx AND LegalReviewStatus      <> 'Completed' THEN 'Completed' ELSE LegalReviewStatus END,
      LegalReviewNotes     = CASE WHEN 2 < @lastDoneIdx AND LegalReviewStatus      <> 'Completed' THEN ISNULL(LegalReviewNotes,    'Auto-completed — a later step was already done, so this one must have happened too') ELSE LegalReviewNotes END,
      DraftingDone         = CASE WHEN 3 < @lastDoneIdx AND DraftingStatus         <> 'Completed' THEN ISNULL(DraftingDone,        CAST(SYSDATETIME() AS DATE)) ELSE DraftingDone         END,
      DraftingStatus       = CASE WHEN 3 < @lastDoneIdx AND DraftingStatus         <> 'Completed' THEN 'Completed' ELSE DraftingStatus END,
      DraftingNotes        = CASE WHEN 3 < @lastDoneIdx AND DraftingStatus         <> 'Completed' THEN ISNULL(DraftingNotes,       'Auto-completed — a later step was already done, so this one must have happened too') ELSE DraftingNotes END,
      InternalApprovalDone   = CASE WHEN 4 < @lastDoneIdx AND InternalApprovalStatus <> 'Completed' THEN ISNULL(InternalApprovalDone,   CAST(SYSDATETIME() AS DATE)) ELSE InternalApprovalDone   END,
      InternalApprovalStatus = CASE WHEN 4 < @lastDoneIdx AND InternalApprovalStatus <> 'Completed' THEN 'Completed' ELSE InternalApprovalStatus END,
      InternalApprovalNotes  = CASE WHEN 4 < @lastDoneIdx AND InternalApprovalStatus <> 'Completed' THEN ISNULL(InternalApprovalNotes, 'Auto-completed — a later step was already done, so this one must have happened too') ELSE InternalApprovalNotes END,
      DocSharedDone        = CASE WHEN 5 < @lastDoneIdx AND DocSharedStatus        <> 'Completed' THEN ISNULL(DocSharedDone,       CAST(SYSDATETIME() AS DATE)) ELSE DocSharedDone        END,
      DocSharedStatus      = CASE WHEN 5 < @lastDoneIdx AND DocSharedStatus        <> 'Completed' THEN 'Completed' ELSE DocSharedStatus END,
      DocSharedNotes       = CASE WHEN 5 < @lastDoneIdx AND DocSharedStatus        <> 'Completed' THEN ISNULL(DocSharedNotes,      'Auto-completed — a later step was already done, so this one must have happened too') ELSE DocSharedNotes END,
      MutualAgreementDone    = CASE WHEN 6 < @lastDoneIdx AND MutualAgreementStatus <> 'Completed' THEN ISNULL(MutualAgreementDone,   CAST(SYSDATETIME() AS DATE)) ELSE MutualAgreementDone   END,
      MutualAgreementStatus  = CASE WHEN 6 < @lastDoneIdx AND MutualAgreementStatus <> 'Completed' THEN 'Completed' ELSE MutualAgreementStatus END,
      MutualAgreementNotes   = CASE WHEN 6 < @lastDoneIdx AND MutualAgreementStatus <> 'Completed' THEN ISNULL(MutualAgreementNotes, 'Auto-completed — a later step was already done, so this one must have happened too') ELSE MutualAgreementNotes END,
      DirectorMeetingDone    = CASE WHEN 7 < @lastDoneIdx AND DirectorMeetingStatus <> 'Completed' THEN ISNULL(DirectorMeetingDone,   CAST(SYSDATETIME() AS DATE)) ELSE DirectorMeetingDone   END,
      DirectorMeetingStatus  = CASE WHEN 7 < @lastDoneIdx AND DirectorMeetingStatus <> 'Completed' THEN 'Completed' ELSE DirectorMeetingStatus END,
      DirectorMeetingNotes   = CASE WHEN 7 < @lastDoneIdx AND DirectorMeetingStatus <> 'Completed' THEN ISNULL(DirectorMeetingNotes, 'Auto-completed — a later step was already done, so this one must have happened too') ELSE DirectorMeetingNotes END,
      -- Every step 1..@lastDoneIdx is now Completed (backfilled above, or
      -- already was) and nothing beyond @lastDoneIdx was Completed before
      -- this ran (that's what made it @lastDoneIdx in the first place), so
      -- the next current step is simply the one right after it. SET clause
      -- expressions all read the PRE-update row, so this can't just re-test
      -- the *Status columns above — they'd still read their old values.
      CurrentStep = @lastDoneIdx + 1,
      OverallStatus = CASE WHEN FinalExecutionStatus = 'Completed' THEN 'Completed' ELSE OverallStatus END
    WHERE Id = @id;
  END

  FETCH NEXT FROM cur INTO @id;
END
CLOSE cur;
DEALLOCATE cur;
GO

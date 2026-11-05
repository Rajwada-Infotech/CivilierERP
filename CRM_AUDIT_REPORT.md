# CRM Audit Report

**Review date:** 24 October 2026  
**Review type:** Static audit followed by targeted fixes  
**Overall verdict:** CRM is a substantial, actively maintained workflow module, but the available evidence does not support calling it “10/10” or “100% perfect.” This audit found concrete user-facing reliability and accessibility gaps, and static inspection cannot establish correctness for the full set of financial and lifecycle workflows.

## Executive summary

The CRM has broad coverage across leads, customers, applications, bookings, legal milestones, agreements, payments, possession, after-sales, resale, and the customer portal. Its structure includes route-level authentication, page-right checks, project scoping, validation schemas, audit services, workflow guards, database migrations, and dedicated CRM tests. This is a strong foundation.

The audit identified and corrected these confirmed issues in the inspected surface:

1. **[Fixed] Customer list failures could look like a valid empty result.** The fetch now throws on network and HTTP failures, and the page shows an explicit error with a retry action rather than the empty-state table.
2. **[Fixed] The CRM side drawer’s dialog lacked an accessible name.** The dialog now references its visible heading using `aria-labelledby` and a React-generated stable ID.
3. **[Improved; tests remain] The drawer now uses the shared Radix dialog focus scope.** This replaces the hand-maintained focus trap and supports focus return, nested portals, Escape handling, and modal focus containment. Dedicated drawer interaction coverage is still needed.
4. **[Fixed] Customer detail responses crossed project scope for shared customers.** The customer guard permits access when a customer has at least one application in the caller’s projects. The detail endpoint then returned every application and payment aggregate across all of that customer’s projects. Customer list/detail application counts and project names also included out-of-scope projects. Responses now filter those histories, totals, counts, and names to the caller’s allowed project IDs.
5. **[Fixed] Staff portal-password reset bypassed project scope.** `/api/crm-portal` is mounted before the normal API project-scope middleware. Its staff-only password reset had its own staff authentication and `crm-customers:edit` page-right check, but could reset a customer portal account in any project by customer ID. The endpoint now attaches the staff project scope and requires the customer to have an application in that scope before resetting credentials.
6. **[Fixed] Successful portal password changes could leave the customer blocked briefly.** The middleware cached `MustChangePassword=true` before the change; the change route now invalidates that per-process cache entry after the database update succeeds.
7. **[Fixed] Portal login bypassed an explicitly reset password.** Login accepted the customer's mobile even when the account had been reset to a different explicit temporary password. It now accepts only a credential that matches the stored bcrypt hash; normalized mobile credentials remain supported through that hash.
8. **[Fixed] Customer portal session invalidation was incomplete.** Logout blacklists the current token; password reset/change and staff deactivation/reactivation increment an account session version checked on every portal request.
9. **[Fixed] On-account adjustments could spend credit reserved for refunds or re-booking transfers.** Manual and automatic milestone adjustments now subtract live claims before deciding how much balance is available.
10. **[Fixed] Concurrent refund and re-booking requests could reserve the same credit.** Claim creation now locks the source deposit and repeats the available-balance check in the same transaction as the insert.
11. **[Fixed] A failed refund paid-sync had no retry schedule.** The backend worker now runs the idempotent repair at startup and every five minutes.
12. **[Fixed] Resubmitting a rejected refund could reclaim already-used credit.** Resubmission now locks the source row, rechecks available balance excluding the current claim, and updates status transactionally.
13. **[Fixed] Finance could send a refund back while payout approval was creating its voucher.** Finance rejection now locks the refund, checks that no voucher exists, and performs a guarded status change in one transaction.
14. **[Fixed] Approved CRM receipts had no automatic retry for failed CRM follow-up.** The worker now retries incomplete approved booking payments, including missing on-account deposits, GL postings, or money receipts.
15. **[Fixed] Editing an approved CRM receipt could leave its deposit and GL out of sync.** Approved CRM-linked receipts are now blocked from ordinary edits and must go through the bounce/reversal and replacement flow.
16. **[Fixed] Failed CRM bounce unwind could be reported as success.** The BRS bounce flag and GL reversal are committed before the CRM unwind. The route previously returned HTTP 200 even if the CRM transaction or its follow-up failed, so callers could believe the booking had been unwound. It now invalidates relevant CRM caches after every CRM bounce attempt and returns a retryable 503 with the committed bounce state when the CRM unwind fails. The unwind transaction and source-status check make repeating the bounce action safe for retry.
17. **[Fixed] Concurrent CRM bounce retries could reverse allocations twice.** The unwind previously read live deposits before opening its transaction. Simultaneous requests could both pass that check and insert duplicate negative allocation rows. It now locks the source receipt and its deposits in the unwind transaction before checking statuses and changing allocations.
18. **[Fixed] Money receipt edits could race approval.** Editing checked that a receipt was Pending or Bounced, then updated it later without holding the row lock. Approval could link a Finance receipt between those steps, after which the edit could still change the CRM amount or payment details. The edit now locks, validates, and updates the row in one transaction.
19. **[Fixed] Confirmed booking money receipt failures had no retry.** The confirmation hook logged and swallowed errors while converting Pending money receipts into Finance receipts. It only ran at confirmation time, so a transient failure could strand a valid receipt. A worker recovery now retries eligible Pending receipts for Confirmed bookings every five minutes.
20. **[Fixed] Bounce unwind could race an allocation from another deposit.** Bounce reverses every allocation on a booking, but it only locked the bounced receipt's deposit. A concurrent apply using a different deposit could add an allocation after the unwind read its totals. Both paths now serialize on a booking row lock.
21. **[Fixed] Booking funding gates counted credit already reserved for refund or transfer.** Per-deposit adjustment checks excluded live claims, but booking-level funding and virtual milestone coverage counted the full unapplied amount. Those calculations now subtract live claims too.
22. **[Fixed] Waiving a milestone could overwrite a concurrent payment.** The waive route checked status before its update but did not guard the write. The update now only applies while the milestone is not Paid and returns conflict if payment won the race.
23. **[Fixed] A new refund claim could race the booking funding recheck.** The adjustment held the booking lock, but refund and transfer claim creation serialized only on individual deposits. The adjustment now locks all booking deposits before rechecking funding, which serializes against claims on any deposit.
24. **[Fixed] Refund payout details could be edited after approval began.** The edit route checked Draft/Pending status before an unguarded update. It now updates only while the refund remains Draft or Pending and returns a conflict if the state advanced.
25. **[Fixed] On-account screens overstated available balances during live claims.** The deposit list and summary tiles counted unapplied balances already reserved for refunds or transfers. They now use the same live-claim deductions as the adjustment and funding checks.
26. **[Fixed] Booking and agreement screens still counted reserved credit as available.** Several booking-scoped queries and agreement prerequisites used raw unapplied deposits after the global list was fixed. They now use the shared claim-aware availability calculation.
27. **[Fixed] Buy-back payout and refund/transfer claims could reserve the same source money.** Voucher creation now locks the booking deposits and rejects live refund or transfer claims; claim creation and refund resubmission reject source credits committed to an active buy-back.
28. **[Fixed] Cancellation could snapshot paid funds before a concurrent receipt finished posting.** The cancellation cascade now takes an exclusive booking lock before recalculating paid funds and uses that in-transaction total for held credit and its linked refund.
29. **[Fixed] Cancellation could orphan live refund or transfer claims on rolled-up deposits.** The cancellation cascade now locks all booking deposits and refuses to proceed while a refund or re-booking transfer remains open against them.
30. **[Fixed] Rejected cancellation cases could be resubmitted after the booking became terminal.** Resubmission now holds a booking lock, verifies that the booking remains active, and only then transitions the cancellation back to Pending.
31. **[Fixed] Cancellation notes could be edited after approval won a race.** The update now guards the cancellation state in its write predicate and returns HTTP 409 when approval has already advanced it.
32. **[Fixed] Cancellation could strand an approved Finance receipt before its CRM deposit was created.** The cancellation cascade now detects approved CRM-linked receipts without their source-linked on-account row and returns HTTP 409, allowing the approved-payment recovery worker to finish before cancellation is retried.
33. **[Fixed] Refund payout approval could race a new transfer claim.** Payout voucher creation now locks the source deposit before rechecking its unclaimed balance, serializing the check and voucher insert against refund/transfer claim writers.
34. **[Fixed] Re-booking transfer completion could ignore a claim created after its first balance check.** The final source-lock recheck now recalculates unclaimed balance inside the transaction, excluding only the transfer being applied.
35. **[Fixed] A milestone could be added after cancellation passed its active-booking check.** Custom milestone creation now locks the booking, rechecks its active state, allocates the next milestone number, and inserts inside one transaction.
36. **[Fixed] A new payment submission could land after cancellation rejected pending receipts.** CRM-linked ReceivedPayment creation now inserts only while holding a booking-row update lock and the booking remains active, so it serializes with cancellation and cannot create a late pending receipt.
37. **[Fixed] Milestone schedule edits could race cancellation.** The edit transaction now locks and rechecks the booking before changing a milestone or recalculating other dues; if cancellation has made it terminal, the edit returns HTTP 409.
38. **[Fixed] A milestone waiver could race cancellation after its active-booking check.** Waiver now locks and rechecks the booking inside the same transaction as the guarded milestone update; terminal bookings return HTTP 409.
39. **[Fixed] Resale completion could race cancellation of the seller booking.** Resale completion now locks and validates the seller booking; cancellation rechecks booking state under its exclusive lock before starting its cascade. Whichever operation commits first causes the other to stop with a conflict.
40. **[Fixed] A resale/buy-back case could be created after cancellation passed its case check.** Case creation now locks all source bookings, rechecks that they are live and have no open resale, then inserts in one transaction. Cancellation checks for an open resale/buy-back while holding the same booking lock.
41. **[Fixed] Cancellation requests could be created while a resale/buy-back case was already open.** Cancellation creation now checks for a live case under the booking lock and returns HTTP 409 until that case is completed or rejected.
42. **[Fixed] A cancellation request could store a stale paid amount.** The request now snapshots paid milestones and on-account balances after acquiring the booking lock, serializing the pending-case amount with payment posting.
43. **[Fixed] Cancellation creation could race legal deed registration.** Both cancellation creation and registry completion now serialize on the booking row; cancellation rechecks deed status and registry completion blocks while cancellation is open.
44. **[Fixed] A villa booking could race cancellation of its underlying land booking.** Cancellation creation and approval now rerun the villa dependency check after acquiring the land booking lock, serializing with villa booking creation.
45. **[Fixed] Admin booking deletion could race dependent villa or resale workflows.** The delete transaction now locks and revalidates the booking, then checks villa, resale/buy-back, and cancellation dependencies before deactivating it.
46. **[Fixed] Admin booking deletion could miss a progressed record created after preflight.** It now reruns its downstream record check inside the transaction after locking the booking and aborts if any guarded record exists.
47. **[Fixed] Admin deletion could leave the parent application stale after a post-commit sync failure.** Booking deletion now advances the parent application in the same transaction as booking retirement and cleanup.
48. **[Fixed] Admin deletion could commit before releasing or restoring the application inventory hold.** Hold release/restoration now runs in the booking deletion transaction; a database conflict rolls the deletion back instead of silently leaving inventory stale.
49. **[Fixed] Admin deletion could commit without its audit row, then return an error.** The booking audit log now writes inside the deletion transaction; failure rolls the deletion back.
50. **[Fixed] Cancellation could commit while its parent application status update silently failed.** The cascade now uses the transaction-aware transition service directly, so application-write failures roll back cancellation.
51. **[Fixed] Cancellation approval compensation could split status reset from approval-audit cleanup.** Recovery now reverts the cancellation and removes its latest approval audit entry in one transaction.
52. **[Fixed] Re-booking credit could be applied twice or posted to an inactive target booking.** Transfer application now locks and validates the target booking and transfer row in its transaction, making repeated concurrent applications idempotent.
53. **[Fixed] Fund Transfer approval could report success when linked CRM credit application failed.** The endpoint now returns HTTP 202 with a partial-completion message and records the failure on the linked transfer.
54. **[Fixed] Failed Fund Transfer rejection cleanup could not be retried after the transfer became Rejected.** Rejection is now idempotent after authorization, so retrying the endpoint can release a linked CRM claim without duplicating approval audit events.
55. **[Fixed] Cross-company re-booking transfer creation could leave an orphan Fund Transfer.** The Fund Transfer insert and CRM transfer link now commit atomically; failures roll back the Fund Transfer before releasing the CRM claim.
56. **[Controlled by explicit approval confirmation; manual process] Fund Transfer approval does not move bank funds.** The system cannot execute the bank transfer, so staff must complete it outside CivilierERP before approving. Approval records that confirmation, posts GL entries, and applies any linked CRM credit. The inbox now requires reviewers to open the review panel and displays this condition; the API response also states it. No bank reference/proof is required, per the business decision.
57. **[Fixed] Fund Transfer approval could apply CRM credit when GL posting failed.** Approval commits before the shared GL poster runs, and posting errors are recorded without failing the approval. The transfer route now checks for complete ledger entries before applying linked credit, leaves the CRM claim reserved when posting is missing, and returns a partial-failure response. An approver can retry through the approval action; there is no bank integration or background Fund Transfer retry.
58. **[Fixed] A target booking could be cancelled while a cross-company credit transfer was pending.** Cancellation only checked claims against the booking's own held deposits; it missed re-booking transfers where that booking was the target. Target booking cancellation and transfer-claim creation now serialize on the target booking row, each rechecks the opposite operation, and an open incoming transfer blocks cancellation until applied or rejected.
59. **[Fixed] Re-booking could be marked Applied while follow-up ledger writes failed permanently.** CRM application committed first, then the cross-company ledger mirror and customer on-account ledger were attempted and swallowed on failure. Applied status short-circuited future attempts, and one company mirror voucher caused the whole mirror to be treated as posted. Ledger follow-up is now per-company/idempotent and can be retried by a user; the new on-account ledger credit is idempotent too.
60. **[Fixed] Any signed-in user could retry posting for an already-approved Fund Transfer.** This recovery path now allows only super admins or users explicitly named in the Fund Transfer approval workflow.
61. **[Fixed] A failed Fund Transfer submission could leave a re-booking claim stuck in Draft.** The API now reports the partial state and offers a permission-checked, user-triggered submission action.
62. **[Fixed] A partial refund could reject other valid claims on the remaining source credit.** Stale claims are now rejected only when the source on-account credit is fully consumed.
63. **[Fixed] A stale CRM claim's linked Fund Transfer could still be approved as a standalone transfer.** Approval and GL posting now stop when the linked CRM re-booking claim has been rejected.
64. **[Fixed] A posted Fund Transfer retry could report success after its CRM claim was rejected.** The route now returns a partial-completion warning and directs staff to reconcile the bank movement manually.
65. **[Fixed] Refund approval recovery could overwrite a concurrently created payout voucher state.** Recovery now resets to FinancePending only while the refund remains Approved and has no linked voucher; otherwise it reports the current state.
66. **[Fixed] Payment approval ignored a failed CRM refund settlement result.** The route now surfaces a partial-completion response when the settlement returns false or throws.
67. **[Fixed] An approved CRM refund payout could be deleted while leaving its refund marked Paid.** Deletion now locks and rechecks the payout row and refuses to delete an approved CRM refund payment.
68. **[Fixed] Refund payout approval could settle the whole refund after paying only part of it.** The approval gate now requires the voucher amount to match the refund's net amount within one paisa.
69. **[Fixed] An approved CRM refund payout could be edited while its refund stayed Paid.** Such payouts now reject edits with HTTP 409; the payment update also checks the status seen at read time so an approval racing an edit cannot be overwritten.
70. **[Fixed] Refund payout approval could validate stale details before a concurrent edit.** The final refund payout checks now run inside the status transition while it holds the payment row lock.
71. **[Fixed] GST documents could be missed permanently after refund settlement succeeded.** The worker now retries eligible paid refunds that have no GST-note history, while preserving notes that staff intentionally cancelled.
72. **[Fixed] Failed CRM refund forfeiture postings could not be retried from the GL recovery screen.** The idempotent refund poster is now an allowed retry target and refuses to post unless the refund is Paid.
73. **[Fixed] CRM refund payout bank vouchers could be logged as failed GL postings with no retry action.** The recovery screen now retries their payment poster, which verifies that the voucher remains Approved before posting.
74. **[Fixed] CRM refund payout approval did not clearly state that staff must make the bank payment manually.** The approval panel now tells reviewers to confirm payment happened outside CivilierERP, and the API response makes clear that approval itself does not move funds.
75. **[Unverified] Workflow correctness remains unverified end to end.** CRM operations touch accounting, approvals, inventory, portal identity, and legal-state transitions. The repository has focused regression tests, but this audit did not execute tests or exercise a live database, role matrix, or complete user journeys.

## Findings

### F-01 — Customer list errors are presented as an empty CRM (Fixed)

**Severity:** Medium (operational usability / support risk)  
**Evidence:** `src/pages/CRM/CrmCustomers.tsx`, `fetchCustomersList` near the top of the file, returns an empty page for both non-OK responses and exceptions. The page consumes this function as normal query data.  
**Impact:** API downtime, authorization failures, and connectivity errors can be visually indistinguishable from a successful search with zero matching customers. This can lead staff to repeat imports or report missing records.  
**Resolution:** Fetch failures now reject; the page displays an explicit error and retry action while preserving the genuine zero-row state.

### F-02 — CRM drawer has no programmatic accessible name (Fixed)

**Severity:** Low to Medium (accessibility)  
**Evidence:** `src/components/crm/CrmSideDrawer.tsx` renders `role="dialog" aria-modal="true"` and a visible `<h2>`, but there is no `aria-labelledby` connecting them.  
**Impact:** Assistive technology may announce an unnamed dialog, making the panel’s purpose unclear.  
**Resolution:** The visible heading now has a React-generated stable ID, and the dialog references it with `aria-labelledby`.

### F-03 — Hand-rolled drawer focus trap conflicted with nested overlays (Fixed; tests remain)

**Severity:** Low (accessibility / interaction robustness; not confirmed as a reproduced defect)  
**Evidence:** The former implementation searched only within the drawer DOM for tabbable elements. Radix dialogs opened from drawer content render through portals, so Tab could escape the child dialog and be redirected into the drawer. No drawer-specific interaction tests were found in the inspected test inventory.  
**Impact:** Nested dialog controls could lose keyboard focus, and custom focus restoration had edge cases around transitions.  
**Resolution:** `CrmSideDrawer` now uses the shared Radix Dialog primitive for modal focus containment, Escape/backdrop dismissal, nested overlays, and focus restoration. The side-panel layout and slide animation remain.  
**Follow-up:** Add focused interaction coverage for initial focus, Tab wrapping, Escape, backdrop close, focus restoration, nested dialogs, and rapid close/reopen.

### F-04 - Customer detail history and totals crossed project scope (Fixed)

**Severity:** High (cross-project data exposure)  
**Evidence:** `backend/services/projectScope.js` permits access to a customer when at least one application belongs to the caller's project scope. Before the fix, `GET /api/crm/customers/:id` returned every application for that customer and payment aggregates across all bookings. Shared customer select subqueries also counted and named applications in every project.  
**Impact:** Staff restricted to one project could see another project's booking history and payment totals for a customer linked to both.  
**Resolution:** Customer list/detail application counts and project names, detail application rows, and payment aggregates now apply the resolved project scope.

### F-05 - Staff portal password reset bypassed project scope (Fixed)

**Severity:** High (cross-project account control)  
**Evidence:** `backend/server.js` mounts `/api/crm-portal` before the global staff authentication and project-scope middleware. The staff reset endpoint had local staff authentication and a CRM customer edit-right check, but did not verify the target customer's project.  
**Impact:** A project-restricted staff user with CRM customer edit rights could reset a portal account for a customer outside their assigned projects.  
**Resolution:** The endpoint now resolves staff project scope itself and verifies that the customer has an application in that scope before changing portal credentials.

### F-06 - Portal password change left stale forced-reset cache state (Fixed)

**Severity:** Low (short-lived portal availability issue)  
**Evidence:** The portal status middleware caches `MustChangePassword` before passing `/change-password` through. The route changed the database value but did not invalidate `_portalUserStatusCache`, so subsequent requests could still be rejected until the 15-second cache TTL expired.  
**Impact:** After successfully setting a new password, the customer could see a “must change password” error on other portal pages for up to 15 seconds.  
**Resolution:** The successful password-change handler now deletes that portal user’s cache entry so the next request reads the updated state.

### F-07 - Portal login accepted mobile despite an explicit password reset (Fixed)

**Severity:** High (credential reset bypass)  
**Evidence:** `backend/routes/crmPortal.js` accepted the normalized customer mobile as a successful login whenever `MustChangePassword` was true, without checking it against `PasswordHash`. Staff can reset an account to an explicit temporary password while setting `MustChangePassword=1`, so the mobile remained an alternate credential.  
**Impact:** Anyone who knew the customer email and mobile could bypass an explicitly chosen temporary password and obtain a portal session during the forced-reset period.  
**Resolution:** Removed the unhashed mobile fallback. The initial and default temporary mobile credentials remain supported through bcrypt comparison against their stored hash.

### F-08 - Customer portal logout and credential changes did not revoke sessions (Fixed)

**Severity:** Medium (session security)  
**Evidence:** Portal JWTs were accepted until their seven-day expiry, and logout previously only instructed the client to discard its token. Password reset/change and staff account deactivation/reactivation also left previously issued sessions valid.  
**Impact:** A copied token could continue accessing portal endpoints after logout, credential changes, or an account lifecycle change.  
**Resolution:** Logout now blacklists the presented JWT until its expiry. Password reset/change and staff deactivation/reactivation increment a Redis-backed account session version; portal authentication rejects tokens with an old version. Revocation checks fail closed when Redis cannot be consulted.

### F-09 - On-account adjustment could consume funds reserved by a refund or transfer (Fixed)

**Severity:** High (financial source-credit double-use risk)  
**Evidence:** `backend/routes/crmRefunds.js` computes available credit by subtracting live refund and re-booking claims. `applyOnAccountToMilestone` in `backend/routes/crmPayments.js` previously locked the on-account row but calculated the full `Amount - AppliedAmount` as available, without subtracting those claims. Both manual adjustments and automatic sweeps use this function.  
**Impact:** A pending refund or re-booking transfer could reserve an overpayment, then an adjustment could spend the reserved amount before Finance disbursed it. The refund’s final payout check could then fail after the payout voucher entered Finance, requiring reconciliation.  
**Resolution:** Under the deposit row lock and transaction, adjustments now subtract all non-terminal refund and re-booking claims before calculating the amount that can be applied.

### F-10 - Concurrent refund and re-booking requests could reserve the same credit (Fixed)

**Severity:** High (financial source-credit double-reservation risk)  
**Evidence:** Refund and transfer creation previously called `getUnclaimedRemaining` before inserting a claim, without holding a lock on the source `CrmOnAccountPayment` row. Concurrent requests could both observe the same balance and independently insert live claims.  
**Impact:** The source could be over-reserved, leaving a later payout or transfer unable to complete and requiring Finance to resolve competing claims.  
**Resolution:** Refund creation and re-booking transfer creation now lock the source deposit, repeat the live-claim balance check, and insert the claim within one transaction. The initial non-locking validation remains for fast feedback; the transactional check is authoritative.

### F-11 - Refund paid-state recovery routine was never scheduled (Fixed)

**Severity:** High (financial state reconciliation / customer ledger accuracy)  
**Evidence:** NewPayment approval calls `markCrmRefundPaid` after the payout approval has committed and deliberately treats synchronization failure as non-fatal. `settlePaidRefunds` was implemented as an idempotent repair, but repository search found no caller despite a comment saying it should run from a scheduled job.  
**Impact:** A transient database failure after the bank payout could leave the refund in a Finance status and leave the on-account source balance and ledger unconsumed indefinitely.  
**Resolution:** The backend worker now invokes `settlePaidRefunds` on startup and every five minutes. A process-local guard prevents overlapping runs in one worker; the existing refund-row lock makes concurrent worker runs safe across application instances.

### F-12 - Resubmitting a rejected refund did not reacquire its source-credit reservation (Fixed)

**Severity:** High (financial over-reservation)  
**Evidence:** `PUT /api/crm-refunds/:id/submit` previously changed `Rejected` or `Draft` directly to `Pending` without checking whether the source credit remained available. Rejected claims are excluded from `getUnclaimedRemaining`, so the source may have been applied, transferred, or claimed by another refund after rejection.  
**Impact:** The refund could re-enter approvals with no valid funds behind it, leading to a later payout denial or conflicting financial claims.  
**Resolution:** Resubmission now locks the source on-account row, rechecks current unclaimed funds excluding the refund's own old row, and performs the status transition in the same transaction. The source lock serializes it with claim creation and on-account application.

### F-13 - Finance rejection could overwrite a concurrent payout approval (Fixed)

**Severity:** High (refund workflow state / duplicate voucher risk)  
**Evidence:** `PUT /:id/finance-reject` previously read `Status = 'FinancePending'` and later performed an unconditional status update. In parallel, finance approval could lock the same refund, create a payout voucher, and set `FinanceApproved`; the rejection update could then overwrite the resulting state with `Pending`.  
**Impact:** The refund could appear eligible for a new approval while its first payout voucher already exists, leaving inconsistent workflow state and confusing Finance.  
**Resolution:** Finance rejection now locks and re-reads the refund, rejects the action if status changed or a voucher exists, and updates only while status remains `FinancePending` with no voucher, all within a transaction.

### F-14 - Approved CRM received payments could be left without CRM follow-up (Fixed)

**Severity:** High (financial ledger and customer receipt completeness)  
**Evidence:** `receivedPayment.js` commits `RPStatus = 'Approved'` before running CRM on-account deposit, GL, auto-application, and money-receipt side-effects. Failures are intentionally non-fatal and return a warning. There was no scheduled caller to retry these paths. Source-RP uniqueness makes deposit creation idempotent, and GL posting checks for an existing source posting.  
**Impact:** A transient failure could leave an approved payment without its CRM on-account record, ledger posting, auto-application, or customer money receipt.  
**Resolution:** The worker now retries approved booking-linked payments with a missing on-account deposit, missing money receipt, or missing non-reversed on-account GL entry. The milestone handler now retries GL posting even when the source deposit already exists. Repeated processing is bounded to incomplete rows and uses the existing source-level idempotency checks.

### F-15 - Editing an approved CRM receipt could desynchronize CRM deposit and GL amounts (Fixed)

**Severity:** High (financial record and ledger inconsistency)  
**Evidence:** `PUT /api/received-payment/:id` previously reset an approved record to Pending and changed its amount/bank fields, but its CRM on-account deposit remained linked to the source RP with the original amount and bank snapshot. The CRM GL posting is keyed to the on-account row and was not reversed by the generic `ReceivedPayment` reversal path; reapproval reused the old row.  
**Impact:** Finance could see an edited Received Payment amount while the CRM deposit and GL continued to represent the original amount.  
**Resolution:** Ordinary edits to approved booking/milestone-linked receipts now return 409 and explain that the supported correction path is bounce/reversal followed by a replacement receipt. Pending CRM receipts remain editable.

### F-16 - CRM bounce unwind failure was returned as success (Fixed)

**Severity:** High (financial reconciliation / booking balance correctness)  
**Evidence:** `PUT /api/brs/:sourceType/:sourceId/bounce` commits the BRS bounce flag and reverses the source GL before calling `unwindBouncedCrmPayment`. The CRM unwind runs in a separate transaction and can fail independently. Previously the route logged that failure but returned HTTP 200 with a normal "Marked as bounced" message.  
**Impact:** A caller could treat the receipt as fully reversed while the booking remained paid and its CRM deposits, allocations, or money receipt had not been unwound.  
**Resolution:** CRM bounce attempts now invalidate the relevant CRM caches, including after failure. A failed unwind returns HTTP 503 with `retryable: true` and states that the BRS bounce was committed. Repeating the bounce action re-enters the idempotent unwind path and can complete the repair; concurrent attempts are serialized by F-17's source receipt lock.

### F-17 - Concurrent CRM bounce retries could reverse allocations twice (Fixed)

**Severity:** High (financial allocation correctness)  
**Evidence:** `unwindBouncedCrmPayment` previously read the receipt and live on-account deposits before opening its transaction. It then selected all positive net booking allocations and inserted negative reversal rows. Two requests could both observe the same live deposits and allocation totals before either transaction marked the deposits `Bounced`.  
**Impact:** Concurrent bounce requests could create duplicate negative allocation history and reduce milestone paid totals below the true amount, while decrementing deposits more than once.  
**Resolution:** The unwind now begins a transaction first and takes update/range locks on the source `ReceivedPayment` row and its linked on-account deposits before reading their state or allocations. A competing retry waits, then sees the committed bounced state and takes the idempotent repair path.

### F-18 - Money receipt edits could race approval (Fixed)

**Severity:** High (financial document consistency)  
**Evidence:** `updateMoneyReceipt` previously read the row's status and `ReceivedPaymentId`, then issued an unguarded update separately. `approveMoneyReceipt` uses a row lock while linking the Finance receipt, but the edit did not participate in that serialization.  
**Impact:** If approval committed after the edit's initial read but before its update, the edit could change the amount or payment details after the linked Finance record had been created.  
**Resolution:** The edit now reads with `UPDLOCK, HOLDLOCK`, validates and updates in one transaction, with a final status/unlinked guard on the update. Approval and edits therefore serialize on the same receipt row.

### F-19 - Confirmed booking money receipt failures had no retry (Fixed)

**Severity:** Medium to High (payment workflow availability)  
**Evidence:** The booking confirmation path loops over Pending unlinked CRM money receipts and calls `approveMoneyReceipt`, but catches each failure and only logs it. The worker previously retried approved ReceivedPayment side effects, but did not revisit a Pending CRM money receipt.  
**Impact:** A transient transaction failure during confirmation could leave the customer payment receipt outside Finance's queue indefinitely, with no scheduled repair.  
**Resolution:** The worker now retries up to 50 Pending, unlinked money receipts for bookings whose workflow is Confirmed and status Approved, every five minutes. The existing receipt-row lock in `approveMoneyReceipt` serializes worker retries against Finance actions and makes successful processing single-shot.

### F-20 - Bounce unwind could race an allocation from another deposit (Fixed)

**Severity:** High (financial allocation correctness)  
**Evidence:** `unwindBouncedCrmPayment` reverses all positive allocations for the booking, but previously locked only the bounced source receipt and its own deposits. `applyOnAccountToMilestone` locks the selected deposit and milestone, so an apply using a different deposit could proceed while bounce was computing the booking-wide allocation totals.  
**Impact:** The unwind could miss an allocation committed after its aggregate read, leaving paid amounts and deposit balances inconsistent with the bounced booking.  
**Resolution:** Both the unwind and on-account apply now take an update lock on the booking row before locking deposits and milestones. Apply also rechecks the full-funding gate after acquiring that lock, so it cannot proceed using a pre-bounce funding snapshot. This serializes booking-wide reversal with every allocation that goes through the shared apply function.

### F-21 - Booking funding gates counted credit reserved for refund or transfer (Fixed)

**Severity:** High (financial workflow gating / customer balance accuracy)  
**Evidence:** `applyOnAccountToMilestone` subtracts live refund and re-booking claims from the selected deposit, but `getBookingFunding`, `bookingFullyFundedSql`, and `getBookingOnAccountCoverage` previously counted the entire unapplied deposit.  
**Impact:** When a booking's full-funding threshold was met only by money already reserved for a refund or transfer, it could pass the full-funding gate and virtual milestone coverage could report funds that were not available to settle the booking.  
**Resolution:** All three booking-level funding calculations now subtract live refund and transfer claims from each deposit and clamp the available contribution at zero. The existing transaction-level booking funding recheck uses the corrected calculation.

### F-22 - Waiving a milestone could overwrite a concurrent payment (Fixed)

**Severity:** High (financial state integrity)  
**Evidence:** `PUT /api/crm-payments/:id/waive` checked that the milestone was not Paid, then later issued an update setting `Status = 'Waived'` with no state predicate. A concurrent on-account adjustment could mark it Paid between those operations.  
**Impact:** The milestone could end up Waived despite an actual payment receipt, leaving paid amounts and the displayed status contradictory and potentially triggering waiver side effects.  
**Resolution:** The update now includes `Status <> 'Paid'` and checks `OUTPUT`; if a payment changed the status first, the route returns HTTP 409 and does not run waiver side effects.

### F-23 - A new refund claim could race the booking funding recheck (Fixed)

**Severity:** High (financial funding gate concurrency)  
**Evidence:** Refund and re-booking claim creation lock the source on-account deposit before inserting a live claim. The on-account apply path initially locked the booking and rechecked full funding before it locked its selected deposit. A claim on any deposit could therefore commit after the funding recheck but before the apply acquired that deposit lock.  
**Impact:** An adjustment could settle a milestone using a full-funding snapshot that counted credit just reserved by a concurrent refund or transfer.  
**Resolution:** Before its transactional funding recheck, apply now locks all on-account deposits for the booking in ID order, in addition to the booking row. Claim creation on any source deposit must finish before that check or wait until the apply commits.

### F-24 - Refund payout details could be edited after approval began (Fixed)

**Severity:** High (payout integrity)  
**Evidence:** `PUT /api/crm-refunds/:id` checked that the refund was Draft or Pending, then updated the bank, account, IFSC, and reason fields in a separate unguarded statement. The approval path can advance the refund status between the read and write.  
**Impact:** Customer payout instructions could change after approval or after Finance created the payout voucher, leaving the refund record and the actual payment instructions inconsistent.  
**Resolution:** The update now includes `Status IN ('Draft', 'Pending')` in its write predicate and verifies one row changed. If approval advances the state first, the edit returns HTTP 409.

### F-25 - On-account screens overstated available balances during live claims (Fixed)

**Severity:** Medium (financial visibility / operational decision risk)  
**Evidence:** The CRM on-account list's `AvailableBalance` and summary's `TotalAvailable`, `UnappliedBalance`, and `PartialBalance` used `Amount - AppliedAmount` without subtracting active refund and re-booking claims.  
**Impact:** Staff could see funds as available to spend even though the same credit had already been reserved for a refund or transfer. The adjustment endpoint would reject the spend, but the displayed balance and totals were misleading.  
**Resolution:** The list and summary now calculate each deposit's net available balance after live claims, clamped at zero, using the same terminal status rules as the reservation checks.

### F-26 - Booking and agreement screens still counted reserved credit as available (Fixed)

**Severity:** Medium to High (financial visibility / workflow gate correctness)  
**Evidence:** After F-25, the booking-scoped on-account endpoint, booking list's on-account summary, and the agreement-prerequisite fallback still summed `Amount - AppliedAmount` without live claims. Booking detail's total available balance therefore also disagreed with the updated global On Account page.  
**Impact:** Staff could see an inflated balance on booking views, and the agreement workflow could treat Milestone 1 as virtually covered using money already promised to a refund or transfer.  
**Resolution:** Added a shared SQL expression for net available deposit credit and applied it to the booking-scoped endpoint, booking list projection, virtual milestone coverage, and agreement prerequisite fallback. The response balances now follow the same claim deductions as the global list and funding checks.

### F-27 - Buy-back could consume money promised to a refund or re-booking transfer (Fixed)

**Severity:** High (duplicate financial commitment / payout integrity)  
**Evidence:** Buy-back voucher creation checked open refunds but omitted live `CrmRebookingTransfer` claims. Both refund and transfer claim paths also allowed new claims after the buy-back had entered its approved payout state. The final buy-back completion consumes unapplied credit from the seller's booking.  
**Impact:** The same source credit could be promised to a customer refund or another booking while also being consumed as part of the buy-back, leaving stale claims or an overcommitted payout.  
**Resolution:** Voucher creation now locks all deposits for the affected bookings and rejects either kind of live claim. Refund creation, transfer creation, and refund resubmission check for an active approved buy-back while holding the source deposit lock, preventing the race in both directions.

### F-28 - Cancellation could omit a payment that finished while approval was waiting (Fixed)

**Severity:** High (refund liability / financial integrity)  
**Evidence:** Cancellation approval read the booking's paid total before opening its cascade transaction, then later cancelled the booking and created held credit and a linked refund using that earlier total. CRM receipt side-effects serialize on the booking row, so a receipt could finish posting between the read and the cancellation's booking update.  
**Impact:** The customer refund liability could omit newly posted funds, while the cancelled booking and its receipts no longer provided a straightforward recovery path.  
**Resolution:** The cancellation transaction now takes an exclusive booking lock before calculating paid funds, then uses that fresh in-transaction total for the cancellation record, held credit, and linked refund. The lock also blocks new child deposits through the booking foreign key until the cancellation commits or rolls back.

### F-29 - Cancellation could orphan open claims when consolidating source deposits (Fixed)

**Severity:** High (refund/transfer integrity)  
**Evidence:** Cancellation changes unapplied source deposits to `Applied` and creates a new held-credit deposit, but previously left live refunds and re-booking transfers attached to the old source rows. Those claims would subsequently see zero available balance or remain actionable against credit that had been consolidated elsewhere.  
**Impact:** A refund or transfer could become stuck or stale after cancellation, while the cancellation-created held credit and draft refund represented the same customer liability through a different source row.  
**Resolution:** Before changing booking or deposit state, cancellation now locks all booking deposits in the same order used by claim creation and refuses to continue while any live refund or transfer claim exists. The existing failure compensation returns the cancellation request to Pending so the claims can be resolved before retry.

### F-30 - Rejected cancellation could be resubmitted after its booking became terminal (Fixed)

**Severity:** High (invalid lifecycle transition)  
**Evidence:** `PUT /api/crm-cancellations/:id/submit` delegated directly to the generic approval transition, which validates the cancellation's status but does not verify that its booking is still live. A booking could become Cancelled, Transferred, Expired, or Rejected after the cancellation case was rejected.  
**Impact:** The approval inbox could contain a newly Pending cancellation for a booking that no longer permits cancellation, creating misleading approval work and a likely failure at final approval.  
**Resolution:** Resubmission now locks the associated booking row, checks its active flag and terminal status, and only then invokes the approval transition. Terminal bookings receive HTTP 409 and the cancellation remains Rejected.

### F-31 - Cancellation notes could be edited after approval began (Fixed)

**Severity:** Medium (audit history integrity)  
**Evidence:** The notes edit route checked that the cancellation was not Approved, then issued an update with no state predicate. Final approval could advance the cancellation between those statements.  
**Impact:** Staff could change the cancellation's explanatory notes after its approval cascade had started, making the record's history inconsistent with the content reviewers saw.  
**Resolution:** The notes update now only applies while the cancellation is not Approved or Cancelled and checks that exactly one row changed, returning HTTP 409 when approval wins the race.

### F-32 - Cancellation could strand an approved receipt before its CRM deposit existed (Fixed)

**Severity:** High (receipt reconciliation / cancellation liability)  
**Evidence:** Finance approval sets a CRM-linked `ReceivedPayment` to Approved before its CRM side-effect creates the source-linked `CrmOnAccountPayment` row. Cancellation could previously take its balance snapshot during that gap, cancel the booking, and allow the later CRM side-effect to create a deposit too late to be included in the held-credit amount.  
**Impact:** An approved cash receipt could remain outside the cancellation-created held credit and linked refund, leaving the customer liability split across separate records.  
**Resolution:** Cancellation now holds an exclusive lock on the booking row, checks for approved CRM-linked ReceivedPayment rows without their source-linked on-account row, and returns HTTP 409 while compensating the cancellation back to Pending. The lock blocks new dependent deposits; the approved-payment recovery worker can finish after the lock is released, and staff can retry cancellation with the completed balance included.

### F-33 - Refund payout could race a new claim on its source credit (Fixed)

**Severity:** High (duplicate financial commitment / payout integrity)  
**Evidence:** `raisePayoutVoucher` checked the current unclaimed source balance before inserting the payout voucher, but did not lock the source `CrmOnAccountPayment` row. Refund and re-booking claim creation use that source row as their serialization lock.  
**Impact:** A transfer could reserve the credit after the refund's balance check but before its voucher transaction committed, leaving both the customer payout and transfer backed by the same money.  
**Resolution:** Payout voucher creation now acquires an update/hold lock on the source deposit before calculating unclaimed balance and retains it through voucher insertion and refund-state update. Claim creation waits for the payout transaction or commits first and is then included in the balance check.

### F-34 - Re-booking transfer completion could miss a claim created after its initial check (Fixed)

**Severity:** High (duplicate financial commitment / source-credit integrity)  
**Evidence:** `applyRebookingTransferToBooking` checked unclaimed source credit before opening its transaction, then acquired the source-row lock but rechecked only `Amount - AppliedAmount`. A refund claim could be inserted after the first check and before the transfer acquired the lock.  
**Impact:** The transfer could consume credit already reserved by a refund, leaving that refund stale and potentially payable against the same customer funds.  
**Resolution:** After locking the source deposit, transfer application now recalculates unclaimed balance inside the transaction, excluding only its own transfer claim. If a competing refund or transfer claim committed first, the application aborts before creating the destination deposit or consuming the source.

### F-35 - Custom payment milestones could be inserted after booking cancellation (Fixed)

**Severity:** High (financial schedule integrity)  
**Evidence:** `POST /api/crm-payments/booking/:bookingId` checked `requireActiveBooking` before separately reading the next milestone number and inserting. Cancellation can mark the booking terminal between those steps; the insert's foreign key only verifies that the booking row exists, not that it remains active.  
**Impact:** A cancelled booking could acquire a new payable milestone after its held credit/refund snapshot, creating misleading dues and workflow tasks against a dead booking. Concurrent milestone requests could also calculate the same next sequence number.  
**Resolution:** Milestone creation now locks the booking row, rechecks active state under that lock, calculates the next sequence number, and inserts in one transaction. If cancellation wins, the request returns HTTP 409 without creating a milestone.

### F-36 - A CRM payment submission could arrive after cancellation rejected pending receipts (Fixed)

**Severity:** High (payment lifecycle / cancelled-booking integrity)  
**Evidence:** CRM milestone payment submission checked that the booking was active, then later inserted a Pending `ReceivedPayment` through `createReceivedPaymentInternal`. Cancellation holds the booking lock and rejects the currently Pending CRM receipts, but the insert did not use the booking lock or recheck its state; a submission could therefore commit after that rejection sweep.  
**Impact:** A cancelled booking could retain a newly Pending payment in Finance's approval inbox. If approved later, its CRM posting would fail the active-booking guard and require manual recovery.  
**Resolution:** CRM-linked ReceivedPayment insertion now selects from the booking under `UPDLOCK, HOLDLOCK` and inserts only if the booking still exists, is active, and is not terminal. This serializes submission with cancellation: the payment inserts before cancellation's rejection sweep, or cancellation wins and the submission returns HTTP 409 without creating a receipt. Both the milestone receipt and manual on-account routes now return that conflict status to the caller.

### F-37 - Milestone schedule edits could race cancellation (Fixed)

**Severity:** High (financial schedule integrity)  
**Evidence:** `PUT /api/crm-payments/:id` checked booking activity before opening its transaction. It later updated milestone terms and could redistribute remaining milestone amounts without locking or rechecking the booking. The cancellation cascade can mark the booking terminal between those steps.  
**Impact:** A schedule edit could change the dues and invalidate demands after cancellation had already captured the customer's paid amount and released the booking.  
**Resolution:** The write transaction now takes an update/hold lock on the booking and reruns `requireActiveBooking` before any milestone update or schedule recalculation. If cancellation wins, the edit rolls back and returns HTTP 409.

### F-38 - A milestone waiver could race cancellation (Fixed)

**Severity:** High (booking lifecycle / audit integrity)  
**Evidence:** `PUT /api/crm-payments/:id/waive` checked that the booking was active, then issued the milestone update without holding a booking lock. Cancellation could mark the booking terminal between the check and the waiver write.  
**Impact:** A milestone could be recorded as Waived after the booking's cancellation had already committed, creating contradictory payment and cancellation history and triggering downstream deed/brokerage checks on a dead booking.  
**Resolution:** Waiver now locks the booking and rechecks its active state in a transaction containing the Paid-state guard and the waiver update. If cancellation wins, no waiver is written and the route returns HTTP 409; downstream side-effects run only after the waiver transaction commits.

### F-39 - Resale completion could race cancellation of the seller booking (Fixed)

**Severity:** High (inventory ownership / booking lifecycle integrity)  
**Evidence:** Resale completion updated plot ownership and the seller booking without locking or rechecking the source booking inside its transaction. Cancellation could independently lock and cancel the same booking. Cancellation also did not recheck the booking state after acquiring its exclusive lock, so a resale that committed first could still be followed by cancellation.  
**Impact:** Both workflows could commit against the same property: the resale might create buyer ownership after cancellation released the inventory, or cancellation might cancel a booking already transferred to a new owner.  
**Resolution:** Resale completion now locks and validates the source booking before moving ownership. Cancellation rechecks `IsActive` and terminal statuses under its exclusive booking lock before changing any state. The first transaction to acquire and commit determines the outcome; the other receives HTTP 409 and leaves its workflow uncommitted.

### F-40 - A resale case could be opened after cancellation checked for open cases (Fixed)

**Severity:** High (ownership workflow integrity)  
**Evidence:** `POST /api/crm-resales/deal` derived the source bookings and checked they were live and had no open resale, then later inserted the case without locking those bookings. Cancellation's approval cascade now checks open resale/buy-back cases under the booking lock, but the old creation path could insert after that check.  
**Impact:** A new resale or buy-back case could be attached to a booking after cancellation committed, leaving an actionable case against released or cancelled property.  
**Resolution:** Final source-booking validation, open-case recheck, and resale insertion now run in one transaction while locking every source booking in ascending ID order. Cancellation uses an exclusive lock on the booking and checks for open resale/buy-back cases before proceeding. If case creation wins, cancellation returns HTTP 409; if cancellation wins, case creation returns HTTP 409.

### F-41 - Cancellation could be requested while a resale/buy-back case was already open (Fixed)

**Severity:** High (conflicting ownership workflows)  
**Evidence:** Cancellation creation validated the booking's active state but did not check for open resale/buy-back cases. The approval cascade rejected such cases later, leaving a pending cancellation that could not advance until the competing case was resolved.  
**Impact:** Staff could create incompatible pending workflows for the same booking, resulting in avoidable approval conflicts and confusing case queues.  
**Resolution:** After locking and validating the booking, cancellation creation now checks for an active `Draft`, `Pending`, or `Approved` resale/buy-back case. It returns HTTP 409 before inserting a cancellation request. The booking lock serializes this check with resale/buy-back case creation.

### F-42 - A cancellation request could store a stale paid amount (Fixed)

**Severity:** Medium (pending-case financial accuracy)  
**Evidence:** Cancellation creation calculated paid milestones and on-account balances before starting its transaction and acquiring the booking lock. The insert then stored those earlier amounts in `AmountPaidTillDate` and `RefundAmount`.  
**Impact:** A payment posting racing the request could make the pending cancellation's displayed snapshot and create response disagree with the booking's current paid balance. Approval later refreshes the amount, but staff could review stale figures while the case was pending.  
**Resolution:** The route now calculates the amount inside the create transaction after locking and validating the booking. Payment posting and cancellation creation serialize through that booking lock; the stored pending snapshot and response reflect the committed balance at that point.

### F-43 - Cancellation creation could race legal deed registration (Fixed)

**Severity:** High (legal ownership workflow integrity)  
**Evidence:** Cancellation creation checked for a Registered sales deed before opening its transaction, while registry completion marked the deed Registered without locking or rechecking the associated booking. Either route could therefore pass its check and commit after the other.  
**Impact:** A standard cancellation could be created for a legally registered sale, or registry completion could proceed while a cancellation request was pending.  
**Resolution:** Cancellation creation rechecks Registered deeds after taking the booking lock. Registry completion now takes the same booking lock, confirms the booking remains active and the registry remains Scheduled, and rejects completion while a non-rejected cancellation is open. The competing operations therefore serialize and return HTTP 409 when the other workflow has priority.

### F-44 - Villa booking could race cancellation of its underlying land booking (Fixed)

**Severity:** High (property ownership integrity)  
**Evidence:** Cancellation request creation and approval checked for an active villa booking standing on a land booking before acquiring the land booking lock. Villa booking creation validates ownership under an update/hold lock on that same land booking before inserting the villa booking.  
**Impact:** A villa booking could commit after cancellation's early dependency check, allowing the land booking to be cancelled while an active villa contract still depends on that land.  
**Resolution:** Cancellation creation and approval now repeat the villa dependency check after locking and validating the land booking. This serializes the check with villa booking's owner validation and insertion: if the villa operation wins, cancellation sees it and returns HTTP 409; if cancellation wins, villa creation sees the now-inactive land owner and fails.

### F-45 - Admin booking deletion could race dependent workflows (Fixed)

**Severity:** High (booking and inventory integrity)  
**Evidence:** Admin deletion evaluated booking state and downstream records, then checked villa dependency, all before opening its transaction. The transaction retired the booking without locking/revalidating it or checking open cancellation and resale cases.  
**Impact:** A concurrent workflow could make the booking state stale or attach a villa, resale/buy-back, or cancellation case after the preflight. Admin deletion could then deactivate a booking still referenced by an active workflow.  
**Resolution:** The delete transaction now takes an exclusive booking lock and confirms `Status`/`IsActive` still match the preflight. It rechecks villa, resale/buy-back, and cancellation dependencies before retiring the booking; a conflict returns HTTP 409 and rolls back. The booking lock serializes those checks with the corresponding workflow writers.

### F-46 - Admin booking deletion could miss records added after its preflight (Fixed)

**Severity:** High (audit trail and financial integrity)  
**Evidence:** Deletion counted legal, financial, and workflow child records before opening its transaction. The booking lock added for dependent-workflow checks did not itself repeat that downstream count, so a record created between preflight and lock acquisition could be missed.  
**Impact:** Deletion could deactivate a booking after a payment or progressed workflow record had been attached, leaving a child record whose parent no longer appears as a live booking.  
**Resolution:** The transaction reruns the same downstream guard selected for active versus already-cancelled bookings after acquiring the exclusive booking lock. Any newly observed record aborts deletion with HTTP 409 before the booking or child rows are changed.

### F-47 - Admin deletion could leave the parent application stale (Fixed)

**Severity:** Medium (application workflow consistency)  
**Evidence:** For an active booking, deletion committed the booking and inventory cleanup first, then called `syncApplicationOnBookingTerminal`. That helper intentionally catches and logs all failures, so an application update error could not roll back the booking deletion or be retried by the caller.  
**Impact:** The booking could be inactive while its parent application still appeared Approved or otherwise live, blocking correction/rebooking and presenting contradictory lifecycle state.  
**Resolution:** The route now calls `advanceApplicationStatus` with the deletion transaction before commit. A database error rolls the booking and application updates back together. Related inventory hold changes are also part of that transaction (F-48).

### F-48 - Admin deletion could commit before synchronizing the application's inventory hold (Fixed)

**Severity:** High (inventory availability integrity)  
**Evidence:** After committing booking retirement and application status, the route attempted to release holds or place a replacement unit hold in separate requests. Errors were only logged; hold release also catches individual errors internally. The endpoint could still report success while the inventory hold remained inconsistent.  
**Impact:** A cancelled application could keep inventory reserved, or a live application whose booking was deleted could fail to regain its expected hold. This could make availability wrong or allow inconsistent rebooking.  
**Resolution:** For active bookings, the route now releases application holds or places the replacement unit hold using the same transaction as booking retirement and application transition. A database error rolls the workflow back. Unit cache invalidation and matrix notification happen after commit for released holds.

### F-49 - Admin deletion could commit without its audit row (Fixed)

**Severity:** Medium (auditability / API retry safety)  
**Evidence:** The route committed booking, application, inventory, and child-row changes before calling `logCrmAudit`. That helper throws when an audit insert fails. The outer handler then returned HTTP 500 even though deletion had committed.  
**Impact:** The booking change could be missing from the audit trail, and the caller could retry an already-completed operation after receiving an error.  
**Resolution:** The audit row is now inserted through the same transaction before commit. An audit write failure rolls back deletion and its related state changes; successful deletion cannot commit without its audit entry.

### F-50 - Cancellation could commit while the parent application remained stale (Fixed)

**Severity:** High (lifecycle consistency)  
**Evidence:** The cancellation transaction called `syncApplicationOnBookingTerminal`, a helper that catches and logs all errors. A failure updating the parent application therefore did not escape to the cascade transaction.  
**Impact:** The booking could be Cancelled while its application remained Approved or otherwise live, making the application and inventory workflow contradict the committed booking state.  
**Resolution:** The cancellation cascade now reads `ApplicationId` under its booking lock and calls `advanceApplicationStatus` directly with the same transaction. A database failure propagates and rolls back the entire cancellation cascade.

### F-51 - Cancellation approval compensation could split status and audit recovery (Fixed)

**Severity:** Medium (approval workflow consistency)  
**Evidence:** If the cancellation cascade failed after `approvalTransition` committed `Approved`, compensation reset `CrmCancellation.Status` and deleted the corresponding `ApprovalAuditLog` row using separate pool requests. It also deleted the audit row even if the guarded status reset changed no row.  
**Impact:** A failure between the two recovery writes could leave a Pending cancellation with an Approved audit event, or an Approved cancellation with no audit event, confusing the multi-level approval engine and blocking a clean retry.  
**Resolution:** Compensation now uses its own transaction. It deletes the latest matching Approved audit row only when it successfully changed the cancellation from Approved back to Pending. Either both recovery changes commit or neither does.

### F-52 - Re-booking transfer application could duplicate credit or target a cancelled booking (Fixed)

**Severity:** High (financial allocation integrity)  
**Evidence:** `applyRebookingTransferToBooking` checked the transfer status and source balance before its transaction, then locked only the held source credit. Concurrent invocations could both pass the initial non-Applied status check; the second invocation did not re-read the transfer state under lock. The target booking was also never locked or revalidated before inserting its new on-account credit.  
**Impact:** The same transfer could create duplicate target deposits and consume source credit more than once, or a cancelled target booking could receive a new credit after its cancellation snapshot.  
**Resolution:** The apply transaction now locks and validates the target booking and locks/rechecks the transfer row before consuming source credit. It rejects inactive/terminal targets, refuses non-applicable transfer states, and treats a concurrently completed transfer as idempotent success.

### F-53 - Fund Transfer approval could hide a failed CRM credit application (Fixed)

**Severity:** High (cross-company cash / CRM balance reconciliation)  
**Evidence:** The Fund Transfer approval route caught failures from applying the linked CRM re-booking credit, logged them, and continued to return its ordinary success response. Some business-level failures were recorded in transfer notes, but thrown failures were not persisted or surfaced.  
**Impact:** Finance could see an approved and GL-posted inter-company transfer as fully successful while the target booking had no corresponding on-account credit. A transient application failure also lacked a clear retry signal.  
**Resolution:** The endpoint now captures thrown and returned application failures, records the reason on the linked `CrmRebookingTransfer` when available, and returns HTTP 202 with an explicit partial-completion message after preserving the successful Fund Transfer approval and GL posting.

### F-54 - Fund Transfer rejection cleanup could become permanently stranded (Fixed)

**Severity:** High (reserved-credit availability)  
**Evidence:** Fund Transfer rejection commits its status through `approvalTransition`, then separately changes the linked CRM re-booking transfer from `PendingTransfer` to `Rejected`. If that cleanup write failed, a retry called `approvalTransition` again, which rejected the already-Rejected Fund Transfer before releasing the CRM claim.  
**Impact:** The held credit could remain reserved indefinitely after Finance rejected the inter-company transfer, preventing refund or another re-booking transfer.  
**Resolution:** The shared approval transition now permits an already-Rejected transition to return idempotent success after the normal authorization gate, without adding a duplicate audit row. Retrying Fund Transfer rejection can therefore finish the linked claim cleanup safely.

### F-55 - Cross-company re-booking transfer creation could leave an orphan Fund Transfer (Fixed)

**Severity:** High (inter-company cash control)  
**Evidence:** The route reserved held CRM credit, inserted a Draft `FundTransfer`, and then linked it to `CrmRebookingTransfer` using separate pool requests. If linking failed after insertion, compensation rejected the CRM claim but left an unlinked Draft Fund Transfer that remained approvable.  
**Impact:** Finance could approve an inter-company cash movement that no longer had an associated CRM credit claim, creating a real payment without the matching target booking credit.  
**Resolution:** Fund Transfer insertion and the guarded CRM-link update now share one transaction. A link failure rolls back the new Fund Transfer before the outer compensation releases the CRM claim. Document-number back-patching runs after commit and is logged as a non-fatal numbering repair.

### F-56 - Fund Transfer approval could be mistaken for automatic bank execution (Controlled by explicit staff confirmation)

**Severity:** Critical (cash, ledger, and customer-credit integrity)  
**Evidence:** `backend/routes/crmRefunds.js` creates and auto-submits a `FundTransfer` for a cross-company re-booking. `backend/routes/fundTransfer.js` approval posts its GL entries, then calls `applyRebookingTransferToBooking`, which credits the target booking. This repository has no bank integration or external payment execution in that path, and the CRM-created transfer is inserted with `Mode = 'Transfer'` and no bank transaction reference.  
**Impact:** If staff approve the record before making the real bank transfer—or the transfer fails outside the system—the ledger and target booking can reflect money that never moved. The held source credit is consumed, leaving a false customer credit and a bank/GL mismatch.  
**Resolution:** The business decision is that no bank reference/proof field is needed; approval is the authorized staff confirmation that the external transfer already happened. The Approval Inbox now routes Fund Transfer approvals through its review panel, whose notice says the transfer must be completed manually before approval and explains that approval posts accounting and CRM credit. The approval API response repeats this limitation. If the bank transfer has not happened, staff must leave the record Pending; rejecting it releases the held CRM credit. This is an operating control and cannot technically verify the external bank movement.

### F-57 - Failed GL posting did not block linked CRM credit application (Fixed)

**Severity:** Critical (financial ledger and customer-credit consistency)  
**Evidence:** `approvalService.transition()` commits FundTransfer status as Approved before it invokes the best-effort GL poster. Poster errors are logged and do not fail the transition. The Fund Transfer route then treated an Approved status as sufficient to apply a linked CRM re-booking transfer, without verifying that `GeneralLedgerEntry` contained a live posting. Inter-company posting creates one voucher per company, but the poster's old idempotency check treated a single voucher as fully posted. For multi-level workflows, an intermediate approval also received a success message saying the Fund Transfer had been posted.  
**Impact:** A target booking could receive the held credit even though the bank and loan ledger entries were never posted. The route could also imply full approval/posting after only one approval level.  
**Resolution:** The route now checks for a complete FundTransfer GL posting before applying linked CRM credit: one company voucher for an intra-company transfer and both company vouchers for an inter-company transfer. A manual approval retry can complete a missing company voucher and reuses the linked LoanSanction. If posting is incomplete, the route returns HTTP 202 and leaves the re-booking transfer PendingTransfer so source credit remains reserved. Intermediate approval levels get an awaiting-approval response. The approval action UI surfaces partial-failure responses as warnings. This is an ERP accounting retry triggered by an authorized user; it does not execute, schedule, or retry the external bank movement.

### F-58 - A target booking could be cancelled with an incoming re-booking transfer still open (Fixed)

**Severity:** High (customer-credit and cross-company settlement integrity)  
**Evidence:** Cancellation checks looked for refunds and re-booking transfers joined through `HeldOnAccountId`, which catches claims against credit sourced from the booking being cancelled. They did not check transfers whose `ToBookingId` was the booking being cancelled. The transfer endpoint checked that the target was active before opening its reservation transaction, but did not lock/recheck the target there.  
**Impact:** A target booking could enter cancellation while an inter-company Fund Transfer was pending. If the transfer was later approved after the target became terminal, bank/GL movement could complete while CRM credit application failed; the source credit reservation then needed manual reconciliation.  
**Resolution:** Re-booking claim reservation now locks and validates the target booking and rejects targets with an open cancellation before inserting the claim. Cancellation request creation and approval both check for incoming open transfers while holding the target booking lock. The shared target-booking lock serializes these operations: whichever commits first prevents the conflicting workflow from proceeding.

### F-59 - Applied re-booking credit could permanently miss its ledger follow-up (Fixed)

**Severity:** High (customer balance and cross-company accounting integrity)  
**Evidence:** `applyRebookingTransferToBooking` commits the new target on-account row, consumes held credit, and changes `CrmRebookingTransfer` to Applied before posting the cross-company CRM mirror and `OnAccountLedger` credit. It caught and logged later GL/ledger errors, then returned success. A repeated call returned early for Applied transfers. The mirror's `hasPosting` guard considered one company's voucher sufficient for both-company completion, while the on-account ledger helper had no duplicate guard for safe retry.  
**Impact:** The customer-facing CRM credit could be Applied while the accounting mirror or customer balance was incomplete. A retry could either do nothing forever or duplicate the on-account ledger balance if it repeated a partial write.  
**Resolution:** Applied transfers now rerun only their idempotent ledger follow-up. The cross-company mirror checks and repairs each company's voucher independently. The on-account credit insertion and account-balance update are protected by a transaction-owned application lock and a reference check. Failures are returned as partial completion, surfaced in the UI, and can be retried by the user through a dedicated endpoint. Cross-company retry is allowed only after its linked Fund Transfer is approved and fully posted. No background retry or external bank action was added.

### F-60 - Already-approved Fund Transfer retry bypassed approver authorization (Fixed)

**Severity:** High (accounting and customer-credit access control)  
**Evidence:** The Fund Transfer approval route skipped `transition()` when the record was already Approved, then called the GL poster and applied its linked CRM re-booking credit. `transition()` is where role, workflow-user, and maker-checker authorization is enforced.  
**Impact:** Any authenticated staff member who could reach the route could trigger accounting repair and linked customer-credit completion for an approved transfer.  
**Resolution:** The already-approved retry path now allows only `super_admin` or a user explicitly named in the Fund Transfer approval workflow. The retry remains a manual ERP accounting action and does not initiate or retry an external bank transfer.

### F-61 - Failed Fund Transfer submission could leave a re-booking claim stuck in Draft (Fixed)

**Severity:** High (held-credit availability and workflow completion)  
**Evidence:** Cross-company re-booking creates and links the Fund Transfer, then tries to transition it from Draft to Pending. A transition error was logged and swallowed, while the API still returned a success response claiming it was submitted. No Fund Transfer submit endpoint existed.  
**Impact:** The linked transfer remained Draft while the re-booking claim stayed PendingTransfer, reserving source customer credit with no approval action available in that workflow.  
**Resolution:** The CRM endpoint now returns HTTP 202 with the actual Draft state when submission fails. The UI offers a manual retry action backed by a permission-checked endpoint that submits the existing Fund Transfer to the ERP approval queue. It does not move bank funds; the bank transfer remains entirely manual.

### F-62 - Partial refund payout could reject valid reservations on the remaining credit (Fixed)

**Severity:** High (customer-credit availability and workflow consistency)  
**Evidence:** After any refund payout against on-account credit, `markCrmRefundPaid` called `rejectStaleClaimsOnSource` unconditionally. That helper rejects every other open refund and re-booking claim on the same source.  
**Impact:** When a source had enough balance for both a partial refund and another reserved claim, paying the refund could reject the still-funded claim and unnecessarily strand its linked workflow.  
**Resolution:** Refund payout now checks the source on-account status after consuming the refund amount and rejects other claims only when the source is fully Applied. Remaining Held credit keeps its valid reservations.

### F-63 - A rejected CRM claim's linked Fund Transfer could still post (Fixed)

**Severity:** Critical (cross-company cash and customer-credit integrity)  
**Evidence:** Full source-credit consumption can reject other open `CrmRebookingTransfer` rows. The corresponding `FundTransfer` remains separately Pending; the approval route previously queried only PendingTransfer/Applied CRM links, so a rejected link disappeared and the Fund Transfer could continue as a standalone movement.  
**Impact:** Finance could approve and post an inter-company transfer after the customer-credit reservation it represented had been rejected because its source was consumed elsewhere.  
**Resolution:** The approval route now returns HTTP 409 for a non-approved Fund Transfer linked to a rejected CRM claim. The GL poster independently refuses any missing posting for that stale link and rechecks that a PendingTransfer claim remains covered by unconsumed source credit after accounting for other live reservations. This second check protects against best-effort stale-claim cleanup failing. If staff already moved funds externally before the claim was rejected, they must reconcile that movement manually; the ERP never initiates bank transfers.

### F-64 - An already-posted Fund Transfer could report success with no CRM credit (Fixed)

**Severity:** High (customer-credit and staff reconciliation integrity)  
**Evidence:** On an already-approved retry, a complete GL posting short-circuits the poster. The route then searched only PendingTransfer/Applied CRM links; if the linked claim was Rejected, it found no row and returned the generic approved-and-posted success message.  
**Impact:** Staff could interpret the retry response as full completion even though the target booking never received the customer credit.  
**Resolution:** The route now reads the linked CRM claim in every status. Rejected or otherwise non-applicable claim states return HTTP 202 with an explicit warning that no target booking credit was applied and manual bank reconciliation is required. Existing GL entries and external funds are not changed by this response.

### F-65 - Refund approval recovery could overwrite a concurrent payout-voucher state (Fixed)

**Severity:** High (refund workflow and payout reconciliation)  
**Evidence:** The CRM checker commits Approved before creating the Finance payout voucher in a second transaction. If that voucher creation failed, its catch block unconditionally set the refund back to FinancePending. Finance has a recovery path that can create the voucher from an Approved refund with no linked voucher, so a concurrent recovery could complete first and then be overwritten by the catch.  
**Impact:** A valid NewPayment payout voucher could remain linked to a refund whose status had been reset to FinancePending, creating confusing and unsafe retry behavior.  
**Resolution:** Recovery now changes the status only when the refund is still Approved and has no FinanceNewPaymentId. If another request changed the refund or created the voucher, the endpoint returns the actual status and voucher ID instead of overwriting it or claiming FinancePending.

### F-66 - Finance payout approval ignored an unsuccessful CRM refund settlement (Fixed)

**Severity:** High (cash disbursement and customer-credit reconciliation)  
**Evidence:** After the payout `NewPayment` reached final approval, its route awaited `markCrmRefundPaid` but ignored the returned `{ok:false}` result. The helper can return false when the linked refund is missing or no longer in a payable state. The refund worker only selects FinanceApproved/FinancePending refunds, so other states are not automatically retried.  
**Impact:** Finance could receive a normal “Payment approved” response even though the CRM refund remained unsettled and its source credit was not consumed.  
**Resolution:** The payout route now inspects the helper result and returns HTTP 202 with `partialFailure` if settlement returns false or throws. The response makes clear the payment is already approved and asks staff to inspect and reconcile the CRM refund before retrying. This changes neither the payout nor the external bank movement.

### F-67 - An approved CRM refund payout could be deleted without reversing its CRM settlement (Fixed)

**Severity:** Critical (cash disbursement, customer-credit, and accounting integrity)  
**Evidence:** The shared NewPayment delete route reversed GL entries and deleted an approved payment if it was not matched in BRS, but only sent unpaid CRM vouchers back to CRM. If the deleted payment was the payout voucher for a refund already marked Paid, the refund and source-credit consumption remained unchanged. The route also made its approved/unpaid decision from an unlocked read before opening the deletion transaction.  
**Impact:** The system could lose the approved payout record and reverse its accounting while still showing the refund as Paid and its held credit as consumed. Approval racing with deletion could reach the same mismatch.  
**Resolution:** Deletion now locks and re-reads the NewPayment row inside the transaction used for GL reversal and deletion. An approved CRM refund payout returns HTTP 409 and cannot be hard-deleted; approval and deletion serialize on that row. Unpaid CRM vouchers retain their existing send-back behavior.

### F-68 - A partial CRM refund payout could settle the entire refund (Fixed)

**Severity:** High (customer payout and financial reconciliation)  
**Evidence:** The payout approval check rejected voucher amounts above `NetAmount`, but accepted lower amounts. Final approval then marked the entire CRM refund Paid and consumed its source credit.  
**Impact:** A partial payout could be recorded as full settlement, leaving the customer underpaid while the CRM balance showed no amount due.  
**Resolution:** Approval now requires the payout voucher to equal the refund's net amount within ₹0.01. This keeps the existing one-refund/one-voucher and user-controlled bank payment process intact.

### F-69 - An approved CRM refund payout could be edited after settlement (Fixed)

**Severity:** Critical (cash disbursement, customer-credit, and accounting integrity)  
**Evidence:** The shared NewPayment edit route reopened approved payments and reversed their GL, but did not reverse the linked CRM refund settlement. An approved refund payout could therefore be changed while its refund remained Paid. The edit also updated by payment ID alone, so a concurrent approval could win after the initial status read.  
**Impact:** Voucher details and accounting could diverge from the settled refund; a concurrent approval could leave edited payment fields approved without a corresponding GL posting.  
**Resolution:** An already-approved CRM refund payout now returns HTTP 409 and must use the authorized reversal and reconciliation workflow. The edit's UPDATE also predicates on the status read before validation, returning HTTP 409 if approval or another state transition wins the race.

### F-70 - Refund payout approval could validate stale details before a concurrent edit (Fixed)

**Severity:** High (payment authorization and payout control)  
**Evidence:** The approval route read the voucher's payment date, mode, bank, and amount before `transition()` acquired its update lock on the NewPayment row. A concurrent edit could change those fields after the gate passed but before the status changed to Approved.  
**Impact:** The approval could succeed using stale validation while the stored voucher contained incomplete or mismatched payout details.  
**Resolution:** `transition()` now accepts an optional pre-approval validator and runs it after locking the Pending record in its transaction. CRM refund payout approval re-reads and validates the live payment and refund details under that lock, so a concurrent edit either completes first and is validated or waits and then conflicts with the changed status.

### F-71 - GST documents could be missed permanently after refund settlement succeeded (Fixed)

**Severity:** High (statutory documentation and customer records)  
**Evidence:** `markCrmRefundPaid` commits the refund as Paid before issuing its GST refund voucher or credit notes. GST issuance is deliberately non-fatal, but the settlement worker only retried refunds not yet marked Paid. A transient failure after settlement therefore removed the refund from the worker's retry set.  
**Impact:** The customer refund and source credit could be correctly settled while required GST documents were absent, with no automatic recovery unless staff noticed and issued them manually.  
**Resolution:** The existing five-minute settlement worker now also checks eligible Paid refunds with positive booking GST and no GST-note history, then calls the idempotent issuer. It skips refunds with any prior note history, so staff-cancelled notes are not silently reissued.

### F-72 - Failed CRM refund forfeiture postings could not be retried from GL recovery (Fixed)

**Severity:** High (financial accounting integrity)  
**Evidence:** Refund settlement recorded a failed `crm-refund` GL posting in `GLPostingLog`, but the DBA GL recovery route's explicit retry allowlist only included `crm-on-account-payment`. The failure was visible but its safe retry action returned “not wired up.”  
**Impact:** A transient GL outage could leave a Paid refund's forfeiture or GST reclassification unposted until engineering manually intervened.  
**Resolution:** The recovery route now dispatches `crm-refund` failures to the idempotent `postCrmRefundPaid` poster. The poster verifies the refund is still Paid before writing, so retrying a stale failure cannot post a non-paid refund.

### F-73 - CRM refund payout bank vouchers could not be retried after a GL posting failure (Fixed)

**Severity:** High (cash and accounting reconciliation)  
**Evidence:** Final approval of a CRM refund payout uses the `crm-refund-payment` approval module and the shared `postPaymentApproval` poster. Failed attempts were logged under that module, but it was absent from the DBA recovery allowlist.  
**Impact:** The refund could be settled as Paid after staff confirmed the external payout, while the NewPayment bank and customer ledger entry remained absent until engineering intervention.  
**Resolution:** `crm-refund-payment` failures can now be retried through the GL recovery screen using the existing idempotent NewPayment poster. The poster now verifies the payment is still Approved before creating a missing posting. This retry records ERP accounting only and does not initiate or automate any bank transfer.

### F-74 - CRM refund payout approval did not clearly state that staff must make the bank payment manually (Fixed)

**Severity:** High (customer payment and operational control)  
**Evidence:** Approving a CRM refund payout marks its linked refund Paid, but the review footer only displayed the manual-bank-transfer confirmation for cross-company Fund Transfers. CRM refund payout reviewers saw only the generic “Review the details” reminder. The approval API also returned the generic “Payment approved” message.  
**Impact:** A reviewer could approve the ERP voucher before staff had sent the customer's money, causing CRM to show Paid and consume held credit prematurely.  
**Resolution:** The approval review panel now explicitly tells CRM refund payout approvers to confirm that payment happened manually outside CivilierERP. The API response likewise states that approval records staff confirmation and does not move funds. No bank proof is required and no transfer is automated.

## Architecture and controls observed

- Staff CRM API routes are registered behind the `/api` authentication middleware in `backend/server.js`; the customer portal is intentionally registered before that wall and has its own authentication flow.
- CRM pages generally use `ProtectedRoute` with page keys in `src/App.tsx`; the backend also has `requirePageRight` and project-scope infrastructure. Frontend route protection is therefore not the sole access-control layer.
- CRM API modules cover the main customer lifecycle and have associated validation and workflow services. `backend/test/crmModulesLoad.test.js` provides a no-database require/mount smoke test for CRM route and service modules.
- Tests exist for selected critical areas, including resale, project guards, customer import, GST notes, and credit-note behavior. Presence of these tests is positive evidence, but does not prove all CRM flows or permissions are covered.

## Audit limits and confidence

This was a static review with targeted source fixes, not a certification. The CRM surface is large and spans dozens of pages, routes, services, migrations, and external accounting integrations. I inspected route registration and access-control structure, representative frontend behavior (including `CrmSideDrawer.tsx`), CRM-specific test inventory, customer project-scope handling, staff portal-password reset, and portal authentication patterns. I did not inspect every line of every CRM module, run tests, typecheck, lint, build, connect to a database, or simulate user roles and production data. No “100% perfect” claim is supportable from static code review.

**Confidence:** High for the source-level findings and targeted resolutions; moderate for F-03 runtime behavior until keyboard interaction tests run; low for any claim about total workflow correctness without runtime and business-rule validation.

## Suggested remediation order

1. Add keyboard interaction coverage for the CRM drawer, including focus restoration and nested overlays.
2. Add regression coverage for project-restricted access to a customer with applications in multiple projects, including list metadata and detail payment aggregates.
3. Add regression coverage for project-restricted staff password reset attempts against customers outside their assigned projects.
4. Add coverage that a successful portal password change immediately clears the forced-reset gate on subsequent requests.
5. Add portal-login coverage proving an explicit reset password works while the customer mobile is rejected as an alternate credential.
6. Add regression coverage for portal logout revocation and credential-change session-version invalidation, including Redis-unavailable behavior.
7. Add regression coverage for concurrent refund/transfer claims and ensure manual and automatic adjustments cannot spend reserved credit.
8. Add coverage proving a failed post-payout refund sync is retried and is idempotent.
9. Add coverage that rejected refund resubmission fails if its source credit was used or claimed since rejection.
10. Add a concurrency regression proving finance rejection cannot overwrite payout approval.
11. Add coverage proving an approved CRM payment with a failed side-effect is retried without duplicating deposits, GL entries, or money receipts.
12. Add coverage that approved CRM receipts cannot be edited without using the bounce/reversal workflow.
13. Add coverage proving a failed confirmation-time money receipt approval is retried without creating duplicate Finance receipts.
14. Add a concurrency regression proving a bounce unwind and an allocation from another deposit serialize and preserve booking totals.
15. Add coverage proving refund and transfer reservations reduce both booking funding gates and virtual milestone coverage.
16. Add a concurrency regression proving a payment cannot be overwritten by a milestone waiver.
17. Add a concurrency regression proving a new claim on any booking deposit cannot race an on-account funding check.
18. Add a concurrency regression proving a refund edit cannot change payout details after approval begins.
19. Add coverage proving on-account list and summary balances subtract live refund and transfer claims.
20. Add coverage proving booking and agreement views use the same net available balance as the global On Account page.
21. Add a concurrency regression proving a buy-back voucher cannot race refund/transfer claims, and that claims cannot be created or resubmitted after buy-back approval.
22. Add a concurrency regression proving a receipt posting that races cancellation approval is either included in the held credit/refund amount or rejected against the cancelled booking.
23. Add coverage proving cancellation is rejected and returned to Pending when an open refund/transfer claim exists, including concurrent claim creation.
24. Add a regression proving a rejected cancellation cannot be resubmitted after its booking becomes terminal, including a concurrent terminal-state change.
25. Add a concurrency regression proving cancellation notes cannot change after approval advances the case state.
26. Add a concurrency regression proving cancellation waits for approved receipt CRM side-effects to finish before snapshotting the held balance.
27. Add a concurrency regression proving a refund payout voucher and a new refund/transfer claim cannot reserve the same source credit.
28. Add a concurrency regression proving re-booking transfer completion rechecks live refund claims under the source-deposit lock.
29. Add a concurrency regression proving custom milestone creation cannot commit after a booking becomes terminal and that milestone numbers remain unique under concurrent creation.
30. Add a concurrency regression proving CRM payment submissions cannot be inserted after the cancellation rejection sweep.
31. Add a concurrency regression proving milestone schedule edits cannot commit after cancellation advances the booking state.
32. Add a concurrency regression proving milestone waiver and cancellation serialize, with no downstream side-effects when cancellation wins.
33. Add a concurrency regression proving resale completion and cancellation cannot both change ownership/state for the same seller booking.
34. Add a concurrency regression proving resale/buy-back case creation and cancellation serialize on the source bookings.
35. Add a concurrency regression proving cancellation creation and resale/buy-back case creation serialize on the source booking.
36. Add a concurrency regression proving the cancellation request snapshot reflects payment posting serialized by the booking lock.
37. Add a concurrency regression proving cancellation creation and sales deed registration serialize on the booking, including a pending cancellation.
38. Add a concurrency regression proving villa booking creation cannot race cancellation of the underlying land booking.
39. Add a concurrency regression proving admin booking deletion cannot race villa, resale/buy-back, or cancellation case creation.
40. Add a concurrency regression proving a progressed child record committed during deletion preflight prevents booking deactivation.
41. Add a failure-injection regression proving parent application status and booking deletion commit or roll back together.
42. Add a failure-injection regression proving booking deletion and application inventory hold release/restoration commit or roll back together.
43. Add a failure-injection regression proving audit-log insertion failure rolls admin deletion back.
44. Add a failure-injection regression proving a parent application update failure rolls cancellation back.
45. Add a failure-injection regression proving cancellation approval compensation resets case status and audit trail atomically.
46. Add a concurrency regression proving a re-booking transfer can apply once only and cannot post to a cancelled target booking.
47. Add a regression proving cross-company Fund Transfer approval clearly reports when linked CRM credit application fails after the Fund Transfer itself commits.
48. Add a failure-injection regression proving a failed Fund Transfer rejection cleanup can be completed by an authorized retry.
49. Add a failure-injection regression proving failed CRM linking rolls back the newly created cross-company Fund Transfer.
50. Add regression coverage that Fund Transfer approval clearly requires staff confirmation of the completed manual bank transfer, and that rejection releases the linked CRM held-credit claim.
51. Add failure-injection coverage proving linked CRM credit remains reserved when Fund Transfer GL posting fails, then applies exactly once after a successful retry.
52. Add concurrency coverage proving target cancellation and incoming re-booking transfer claim creation cannot both commit, including the case where either operation wins the target lock first.
53. Add failure-injection coverage proving an Applied re-booking transfer repairs each missing ledger side once and does not duplicate the customer on-account balance on retry.
54. Add authorization coverage proving an ordinary authenticated user cannot retry an already-approved Fund Transfer, while super admins and explicitly named workflow approvers can.
55. Add failure-injection coverage proving a failed ERP approval submission is reported as Draft and the user-triggered retry moves it into Pending without initiating any bank action.
56. Add coverage proving a partial refund leaves other funded claims reserved, while full source consumption rejects them.
57. Add coverage proving a Fund Transfer linked to a rejected or underfunded CRM claim cannot be posted, including an approval retry after a partial GL failure or stale-claim cleanup failure.
58. Add coverage proving an already-posted Fund Transfer retry reports partial completion when its linked CRM claim is Rejected, without changing existing GL entries.
59. Add a concurrency regression proving refund approval recovery cannot reset FinancePending after a concurrent Finance action creates and links the payout voucher.
60. Add failure-injection coverage proving final payout approval reports partial completion when `markCrmRefundPaid` returns `{ok:false}` or throws, while keeping payout approval state intact.
61. Add a concurrency regression proving an approved CRM refund payout cannot be deleted or have its GL reversed, and that deletion racing approval either sends the unpaid voucher back or returns conflict.
62. Add coverage proving a refund payout below or above NetAmount cannot be approved and the exact amount can.
63. Add concurrency coverage proving an approved CRM refund payout cannot be edited and a payment approval racing a pending edit causes the edit to return conflict without changing voucher fields.
64. Add concurrency coverage proving CRM refund payout approval validates the live amount, date, mode, bank, and customer account under the same row lock used for the Pending-to-Approved transition.
65. Add failure-injection coverage proving GST document issuance failure after refund settlement is retried for a Paid refund, while refunds with intentionally cancelled GST-note history are not automatically reissued.
66. Add coverage proving the GL recovery screen can retry a failed `crm-refund` posting, does not duplicate an existing posting, and skips a refund that is no longer Paid.
67. Add coverage proving a failed `crm-refund-payment` GL posting can be retried idempotently, and that a pending or rejected payout voucher is skipped without creating ledger entries.
68. Add UI/API coverage proving CRM refund payout approval clearly states that the external bank payment is manual and that CivilierERP does not move funds.
54. Run the existing frontend and backend test suites and resolve failures before release; then perform role-based CRM journey testing against a representative database, especially booking approval, receipts and GL posting, cancellations/refunds, resale transfers, and customer-portal access.
55. Continue a route-by-route review of authorization, project scope, state transitions, transaction boundaries, audit logging, and reversals for every financial mutation.

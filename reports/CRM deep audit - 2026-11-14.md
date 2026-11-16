# CRM Module Deep Audit — 14 November 2026

## Scope and method

This is an ongoing deep audit of the current CRM implementation. Inventory found 49 CRM route files, 29 CRM-named service files, and 605 CRM route declarations. Earlier passes reviewed shared staff-auth/project-scope mounting, route-level permission patterns and the Change Unit workflow. The latest pass follows Agreement for Sale through Sale Deed, Possession Notice, Handover, and Ownership Change. The workspace already contains uncommitted user changes; findings and fixes below are limited to the paths reviewed.

**Verification after the fix:** 30 CRM backend suites passed (340 tests); 4 CRM frontend suites passed (72 tests). These are the existing regression suites and do not specifically exercise the new unit-change edit locks or transaction boundary. The focused database-backed Change Unit E2E script could not connect to its configured development SQL Server, so it ran no workflow steps and changed no data. `npm run typecheck` was interrupted before the fix after several minutes of high CPU/memory use without producing output; the current patch has not been typechecked. No production database or live deployment was accessed.

## Executive summary

CRM has broad lifecycle coverage and several sound controls: route-level page rights, project-scope parameter guards on booking and unit-change IDs, approval transitions, guarded inventory holds, transactional source-booking closeout, retryable unit-change execution, and claim-aware customer-credit handling.

The Change Unit implementation had a high-priority approval-integrity issue and a recoverability gap; both have workspace fixes. The legal lifecycle had handover/snags, registry, query-payment, Agreement-link, post-approval document, registration-particular, execution-history, registry/deed linkage, proxy-response, deed-cancellation, replacement-deed payment amount, AFS registration/cancellation, AFS scheduling/completion, AFS Registry start-eligibility, AFS query-payment confirmation and creation/edit-validation, Sale Deed query-payment start and rework/confirmation race, Sale Deed customer-dispatch, generic Sale Deed stale-write, stale Senior approval prerequisites, duplicate/stale Senior submission, stale Director approval prerequisites, non-atomic senior/director approval/rejection bookkeeping, stale proxy-response on closed deeds or bookings, legal-assignment lifecycle/role validation, Sale Deed document review/request/upload/attachment/deletion approval races, and partial registry document batches; the possession-notice route had stale-state response/edit races; and ownership transfer had approval/cancellation and edit/submission races. Workspace fixes are recorded below. These follow-on changes have not been tested. Existing backend/frontend regression suites passed after the Change Unit changes. Database-dependent workflow checks could not be exercised. This audit does not certify the full CRM module as production-ready: broad lifecycle behavior was not dynamically exercised, and passing unit suites cannot establish all cross-route or database behavior.

## Findings

### P1 — Agreement registration and cancellation can race with AFS Registry completion — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/mark-registered` and `/cancel`; `backend/routes/crmAfsRegistry.js`, `PUT /:id/complete`.

**Evidence:** Agreement registration and cancellation both made their status decisions before their write transaction, then updated the agreement by ID alone. AFS Registry completion similarly relied on a pre-transaction Scheduled check and could complete after the linked agreement had been cancelled.

**Impact:** Concurrent requests could end with a registered agreement being cancelled, or complete a registry tracker for an agreement that was already cancelled. Registration also depended on an out-of-transaction registry completion read, so concurrent state changes were not serialized.

**Remediation:** Agreement registration now locks and rechecks the agreement and latest registry inside its transaction before a status-conditional update. Cancellation updates only the exact status it checked and returns 409 if it changed. Registry completion locks the agreement first, rejects a missing/cancelled agreement, and updates only a still-Scheduled registry. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — AFS Registry scheduling can overwrite concurrent completion — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAfsRegistry.js`, `PUT /:id/schedule`.

**Evidence:** The endpoint checked for `Completed`, then updated the row by ID alone. A schedule request that passed its check before completion could run afterward and move the completed registry back to `Scheduled`.

**Impact:** The tracker could lose its completed status after the Agreement had already been marked Registered, reopening a physical-registration step that had already occurred.

**Remediation:** Scheduling now permits only Pending or Scheduled source states, updates only the state it read, and returns 409 if a concurrent transition wins. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — AFS Registry can start after eligibility changes or without an Agreement — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAfsRegistry.js`, eligible-bookings query and `POST /`.

**Evidence:** Start checked booking activity and confirmed query-payment, checked for an existing registry, and read the Agreement before inserting, but those checks and the insert were separate operations. It also allowed the Agreement lookup to return no row and inserted a registry with a null AgreementId, even though completion rejects a missing agreement. Concurrent starts could both pass the duplicate precheck and consume separate registry numbers before the unique constraint rejected one.

**Impact:** The registry tracker could be started for a now-inactive booking, after payment status changed, or with no usable Agreement to complete against. Simultaneous starts could waste a document number and rely on a database exception for normal conflict handling.

**Remediation:** Booking, query-payment, Agreement, and existing-registry checks now run under transaction locks before insertion. Starting requires a non-cancelled Agreement; the eligible-bookings list applies the same agreement-existence condition. Number allocation and insertion now share that transaction, with the unique BookingId constraint retained as the final guard. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — AFS Query Payment information and confirmation transitions can race — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAfsQueryPayment.js`, `POST /:id/info` and `POST /:id/confirm`.

**Evidence:** Both routes checked the current status before opening their write transaction. The info route could therefore attach files after a concurrent confirmation, while concurrent confirmation requests could both insert proof and log payment confirmation before either status update became visible. Their status updates were keyed by ID alone.

**Impact:** Duplicate proof and communication records could be created, and paperwork could be attached after the payment tracker was already Confirmed.

**Remediation:** Both transactions now lock and recheck the payment row. Info sending accepts only Pending or InfoSent and only changes Pending with a conditional update; confirmation accepts only InfoSent and conditionally changes it to Confirmed. Losing requests return 409 and roll back their attachments/logs. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — AFS Query Payment creation and amount edits do not fully protect their validated inputs — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAfsQueryPayment.js`, `POST /` and `PUT /:id`.

**Evidence:** Creation checked booking approval and Agreement status before inserting, without a transaction, so either could change before the tracker was created; a duplicate request could also consume an AQP number before the unique BookingId constraint rejected it. Amount fields used `parseFloat`, which accepts malformed strings such as `"2500oops"`. The Pending-only edit similarly checked status before writing and updated by ID alone, so it could race InfoSent and alter the amount after the customer received the paperwork.

**Impact:** A tracker could be created against stale Agreement/booking eligibility, malformed fee data could be silently accepted, or the government fee sent to the customer could change after dispatch.

**Remediation:** Creation now locks and rechecks the approved, active, unfrozen booking, executed/registered Agreement, and existing tracker; sequence allocation and insert share the transaction. Amount parsing rejects negatives, malformed values, excessive precision, and out-of-range amounts. Fee edits update only a still-Pending row and return 409 if the state moved. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Sale Deed Query Payment can be created against stale deed/booking eligibility — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /query-payment`.

**Evidence:** The route checked booking approval and the latest director-approved Sale Deed, then allocated a QP number and inserted the tracker in separate operations. The unique BookingId constraint handled duplicate starts only at insert time, and concurrent deed cancellation/rework or booking state changes could invalidate the earlier eligibility checks.

**Impact:** A tracker could be attached to a deed whose approval or live status changed after validation, or an ordinary duplicate start could consume a document number before the unique constraint rejected it.

**Remediation:** The endpoint now locks and rechecks the active, approved, unfrozen booking, latest live director-approved deed and its payable amount, and absence of a prior tracker. Number allocation and insertion share that transaction, while the unique index remains the final duplicate guard. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Sale Deed rework can race with payment confirmation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/rework`, `POST /query-payment/:id/info`, and `POST /query-payment/:id/confirm`.

**Evidence:** Rework checked the linked payment's Confirmed status before opening its transaction, then revised the deed and reset unconfirmed payment state. A confirmation could commit after the precheck, allowing rework to change the deed while its payment ended Confirmed. Info-send and confirmation also relied on an out-of-transaction deed-approval check, so rework could invalidate the deed after the check.

**Impact:** A confirmed government payment could remain attached to a deed that was revised, or staff could send/confirm paperwork for a deed whose approval had been withdrawn.

**Remediation:** Rework now locks and rechecks the active approved booking, deed, and linked payment before revision, and refuses to proceed if payment is Confirmed. Info-send and confirmation lock and recheck the live approved booking and deed before locking the payment row. A stale confirmation rolls back its proof and audit communication. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Sale Deed customer dispatch can race with rework or cancellation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/send-to-customer`.

**Evidence:** The route checked senior approval, Agreement status, and customer approval before writing `SentToCustomerAt` and resetting customer approval, but the update was by deed ID alone. A concurrent rework could clear senior approval, or cancellation/registration could make dispatch invalid after the check.

**Impact:** The deed could be recorded as sent for customer review after it had already been returned for rework or moved to a terminal state.

**Remediation:** Dispatch now locks and rechecks the active approved booking, deed, and linked Agreement in a transaction, conditionally updates only a still-approved nonterminal deed, and writes approval history in that same transaction. Stale requests roll back and return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Generic Sale Deed edits can overwrite a concurrent lifecycle transition — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id`.

**Evidence:** The route validated execution readiness, Registry completion, and the current approval/terminal state outside its update transaction. It then wrote a derived `Status` by deed ID alone. A concurrent cancellation or rework could therefore win after validation, then be overwritten by this stale update; other approval or execution fields could also change between the checks and write.

**Impact:** A cancelled deed could be moved back to an active status, or an edit could be accepted using stale execution/registration prerequisites.

**Remediation:** The update now includes the previously validated status, approval states, execution/registration fields, and customer-dispatch timestamp as compare-and-set predicates. If any lifecycle state changed, it rolls back and returns 409 instead of overwriting the newer state. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Senior Sale Deed approval can use stale prerequisite checks — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/approve`.

**Evidence:** The route checked legal assignment, required financial figures, and mandatory-document uploads before calling the approval service. Those related deed/document records could change before the approval transaction committed, and the route did not use the approval service's existing in-transaction `beforeApprove` hook.

**Impact:** An approver could approve a deed whose mandatory documents or figures no longer matched what the route checked.

**Remediation:** Senior approval now rechecks legal assignment, required figures, and the complete mandatory upload checklist in the approval transaction, locking both the deed and checklist rows until commit. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Director Sale Deed approval can outlive Senior or customer approval — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/director/approve`.

**Evidence:** The route checked Senior and customer approval before calling `approvalTransition`, but the director workflow's own status lock did not recheck those separate deed fields. A concurrent deed rework could clear the prerequisites while director approval still advanced. Director metadata and its communication/history entries were also written in a second transaction after the approval status committed.

**Impact:** A deed could remain director-approved after rework cleared Senior/customer approval, or the status could commit without its director metadata and communication/history if the follow-up transaction failed.

**Remediation:** Director approval now rechecks the live deed status and both prerequisites in the approval transaction. Director metadata, communication, and deed history are written through the approval service's `onFullyApproved` transaction callback; notification remains best-effort after commit. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Director rejection and deed rework can commit separately — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/director/reject`; `backend/services/approvalService.js`, rejection transaction callback.

**Evidence:** The director approval status was committed by `approvalTransition` before a second transaction created the deed revision, cleared Senior approval, reset mandatory documents, and wrote deed history. A failure between those transactions could leave Director Rejected while the old approved deed and its customer state remained live.

**Impact:** The deed could show a rejected director workflow while still carrying the prior approved version, or the rejection action could return an error after the rejection status had already committed but cleanup failed.

**Remediation:** Added an optional `onRejected` callback to the approval service and moved the deed recheck, revision, send-back, document reset, and deed history into the rejection transaction. The callback revalidates the live deed and Senior/customer approvals while the workflow row is locked. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Senior rejection and deed send-back can commit separately — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/reject`; `backend/services/approvalService.js`, `onRejected` callback.

**Evidence:** Senior rejection first committed the SeniorApprovalStatus as Rejected, then opened another transaction to snapshot the deed, clear its customer state, reset mandatory documents, and write history. A failure between those commits could leave a rejected workflow attached to the unrevised deed version.

**Impact:** The rejection might appear complete while the deed and its previously approved customer-visible documents remained unchanged.

**Remediation:** Senior rejection now uses the same `onRejected` transaction callback as director rejection. It locks and rechecks the live deed and linked payment, rejects send-back when payment is Confirmed, then commits the rejection, revision, document reset, and history together. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Senior approval can commit without customer dispatch and its records — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/approve`; `backend/services/approvalService.js`, `onFullyApproved` callback.

**Evidence:** The approval service committed SeniorApprovalStatus = Approved first; a separate transaction then recorded SeniorApprovedAt/by, sent the deed to the customer, and added deed history. A failure in the follow-up left an approved deed that was not dispatched, without matching approval history or communication.

**Impact:** The workflow could appear approved while customer review was never started, leaving the deed stranded and the audit trail incomplete.

**Remediation:** Senior status, approver metadata, customer dispatch state, approval history, and communication log now share the approval service's final-approval transaction callback. Notification remains best-effort after commit. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Proxy customer responses can mutate a closed Sale Deed — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/proxy-customer-approve` and `/proxy-customer-recheck`.

**Evidence:** The actions checked that the deed had been sent and that the customer response was not already Approved, then conditionally updated only the prior customer-response value. They did not require current Senior approval or exclude Cancelled/Registered deed statuses in the update.

**Impact:** A stale or repeated proxy action could change customer-response fields on a deed after staff cancelled it or it was registered.

**Remediation:** Both actions now require a live nonterminal deed with Senior approval both in the precheck and in the conditional update. They also validate the route ID with `parseId`; stale actions return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Senior submission can race with another submit or terminal deed transition — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/submit`.

**Evidence:** Submission checked for a NULL/Rejected Senior status, complete deed figures, and assigned Legal Executive before writing Pending and approval history separately. Concurrent submissions could both pass; cancellation/registration or a legal reassignment could change the deed after those checks.

**Impact:** The endpoint could report successful duplicate submission or overwrite a newer lifecycle state; the history entry could also be missing if its separate write failed.

**Remediation:** Submission now locks and rechecks the active approved booking, deed status, required figures, and assigned Legal Executive (unless the actor has the configured approver override), conditionally advances only NULL/Rejected nonterminal states, and writes the history in the same transaction. Concurrent or stale requests return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Sale Deed legal assignment accepts any active user and can be changed mid-review — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/assign-legal`.

**Evidence:** The endpoint accepted any numeric user ID without checking that it was a Legal Executive, allowed reassignment while Senior Approval was Pending/Approved, and wrote the assignment and history separately. The client picker filtered choices, but direct API requests bypassed that list.

**Impact:** A deed could be assigned to an unrelated active account, transfer legal-document access to that user, or have its reviewer changed while Senior Approval was in progress. A history-write failure could also leave an unlogged assignment.

**Remediation:** Assignment now accepts only active users in the Legal Executive roles, is limited to unsubmitted/rejected nonterminal deeds, locks and rechecks booking/deed state, and writes assignment plus history in one transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Sale Deed document review can race with approval or file changes — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, document request/upload/attach/delete endpoints and `PUT /:id/documents/:docId`, `PUT /documents/bulk-review`.

**Evidence:** Review paths, document request, and initial upload checked deed/file state before changing checklist rows, without serializing against Senior Approval. Attach and delete used out-of-transaction approval and lifecycle checks, so replacement, removal, adding a requirement, or uploading a requirement could race checklist validation. Bulk review also accepted partially numeric document IDs.

**Impact:** Approval and document review could observe inconsistent checklist state, or a document could be marked Verified without its required file.

**Remediation:** Document request/upload/attach/delete and review now lock the active approved booking, deed, and matching document in transaction order and recheck terminal and approval state. Verification checks file presence while locked; staff uploads recheck the assigned Legal Executive while the deed is locked. Batch upload and per-document bulk review remain atomic at their documented scope; bulk review validates each ID and keeps per-document success/failure reporting and audit logging. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Proxy-recorded customer response can race with booking cancellation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/proxy-customer-approve` and `/proxy-customer-recheck`.

**Evidence:** Both endpoints validated the booking's active/approved state before opening the transaction, then wrote the customer response based on deed predicates alone. A concurrent booking cancellation could commit without necessarily changing the deed row before the response write.

**Impact:** Staff could record a proxy customer decision against a booking that had already become inactive or left Approved state.

**Remediation:** Both actions now lock and recheck the booking first, then lock and recheck the deed's Senior approval, sent-to-customer, terminal, and current response state before updating and writing communication/history records. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — A pending unit change's application and commercial terms remain editable after approval submission — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmBookings.js`, `submitUnitChangeApplication` (approximately lines 847–883); `backend/routes/crmApplications.js` `PUT /:id` (approximately lines 476–540); application parking and extra-charge write routes.

**Evidence:** Submitting a unit-change application moves `CrmPropertyChangeRequest.Status` from `Draft` to `Pending`, but deliberately leaves the linked `CrmApplication.Status` as `Draft` until unit-change approval executes. The normal application edit route allows unit/project/plan edits while an application is `Draft`; the parking and extra-charge application routes also allow writes in `Draft`. These paths do not check for a linked unit-change request in `Pending`. The approval request stores a snapshot on the property-change row, while execution later consumes the linked application's parking and extra-charge records.

**Impact:** While the request is waiting for approval, staff with ordinary CRM edit rights can still change the linked application (including selections that affect the eventual booking) after the approver has reviewed its snapshot, without resubmitting the request or invalidating approval. The approved request snapshot and the booking created from the application can therefore describe different terms. This breaks maker-checker integrity and can change the sold unit or commercial add-ons after review.

**Recommendation:** Treat a non-Draft open unit-change request as a lock on all linked application mutations, including unit/project/rate/plan, parking holds, extra charges, and other approval-relevant fields. Enforce the lock in shared backend write services/routes (not only the UI), and recheck it under a transaction when approving/executing. Alternatively, transition the application to a dedicated submitted state and make every edit path reject it until the request is withdrawn/rejected. Add an E2E regression case that submits, attempts each edit, then verifies approval uses exactly the reviewed snapshot.

**Confidence:** High. The status update and the edit guards are directly visible in source. Existing CRM regression tests pass after the change, but the E2E script could not run because the development SQL Server was unreachable.

**Remediation:** Added a shared unit-change application edit guard and applied it to application edits/cancellation/deletion, parking allotments and holds, extra charges, co-applicants, bank details, and application documents. The wizard now routes locked submitted requests to their unit-change review page. Draft creation and its linked application, copied buyer details, inventory holds, and charges now share one SQL transaction, with the source booking and eligibility snapshot rechecked under lock. A focused E2E attempt is still required to verify the full path and all edit denials.

### P2 — Unit-change draft setup spans multiple commits and can strand an open request — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmBookings.js`, `POST /:id/unit-change`, from request insertion through target application creation/linkage (approximately lines 774–825); unique open-source index in `backend/migrations/641-660/658-crm-unit-change-draft.sql`.

**Evidence:** The request is committed as `Draft` first. The application, unit/parking holds, copied buyer details, and extra charges are created afterward. The catch block compensates for ordinary thrown errors, but cannot run if the process exits after the first commit. The partial unique index treats `Draft` as open, and there is no recovery shown for a Draft whose `TargetApplicationId` is null.

**Impact:** A process crash in this window can leave a permanent Draft row that blocks further unit changes on the source booking while exposing no usable application to continue. A crash after creating the application but before linking it can also leave an orphan application/hold.

**Recommendation:** Put request creation and all database-side draft setup in one transaction where feasible, or add an idempotent repair job that detects stale Draft rows, resumes linkage/hold setup, or closes the request and cleans up the application/holds. Ensure the unique index and recovery logic agree on what counts as a live Draft.

**Confidence:** High for the crash window; database transaction boundaries are explicit in the route.

**Remediation:** The Change Unit request, target application, linked application details, holds, and extra charges are now created in a single transaction. Document numbering was updated to reuse an existing transaction so application numbering participates in that atomic setup. The source booking is locked and the preview context is recomputed inside the transaction before any rows are committed.

### P2 — Handover completion accepts string values as customer and dues attestations — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmHandover.js`, `PUT /:id` completion validation and SQL BIT binding.

**Evidence:** Completion previously used JavaScript truthiness checks for `FinalDuesCleared` and `CustomerAcknowledged`. A JSON string such as `"false"` is truthy, passes both checks, and the subsequent `b.field ? 1 : 0` binding stores it as SQL true.

**Impact:** A caller can complete handover while sending an explicit false value for either required confirmation. This records customer acknowledgment or cleared final dues without the supplied input attesting to it.

**Remediation:** Both fields now reject non-boolean values when supplied, and completion requires the literal boolean `true` for each. This follow-on change has not been tested.

### P2 — Registry completion accepts string attendance values — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /registry/:id/complete`.

**Evidence:** The endpoint used truthiness checks for `BuyerAttended` and `SellerAttended`; a string such as `"false"` passed. The completion SQL then hardcoded both stored attendance flags to true.

**Impact:** A request can mark the registry complete and record both parties as present when the submitted values explicitly say false.

**Remediation:** The endpoint now rejects non-boolean attendance values and requires both literal booleans to be true before completion. This follow-on change has not been tested.

### P1 — Registry documents can change after completion and completion has a checklist race — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, registry document upload/request/review and `PUT /registry/:id/complete`.

**Evidence:** The completion route counted verified mandatory documents before opening its transaction and did not recheck or lock them before marking the Registry Completed. Review used an out-of-transaction file/status check; document request also checked terminal state and duplicate requirements outside a transaction, so either could race completion. The review route used the document ID without verifying it belonged to the registry ID in the URL.

**Impact:** A concurrent document review could invalidate the checklist between validation and completion. After completion, staff could also rewrite the evidence status, and a mismatched URL could update a different registry's document in the same project.

**Remediation:** Completion rechecks and locks mandatory checklist rows inside its transaction. Upload, request, and review now take booking then registry locks, check terminal state while locked, and make their writes in that transaction; review additionally locks the matching document and verifies file presence under lock. Upload batches roll back together on failure, and request requires a boolean `IsMandatory`. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Registry schedule and cancellation can overwrite completion — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /registry/:id/schedule`, `/reschedule`, `/cancel`, and `/complete`.

**Evidence:** Schedule and reschedule validated the status before writing, then updated by ID without a state predicate. Schedule could set a Completed registry back to Scheduled. Cancellation wrapped its update in a transaction but likewise updated by ID alone, so a cancellation that passed its earlier status check could change a registry to Cancelled after completion had registered the linked Sale Deed.

**Impact:** Registry and Sale Deed terminal states could contradict each other, potentially allowing a second appointment or cancellation record after the legal registration was recorded.

**Remediation:** Schedule and reschedule now lock and recheck the active booking and registry, and commit the appointment change with its history in one transaction. Cancellation conditionally updates only a nonterminal registry in its transaction and rolls back if it loses the race. Completion also checks that its terminal update affected the locked row. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Concurrent query-payment confirmations can duplicate proof and confirmations — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /query-payment/:id/confirm`.

**Evidence:** The route checked for `InfoSent` before opening a transaction, inserted proof, then updated the query-payment row by ID alone. Concurrent confirmation requests could both pass the stale check, insert separate proof attachments, and report success.

**Impact:** The CRM could store duplicate proof and confirmation communications for one government payment and overwrite the confirmer/amount fields.

**Remediation:** The confirmation transaction now locks and rechecks the active approved booking, approved deed and `InfoSent` payment before inserting proof and confirming. The confirmation update also requires the payment to remain `InfoSent`; if another request wins, the losing transaction rolls back its proof attachment. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Any positive payment amount can unlock Registry — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /query-payment/:id/confirm`.

**Evidence:** The confirmation route only required `ConfirmedAmount > 0`, even though the UI shows the deed's net payable amount and Registry creation gates on `Status = Confirmed`. A small partial amount therefore marked the entire government payment Confirmed and unlocked registry scheduling.

**Impact:** A registry could proceed while the recorded payment was less than the approved deed's net stamp duty and registration fee after credit.

**Remediation:** Confirmation now requires a finite positive amount that covers the linked deed's net payable amount. The final conditional status update rechecks this amount against the current deed values in the same transaction, so an underpayment cannot unlock the Registry. This follow-on change has not been tested.

### P2 — Manual Sale Deed creation can link another booking's Agreement — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /`.

**Evidence:** The route checked that the booking's latest Agreement was Registered, but then preferred a caller-supplied `AgreementId` when inserting the Sale Deed without verifying that ID referred to the checked agreement.

**Impact:** A deed could be created for one booking while referencing a different booking's Agreement, corrupting the legal document chain and downstream agreement/deed displays.

**Remediation:** The route now rejects a supplied AgreementId that differs from the booking's registered agreement and always inserts the verified agreement ID. This follow-on change has not been tested.

### P1 — Mandatory deed documents can change after Senior Approval — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, deed document upload, attach, request, review, and delete routes.

**Evidence:** Senior approval checks that mandatory documents have been uploaded. However, upload/attach and document-request routes remained available after `SeniorApprovalStatus` became Approved, allowing approved files to be replaced or new mandatory requirements added without restarting the approval chain. Document rejection could also alter the approved package.

**Impact:** The legal executive could change evidence or requirements after senior review while the same senior approval remained in force. This breaks the link between the reviewed document package and the approval.

**Remediation:** Upload, attach, and new document requests now reject an approved deed and include a status predicate in their writes to close the check/write race. Rejection of a document after senior approval is blocked and staff are directed to the deed rework flow; existing delete protection remains. This follow-on change has not been tested.

### P1 — Generic deed editing can overwrite registered particulars — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id`.

**Evidence:** When the deed already had a RegistrationNo, the route skipped the gate intended for first-time registration entry but continued applying caller values for RegistrationNo, BookNo, PartNo, RegistrationDate, and SubRegistrarOffice. Those fields are also copied from Registry completion, so a later generic edit could replace the official registry details while the deed stayed Registered.

**Impact:** The CRM could show a different registration number or office than the completed Registry record and the customer-facing legal deed.

**Remediation:** The route now loads the related completed-registry state and rejects changes to registration particulars after registry completion, deed registration, or first registration-number entry. Unchanged values remain accepted for full-form updates. This follow-on change has not been tested.

### P2 — Corrections to the executed-by attribution are not recorded — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id` execution field update.

**Evidence:** The route intentionally permits correcting `ExecutedBy` after initial execution, but only logs the first setting in `CrmSalesDeedApprovalLog`. Later changes to the signer name update the deed without a corresponding history entry. Whitespace-only values could also be persisted as the execution attribution.

**Impact:** The person recorded as having signed the deed could change without an audit trail, weakening accountability for the real-world execution event.

**Remediation:** Whitespace-only signer values are rejected. Corrections to an existing signer are now logged in the same transaction as the deed update, including the old and new attribution. This follow-on change has not been tested.

### P1 — Registry can be created without the live Sale Deed or its confirmed payment — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /registry`.

**Evidence:** The route required a Confirmed query-payment but treated the current Sale Deed as optional, inserting `SalesDeedId = NULL` when no non-cancelled deed existed. It also did not verify that the Confirmed payment belonged to the current deed. The deed can be cancelled after payment confirmation, leaving the booking-level payment row behind. In addition, the verified executed-deed file was read before the creation transaction, and the Started history was written after commit.

**Impact:** A registry could be created after deed cancellation with no linked legal deed, or use a confirmation associated with a previous deed version.

**Remediation:** Registry creation now requires a live, director-approved deed and a confirmed payment explicitly linked to it. The transaction locks and rechecks the booking, deed, and payment before inserting the Registry and checklist, so a cancellation or relink race fails with 409. It now also reads and locks the verified executed-deed source inside that transaction and writes Started history before commit. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Query-payment remarks can change after customer notification — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /query-payment/:id`.

**Evidence:** The route allowed remarks to change only when the row was Pending, but its update used `WHERE Id = @id` after a separate status read. A concurrent Info send could move the payment to InfoSent before the remarks update landed.

**Impact:** The internal remarks could change after the customer had already received the payment details, leaving staff and customer-facing records inconsistent.

**Remediation:** The update now includes `Status = Pending` in its SQL predicate and returns 409 if the status advanced first. This follow-on change has not been tested.

### P2 — Concurrent query-payment info sends can duplicate the initial dispatch — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /query-payment/:id/info`.

**Evidence:** The route read Pending status before opening its transaction, then inserted attachments and changed status to InfoSent by ID alone. Two requests could both pass the stale read and each commit a batch plus a customer communication entry.

**Impact:** The customer could receive duplicate payment-information dispatches, and `InfoSentAt`/`InfoSentBy` would be overwritten by the later request.

**Remediation:** The transaction now locks and rechecks the active approved booking, approved deed, and payment status before attachments are added. The initial transition is conditional on Pending; if another send wins, the losing transaction rolls back its attachments and returns 409. Follow-up information remains allowed when the request starts from InfoSent. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Proxy proof can be appended after payment confirmation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `POST /query-payment/:id/proxy-proof`.

**Evidence:** The route rejected a payment already Confirmed before opening its transaction, then inserted proof without checking status again. It also accepted any unconfirmed status, including Pending before payment information had been sent, and did not recheck the booking or deed lifecycle.

**Impact:** Proof could be attached after a concurrent confirmation, before the customer was told what to pay, or against an inactive booking or unapproved/cancelled deed.

**Remediation:** The route now validates the ID, locks the active approved booking, locks and checks the approved live deed, and requires the payment to remain `InfoSent` under lock before inserting proof. A confirmation or lifecycle transition that wins first causes the upload transaction to roll back and return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Proxy customer approval and recheck can overwrite each other — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/proxy-customer-approve` and `PUT /:id/proxy-customer-recheck`.

**Evidence:** Both proxy routes checked `CustomerApprovalStatus` before opening a transaction, then updated the deed by ID alone. Concurrent approval and recheck requests could both pass the initial check and the later write would silently overwrite the first customer response.

**Impact:** The recorded customer response, approval timestamps, and director handoff state could contradict the first response actually entered by staff.

**Remediation:** Each route now updates only if `CustomerApprovalStatus` still equals the value read and `SentToCustomerAt` remains set. A losing request rolls back its communication/history rows and returns 409. This follow-on change has not been tested.

### P1 — Sale Deed cancellation can race with registry completion — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /:id/cancel`.

**Evidence:** Cancellation checked deed status before beginning its transaction, then changed the deed status by ID. Registry completion locks the booking and registry, then marks both Registry and Sale Deed Registered. A cancellation using a stale precheck could overwrite the deed to Cancelled after the Registry had committed as Completed.

**Impact:** The same registered legal instrument could be represented as a Cancelled Sale Deed with a Completed Registry, and cancellation could report success after the legal registration committed.

**Remediation:** Cancellation now takes the booking lock used by registry completion, rechecks deed state under lock, and conditionally updates only a nonterminal deed. Deed history and open-registry cancellation are part of the same transaction. This follow-on change has not been tested.

### P1 — Confirmed payment can be carried to a replacement deed with a shortfall — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, Sale Deed `POST /` payment relink and `POST /registry`.

**Evidence:** When a deed was cancelled and replaced, deed creation preserved `CrmQueryPayment.Status = Confirmed` unconditionally. A replacement deed could have higher net stamp duty/registration fees than the `ConfirmedAmount`. Registry creation checked only the status and link, so that old confirmation could unlock registration despite a shortfall.

**Impact:** A booking could proceed to Registry while the recorded government payment did not cover the current deed's approved net amount.

**Remediation:** On relink, confirmation is retained only when the paid amount covers the replacement deed; otherwise confirmation fields are cleared and the payment returns to Pending for updated customer paperwork. Registry creation also checks the locked current deed amount against the locked confirmation amount. This follow-on change has not been tested.

### P1 — A snag can be raised after handover completion, or race the completion check — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmHandover.js`, `PUT /:id` and `POST /:id/snags`.

**Evidence:** Handover completion checked for open snags before updating its status, with no shared lock around the check and update. Snag creation inserted a snag even if the handover had already become Completed; its follow-up status update only affected Scheduled/SnagInspection rows and its result was ignored.

**Impact:** The system could report Completed while a new unresolved defect existed, or a concurrent completion could commit after the snag check but before snag insertion.

**Remediation:** Completion now locks the handover and rechecks both status and open-snag count inside a transaction; the final update also has an open-snag predicate. Snag creation takes the same handover lock and rejects terminal statuses before inserting. This follow-on change has not been tested; `node --check backend/routes/crmHandover.js` and `git diff --check` passed.

### P2 — Sent possession notices can have their terms edited — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmPossessionNotice.js`, `PUT /:id`.

**Evidence:** The generic update route accepted changes to OfferedDate, ResponseDeadline, DeliveryMode, and Notes without checking notice status. Its own route comment says status advances only through the sequential action endpoints, but it did not make sent or acknowledged notice details immutable.

**Impact:** Staff could change the recorded terms or dispatch mode after the notice had been sent or acknowledged, leaving the stored notice inconsistent with the document the customer received while retaining its Sent/Acknowledged status and timestamps.

**Remediation:** The route now permits generic edits only while the notice is Draft and returns 409 for other statuses. This follow-on change has not been tested.

### P2 — Possession Notice response transitions and draft edits can overwrite a newer state — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmPossessionNotice.js`, send/acknowledge/dispute/retract/proxy actions, draft edit, and delete.

**Evidence:** These routes read the current state, then performed an update or delete by ID alone. Concurrent acknowledgment and dispute actions could overwrite one another. Similarly, a generic edit or delete could pass its Draft check, then run after another request sent the notice.

**Impact:** The saved customer response or dispatch terms could differ from the action that actually won, while both requests reported success.

**Remediation:** Every transition now includes its expected source status in the write and returns 409 if it lost the race. Draft edits and deletes are likewise conditional on the notice still being Draft. This follow-on change has not been tested; `node --check backend/routes/crmPossessionNotice.js` and `git diff --check` passed.

### P1 — Ownership change cancellation can race with final approval and transfer — Fixed in workspace; not yet verified

**Location:** `backend/services/crmOwnershipChange.js`, `cancel()` and `applyChange()`.

**Evidence:** `cancel()` previously read an allowed status, then updated the record by ID alone. Final approval is committed by the approval service before `applyChange()` starts its separate transfer transaction. A cancellation that had already read Pending could therefore write Cancelled after approval committed; `applyChange()` did not verify the locked row was still Approved and could transfer the booking anyway. Its failure recovery also reset the change to Pending without a status condition. Cancellation also updated the ownership row, linked draft application, and history in separate operations.

**Impact:** The booking could move to the new owner while its ownership-change record ended as Cancelled, cancellation could be overwritten by a stale recovery update, or a failed cleanup could leave the new owner's draft application behind after the change was cancelled.

**Remediation:** Cancellation now locks and checks the current state, then updates the change, cancels its linked draft application, and writes history in one transaction. The transfer transaction locks and requires an Approved row. Recovery resets to Pending only if the row is still Approved. This follow-on change has not been tested.

### P1 — Ownership change terms can change during submission — Fixed in workspace; not yet verified

**Location:** `backend/services/crmOwnershipChange.js`, `update()`, `attachDeed()`, and `submit()`; `backend/services/approvalService.js`, Pending transition.

**Evidence:** Detail edits and deed uploads checked Draft/Rejected before writing but updated by ID alone. Submission checked required fields before invoking the approval transition. A concurrent edit could therefore land after the record became Pending, or clear a required field after validation but before the Pending transition.

**Impact:** The approver could see a change with terms or deed evidence different from the version validated at submission, including missing mandatory details.

**Remediation:** Detail and deed writes now include Draft/Rejected in their SQL predicates and return 409 if the row has advanced. `approvalService.transition()` accepts an optional under-lock submission callback; ownership submission rechecks required fields and current ownership while the status transition holds the row lock. This follow-on change has not been tested.

### P1 — Sale Deed document register ignores project scope — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `GET /documents/all`.

**Evidence:** The cross-deed register joined each document to its booking and project, but did not add the request's `projectScope` predicate. The comparable Agreement document register does apply that scope.

**Impact:** A user with Sale Deed view rights but access to only selected projects could retrieve document filenames, applicant names, deed details, and other metadata from outside their assigned project scope.

**Remediation:** The query now applies `projectPredicate` to the joined booking's `ProjectId` whenever project scope is present. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Sale Deed bulk document review bypasses project scope — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmSalesDeed.js`, `PUT /documents/bulk-review`.

**Evidence:** Document IDs are accepted in the request body, so the route's `:id`/`:docId` project parameter guards do not run. The per-document lookup joined documents to deeds and bookings but previously did not filter against `req.projectScope`.

**Impact:** A user with edit rights scoped to selected projects could review documents belonging to another project by submitting its document IDs.

**Remediation:** The per-document lookup now applies the booking project's scope predicate before allowing review. Out-of-scope IDs are treated as unavailable and are not mutated. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement bulk document review can race execution or file changes — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /documents/bulk-review`.

**Evidence:** The route checked booking/execution state and file presence before opening a per-document transaction, then updated the row by document ID alone. Concurrent execution or document changes could land between those checks and the update.

**Impact:** A document could be reviewed against stale evidence, or rejected after its Agreement was executed, despite the route intending to freeze rejection after execution.

**Remediation:** Each item now locks and rechecks booking, Agreement, and matching document state before updating. Verified status requires the file to still exist; rejection remains blocked after execution/registration. The update, audit entry, and legal-milestone sync stay in the same per-item transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement single-document review accepts arbitrary states and races execution — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/documents/:docId`.

**Evidence:** The endpoint accepted any submitted status and checked booking, execution, and file state before opening its transaction. It then updated by document ID alone, allowing stale checks or a direct API request to bypass the intended Verified/Rejected review states.

**Impact:** A caller with edit rights could put a document into an unsupported status, or race Agreement execution and change review evidence against stale file/lifecycle state.

**Remediation:** Status is now limited to Verified/Rejected. The transaction locks booking, Agreement, and matching document, rechecks execution and file prerequisites, and conditionally updates the row with audit and milestone sync in the same transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement document requests can duplicate or race execution — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `POST /:id/documents/request`.

**Evidence:** The route checked for an open request and calculated the next version outside a transaction. Concurrent requests could both create an open requirement for the same document type, and execution could complete after the out-of-transaction state check but before insertion. A string such as `"false"` was also treated as mandatory because the field used truthiness.

**Impact:** The checklist could contain duplicate outstanding requirements or be changed after execution, and a nominally optional document could unexpectedly block completion.

**Remediation:** The route now requires a boolean `IsMandatory`, locks booking and Agreement state, and performs the duplicate-request check, reuse/update or version allocation, and insert within one transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement document version allocation can race execution or duplicate versions — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `POST /:id/documents` and `POST /:id/documents/upload`.

**Evidence:** The add and multi-file upload routes checked booking/Agreement lifecycle and calculated the current document version before opening their write transactions. Concurrent adds/uploads could allocate duplicate versions, and execution could occur after the precheck but before insertion.

**Impact:** The document history could contain duplicate version numbers or a new document attached after the Agreement was already executed.

**Remediation:** Both routes now lock and recheck booking and Agreement state before file/document mutation. The add route allocates its version and synchronizes the legal milestone in its transaction; multi-file upload calculates versions and fills any open request in its all-or-nothing transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement staff attachment can race execution or request fulfillment — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `POST /:id/documents/:docId/attach`.

**Evidence:** The route checked that a document was Requested/Rejected and that the Agreement was not executed before opening its transaction, then updated the document by ID alone. Execution or another fulfillment could win between those checks and the write.

**Impact:** A file could be attached after execution or overwrite a document slot that had already been fulfilled through another path.

**Remediation:** Attach now locks and rechecks the active booking, Agreement, and matching document, restricts the update to Requested/Rejected states and nonterminal Agreements, and commits the file with its milestone sync atomically. Stale requests return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Customer Agreement upload can race staff review or execution — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmPortal.js`, `POST /agreement/documents/:docId/upload`.

**Evidence:** The portal checked application ownership, open document state, booking activity, and Agreement status before updating the document by ID alone. Execution or staff fulfillment could change the row after these checks. The communication record was written separately after the file update.

**Impact:** A customer upload could overwrite a slot already fulfilled by staff, land after execution, or commit without its communication history.

**Remediation:** The route now locks and rechecks the booking, Agreement, and matching document in transaction order, preserves the IdentityProof early-upload rule, conditionally updates only Requested/Rejected rows, and writes communication in the same transaction. Notification runs after commit and cannot turn a successful upload into a misleading failure response. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Portal Agreement response can overwrite a concurrent decision — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmPortal.js`, `POST /agreement/respond`.

**Evidence:** The portal checked Senior/Customer approval state before opening a transaction and then updated the Agreement by ID alone. Concurrent approve/recheck requests could both pass, and the route did not serialize against booking cancellation or Agreement execution.

**Impact:** The saved customer decision, recheck revision snapshot, and approval history could disagree with the request that actually won, or be recorded after the Agreement/booking was no longer eligible.

**Remediation:** The response transaction now locks the active booking and Agreement, rechecks portal ownership, dispatch, approval, and nonterminal state, and conditionally updates the expected customer-response state. Revision snapshot, approval log, and communication share the transaction; notification runs after commit. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Portal Agreement date proposals can race customer response or lifecycle changes — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmPortal.js`, `POST /agreement/propose-date` and `/agreement/date/accept`; `backend/services/crmWorkflowGuards.js`, `acceptAgreementDate`.

**Evidence:** The portal checked customer approval and sent state before opening the date-negotiation transaction, then called the turn-taking helper without locking/rechecking the booking. A concurrent recheck, cancellation, or execution could invalidate the portal action after its precheck. The helper also restarted the date approval cycle without passing its transaction executor, so the cycle marker could commit separately from the accepted date state.

**Impact:** Date history and negotiation state could be recorded for an Agreement whose customer approval was withdrawn or whose booking was inactive, and an accepted date could be left without a matching approval-cycle marker.

**Remediation:** Both portal date actions now lock and recheck the active booking and Agreement, including sent, Senior-approved, customer-approved, and nonterminal state, before calling the date helper. Communication commits with the date history/state. The helper passes its transaction executor to approval-cycle restart so its audit marker participates in the same transaction. Notifications run after commit. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Staff Agreement date actions can outlive booking or Agreement state — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/propose-date`, `/date/accept`, and `/proxy-date-accept`.

**Evidence:** Date proposal and acceptance checked booking/Agreement state before opening the date transaction. They committed the date-helper writes, then wrote communication separately, so booking cancellation or execution could race the action and a communication-write failure could leave an unlogged date change. Proxy acceptance also relied on pre-transaction customer/proposal checks and did not lock the booking.

**Impact:** Staff could propose or accept a date after the underlying booking or Agreement became ineligible, or the date history/negotiation state could commit without its communication record.

**Remediation:** Staff proposal and acceptance now lock and recheck active booking and live, sent, Senior-approved Agreement state inside the transaction. Date history/state and communication commit together. Proxy acceptance performs the same booking/Agreement checks before its transaction-locked date-turn helper. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement proxy approval can overwrite a concurrent customer response — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/proxy-customer-approve`.

**Evidence:** The route checked the customer response before its transaction and then updated the Agreement by ID alone. A concurrent portal recheck, approval, or lifecycle change could win after the check and be overwritten by the proxy action.

**Impact:** Customer approval state and the staff-proxy audit trail could diverge from the response that actually won, or the route could approve an Agreement after it was no longer eligible for customer review.

**Remediation:** The transaction now locks and rechecks the active booking and sent, Senior-approved, nonterminal Agreement; it conditionally updates the expected customer-response value and writes approval history and milestone sync in the same transaction. Stale requests return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement proxy recheck can overwrite a concurrent customer response — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/proxy-customer-recheck`.

**Evidence:** The route checked for an outstanding customer response before opening its transaction, then updated the Agreement by ID alone and created its revision snapshot from that stale read. A portal approval or another recheck could race that precheck.

**Impact:** The final customer response, recheck count, revision snapshot, and proxy approval log could describe different winning actions.

**Remediation:** The route now locks and rechecks the active booking and Agreement, conditionally updates the expected response value, and creates the revision snapshot and approval log in the same transaction from the locked Agreement state. Stale requests return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement proxy date proposal can outlive customer approval or booking state — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/proxy-propose-date`.

**Evidence:** The route checked customer approval and proposal turn before opening its transaction, then called the date helper without locking/rechecking the booking or current Agreement lifecycle. A concurrent customer recheck, cancellation, or execution could invalidate the proxy action after its precheck.

**Impact:** Staff could record a customer date proposal and proxy audit entry after customer approval was withdrawn or the Agreement/booking was no longer eligible.

**Remediation:** The route now validates the ID strictly, locks and rechecks the active booking and sent, Senior-approved, customer-approved, nonterminal Agreement within the transaction, then commits the date history/state and proxy log together. Stale requests return a conflict. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement proxy attachment can replace an existing document or race execution — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `POST /:id/documents/:docId/proxy-attach`.

**Evidence:** The route read the document before the transaction, then replaced its file and forced its status to Uploaded by document ID alone. It did not verify the document belonged to the Agreement within the write, ensure the slot was still Requested/Rejected, or serialize with booking cancellation and Agreement execution.

**Impact:** A proxy upload could overwrite a submitted/verified document, mutate a different lifecycle state, or land after the booking/Agreement became ineligible. Its audit log also always claimed the old state was Requested.

**Remediation:** The route now validates both IDs strictly, locks booking then Agreement then the matching document, accepts only Requested/Rejected slots, and conditionally updates the same Agreement/document while the Agreement is nonterminal. The audit entry uses the locked prior status; stale writes return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Portal Agreement reads expose documents after booking or Agreement cancellation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmPortal.js`, `GET /agreement`, `/agreement/documents`, and `/agreement/documents/file/:docId`.

**Evidence:** These routes verified the customer's application ownership, but their SQL could still return a sent Agreement or its files when the linked booking was inactive/cancelled/rejected, or when the Agreement itself was cancelled. The timeline already suppresses inactive bookings, so direct Agreement endpoints could disclose stale records outside the active customer journey.

**Impact:** A customer retaining portal access could continue retrieving Agreement metadata and document contents after the underlying booking or Agreement had been closed.

**Remediation:** Each read now requires an active, non-cancelled/non-rejected booking and a non-cancelled Agreement in addition to application ownership and the existing dispatch/IdentityProof visibility gate. This follow-on change has not been tested; syntax and diff checks passed.

### P1 — Agreement execution can race approval, document review, or booking cancellation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/mark-executed`.

**Evidence:** The route validated approval, date, legal assignment, mandatory documents, and booking eligibility before its transaction. Inside the transaction it updated status by Agreement ID alone, without rechecking those gates or serializing with booking/document mutations. A customer recheck or document rejection could land after the precheck, yet execution and its brokerage unlock would still commit.

**Impact:** An Agreement could be marked executed, legal milestones completed, and brokerage unlocked despite lacking current customer approval, a valid date/assignment, verified mandatory documents, or an active booking.

**Remediation:** The execution transaction now locks booking, Agreement, and mandatory document rows in the shared lifecycle order; rechecks all execution gates under those locks; and conditionally updates only a still-Draft, fully approved, dated, assigned Agreement. Audit, milestone sync, and brokerage unlock remain in that transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement registration can race booking cancellation — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/mark-registered`.

**Evidence:** The route checked booking eligibility before opening its transaction. The transaction then locked Agreement and AFS Registry but did not lock/recheck the booking, so cancellation could commit while registration was being recorded.

**Impact:** Staff could register an Agreement after its underlying booking was cancelled or rejected, leaving a legal lifecycle transition detached from the active sale.

**Remediation:** Registration now locks and rechecks the active booking first, then locks the Agreement and registry, verifies the Agreement still belongs to the checked booking and remains Executed, and records registration/audit atomically. Stale/inactive cases return 409. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement resend can reset a completed customer approval — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/send-to-customer`.

**Evidence:** The route reset `CustomerApprovalStatus` to Pending on every call and wrote optional date history/state from a pre-transaction document/approval check. A repeat request after customer approval could erase the approval, and concurrent recheck/approval or cancellation could race the send.

**Impact:** Customer decisions could be silently discarded or the portal could be reopened for an Agreement no longer eligible to be sent.

**Remediation:** The transaction now locks and rechecks booking, Agreement, and its documents; only an unsent Agreement or one explicitly awaiting a customer recheck may be sent. The status update compares the expected response state, and any proposed date uses the shared transactional turn-taking helper. The send log and milestone sync remain atomic. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Senior Agreement approval and auto-send were split across commits — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/approve`; `backend/services/approvalService.js`, `transition` callbacks.

**Evidence:** The shared approval service committed `SeniorApprovalStatus = Approved` before the route opened another transaction for senior approver metadata, milestone synchronization, and auto-send. A failure between commits could leave a fully approved Agreement without its business fields or customer dispatch; booking and mandatory-document eligibility were also checked before the approval row lock.

**Impact:** The displayed approval state could disagree with legal metadata and milestones, and the intended automatic customer dispatch could be skipped while the approval appeared complete.

**Remediation:** Approval now uses a pre-lock callback to lock/recheck the active booking before the Agreement row, a locked approval callback to recheck lifecycle, Legal Executive, and mandatory file gates, and a fully-approved callback to write metadata, milestone, dispatch, logs, and audit within the approval transaction. Notifications/communication remain post-commit side effects. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Senior Agreement rejection could commit without its reset and revision — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/reject`; `backend/services/approvalService.js`, rejection callbacks.

**Evidence:** The shared approval engine first committed the SeniorApprovalStatus rejection. A separate route transaction then reset customer dispatch/approval, cleared senior approver metadata, inserted a revision snapshot, and recorded Agreement approval history. Failure between commits left a rejected Agreement with stale customer approval or missing revision/audit records.

**Impact:** The legal review state could disagree with customer-visible state and the Agreement revision/audit trail, making it unclear which document had been rejected and whether prior customer approval remained valid.

**Remediation:** Rejection now takes the booking lock before the approval row and performs the lifecycle check, customer-approval void log, metadata reset, locked revision snapshot, and Agreement approval-history write in the approval engine's rejection callback, all in one transaction. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement date approval/rejection could split the date state from its audit — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/date/approve` and `/date/reject`; `backend/services/crmWorkflowGuards.js`, `finalizeAgreementDate`.

**Evidence:** Date approval committed `DateApprovalStatus` through the shared engine, then finalized AgreementDate and the payment milestone in separate writes. Date rejection likewise committed the approval rejection before resetting negotiation and writing its Agreement log. Neither path took the booking lock before the Agreement approval row.

**Impact:** The approval inbox could show a completed date decision while AgreementDate/payment milestone or negotiation/audit state remained stale after a later write failed or booking cancellation raced the request.

**Remediation:** Both paths now lock and recheck the active booking before the approval row. Date approval validates live Agreement/customer/date-match state in the engine transaction, conditionally finalizes AgreementDate and the payment milestone there, and logs communication atomically. Rejection resets the negotiation and writes its Agreement log and communication in the engine rejection callback. Notifications run after commit; stale requests conflict. This follow-on change has not been tested; syntax and diff checks passed.

### P2 — Agreement resubmission could reopen approval without resetting its dependent state atomically — Fixed in workspace; not yet verified

**Location:** `backend/routes/crmAgreements.js`, `PUT /:id/submit`.

**Evidence:** The route changed SeniorApprovalStatus to Pending through the approval engine, then separately cleared senior approval metadata and customer dispatch/response fields. A failed second write could leave a Pending review with stale sent/approved customer state. Booking eligibility and mandatory document completeness were only checked outside the approval transaction.

**Impact:** The approval inbox could show a fresh review while the customer portal and Agreement metadata still reflected a prior approval cycle, or allow a resubmission after the booking/docs changed.

**Remediation:** Resubmission now locks the active booking before the approval row and performs lifecycle, Legal Executive, and mandatory-file checks plus dependent state reset in the approval engine's before-submit callback. The pending transition and reset commit together. This follow-on change has not been tested; syntax and diff checks passed.

## Controls observed

- `crmBookings` installs a `projectParamGuard` for booking IDs and unit-change request IDs. Unit-change detail/action loading also checks both source and target projects.
- The Change Unit start/preview endpoints check access to the target project. Source booking access depends on the router's `:id` `projectParamGuard`; keep this guard attached if routes are split or remounted.
- Target-unit availability checks account for active bookings, booking-unit lines, application-unit lines, and unexpired holds; the target unit is held for the new application.
- Unit-change approval uses the shared approval service. Rejection and withdrawal release application holds and cancel the draft application.
- Approved execution is written to be retryable, rechecks source booking/legal state, uses a source-booking lock for closeout, and moves on-account credit through the existing transfer workflow.
- The new booking is explicitly reset to Pending / Review and the normal booking approval steps remain required.
- Handover completion now requires strict boolean input for customer acknowledgment and final dues clearance; only literal `true` satisfies each gate.
- Possession notice details can only be edited in Draft; sent and acknowledged records retain their dispatch terms.
- Registry completion requires boolean attendance inputs and literal `true` for both parties.
- Registry completion checks and locks its mandatory documents inside the commit transaction; review, upload, and request writes cannot target a different registry or modify a terminal registry.
- Registry scheduling, rescheduling, cancellation, and completion use state-conditional writes to preserve terminal status under concurrent requests.
- Query-payment confirmation changes status only from `InfoSent`; a concurrent losing request rolls back its proof attachment and receives 409.
- Query-payment confirmation must cover the current linked deed's net payable amount before it can transition to Confirmed and unlock Registry.
- Manual Sale Deed creation always binds to the booking's verified registered Agreement and rejects a mismatched AgreementId.
- Deed document upload, attachment, and requirement changes stop after Senior Approval; reviewers must use the deed rework path to reject an approved package.
- Registration particulars are immutable through generic deed edits after the Registry is completed or the deed has been registered.
- Execution signer corrections are recorded in deed approval history with the old and new names; blank signer names are rejected.
- Registry creation requires the live director-approved Sale Deed and its own confirmed payment, rechecked under row locks in the creation transaction.
- Query-payment remarks update only while the row remains Pending; a concurrent customer notification wins and rejects the edit.
- Initial query-payment info dispatch locks and rechecks status; duplicate concurrent Pending sends roll back their attachments and return 409.
- Proxy proof uploads lock and recheck query-payment status so they cannot append evidence after confirmation.
- Proxy customer approval and recheck updates compare the expected response state inside the transaction to prevent last-write-wins races.
- Agreement proxy customer rechecks and date proposals lock the active booking and Agreement, revalidate current state, and commit their audit records with the state transition.
- Agreement proxy attachment only fills an open document slot and locks the active booking, Agreement, and matching document before replacing its file.
- Portal Agreement metadata and document reads require an active booking and a non-cancelled Agreement, alongside the customer application ownership check.
- Agreement execution locks and rechecks booking, Agreement approvals/date/assignment, and mandatory document review state before status, milestone, and brokerage writes.
- Agreement registration takes the booking lock before Agreement and registry locks and rechecks booking activity inside the registration transaction.
- Agreement resend locks current state and can reset customer response to Pending only for first send or an explicit RecheckRequested state.
- Senior Agreement approval takes the booking lock before the approval row and commits the approval, legal milestone, senior metadata, and auto-send/log writes together.
- Senior Agreement rejection takes the booking lock first and commits the response reset and revision/audit snapshot with the approval-engine rejection.
- Agreement date approval/rejection takes the booking lock before the approval row and commits date finalization or reset, associated logs, and communication with the shared approval transition.
- Agreement resubmission locks the active booking first and commits its eligibility checks and customer/senior state reset with the Pending approval transition.
- Registry document batches validate every file before the transaction, then lock the active booking and registry and commit every upload together; registry completion cannot interleave with the batch.
- Registry document requests and reviews now lock booking, registry, and document state in completion-compatible order; requests cannot add checklist requirements during completion, and reviews cannot race the locked checklist.
- Deed cancellation takes the booking lock used by registry completion and atomically checks/updates deed status, open registries, and history.
- A confirmed query-payment is carried to a replacement deed only when its amount covers that deed; Registry creation rechecks this under lock.
- Handover completion and snag creation serialize on the handover row; completion rechecks open snags in-transaction and terminal handovers reject new snags.
- Possession Notice state transitions and Draft mutations use source-status predicates so concurrent response or send/edit requests cannot overwrite the winning state.
- Ownership transfer locks the change record and requires Approved status; cancellation applies its record, linked application, and history changes atomically, and approval recovery only resets a still-Approved row.
- Ownership-change detail/deed writes are status-conditional, and submission rechecks required evidence and the current owner under the approval transition's row lock.

## Release recommendation

Run the focused Change Unit end-to-end suite against a test database, including edit attempts after submission, cross-project access, process interruption at each setup step, duplicate submit/withdraw races, approval retry, and cross-company money transfer. A broad CRM production-readiness claim requires separate end-to-end validation of the other lifecycle modules as well.

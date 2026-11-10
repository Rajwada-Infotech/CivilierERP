// End-to-end test of Property Mutation: the real routes and real SQL on the DEVELOPMENT database, on the ZZTEST booking
// BKG-2026-00126, inside one transaction that is rolled back. Its existing mutation is set aside inside that transaction
// so a fresh one can be started; the rollback restores it.   node scripts/e2eMutation.js
const { openHarness } = require("./e2eHarness");

const BOOKING = 206; // BKG-2026-00126, ZZTEST: sale deed registry completed
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmMutation) M, (SELECT COUNT(*) FROM dbo.CrmMutationDocument) D, (SELECT COUNT(*) FROM dbo.CrmMutationLog) L,
  (SELECT STRING_AGG(CONCAT(Id, ':', Status, ':', ISNULL(NewKhataNo, '')), ',') FROM dbo.CrmMutation WHERE BookingId = ${BOOKING}) S`;

(async () => {
  const h = await openHarness({ mounts: { "/m": "crmMutation" }, count: COUNT });
  const { call, upload, q, check, expectCall, section } = h;
  try {
    const user = (await q("SELECT TOP 1 id FROM dbo.Users WHERE id IS NOT NULL ORDER BY id"))[0].id;
    h.setActor({ userId: user, id: user });

    section("Starting");
    const existing = (await call("GET", `/m/booking/${BOOKING}`)).json;
    check("The booking's mutation is found from the booking", !!existing?.Id);
    expectCall("A second mutation on the same booking is refused", await call("POST", "/m", { BookingId: BOOKING }), 409);
    // Set the existing one aside, inside the transaction only.
    await q(`DELETE FROM dbo.CrmMutationLog WHERE MutationId = ${existing.Id}; DELETE FROM dbo.CrmMutationDocument WHERE MutationId = ${existing.Id}; DELETE FROM dbo.CrmMutation WHERE Id = ${existing.Id}`);
    const eligible = (await call("GET", "/m/eligible-bookings")).json;
    check("With no mutation, the booking is offered to start", eligible.some((b) => b.Id === BOOKING));
    expectCall("A booking without a completed registry is refused", await call("POST", "/m", { BookingId: 217 }), 400, "Registry");
    expectCall("A cancelled booking is refused", await call("POST", "/m", { BookingId: 212 }), 400);
    expectCall("A booking is required", await call("POST", "/m", {}), 400);
    const started = await call("POST", "/m", { BookingId: BOOKING, ApplicationNo: "E2E-APP", ApplicationDate: "2026-11-01", Authority: "E2E Municipality", OldKhataNo: "OLD-E2E", MutationFee: "1500" });
    check("Start the mutation", started.status === 201 && !!started.json?.MutationNo, `got ${started.status} ${started.json?.error}`);
    const id = started.json.id;
    expectCall("Starting it twice is refused", await call("POST", "/m", { BookingId: BOOKING }), 409);
    check("It is no longer offered to start", !(await call("GET", "/m/eligible-bookings")).json.some((b) => b.Id === BOOKING));

    section("The record");
    let rec = (await call("GET", `/m/${id}`)).json;
    check("Status is With the authority", rec.mutation.Status === "Applied");
    check("Application details are stored", rec.mutation.ApplicationNo === "E2E-APP" && Number(rec.mutation.MutationFee) === 1500 && rec.mutation.OldKhataNo === "OLD-E2E");
    const required = rec.documents.filter((d) => d.IsMandatory);
    check("The three mandatory documents are requested at once", required.length === 3, `${required.length}`);
    const deed = required.find((d) => d.DocumentType === "RegisteredDeedCopy");
    check("The registered deed copy is synced from the registry", deed?.Status === "Verified" && !!deed?.HasFile, JSON.stringify({ s: deed?.Status, f: deed?.HasFile }));
    check("Starting is in the history", rec.history.some((x) => x.Action === "Applied"));
    const list = (await call("GET", "/m?page=1&pageSize=25&status=Applied")).json;
    check("The list counts it under With the authority", list.rows.some((r) => r.Id === id) && list.statusCounts.Applied >= 1);
    const listed = list.rows.find((r) => r.Id === id);
    check("The list carries the document counts the tracker needs", listed.DocsRequired === 3 && listed.DocsVerified === 1, `${listed.DocsVerified}/${listed.DocsRequired}`);

    section("Documents");
    const form = required.find((d) => d.DocumentType === "MutationApplicationForm");
    const tax = required.find((d) => d.DocumentType === "PropertyTaxReceipt");
    expectCall("Approval waits for every mandatory document", await call("PUT", `/m/${id}/approve`, { NewKhataNo: "NEW-E2E" }), 400, "verified");
    expectCall("A document cannot be verified before its file is attached", await call("PUT", `/m/${id}/documents/${form.Id}`, { Status: "Verified" }), 400, "Upload");
    expectCall("Requesting a document that is already open is refused", await call("POST", `/m/${id}/documents/request`, { DocumentType: "MutationApplicationForm", IsMandatory: true }), 409);
    expectCall("Attach the application form", await upload(`/m/${id}/documents/upload`, { DocumentType: "MutationApplicationForm", Label: "Mutation Application Form" }), 200);
    expectCall("Attach the tax receipt", await upload(`/m/${id}/documents/upload`, { DocumentType: "PropertyTaxReceipt", Label: "Latest Property Tax Receipt" }), 200);
    expectCall("Rejecting needs a reason", await call("PUT", `/m/${id}/documents/${form.Id}`, { Status: "Rejected" }), 400);
    expectCall("Reject the form with a reason", await call("PUT", `/m/${id}/documents/${form.Id}`, { Status: "Rejected", Remarks: "Unsigned" }), 200);
    expectCall("An unknown review status is refused", await call("PUT", `/m/${id}/documents/${form.Id}`, { Status: "Maybe" }), 400);
    expectCall("Approval still waits", await call("PUT", `/m/${id}/approve`, { NewKhataNo: "NEW-E2E" }), 400, "verified");
    expectCall("Attach a corrected form", await upload(`/m/${id}/documents/upload`, { DocumentType: "MutationApplicationForm", Label: "Mutation Application Form" }), 200);
    for (const d of [form, tax]) expectCall(`Verify ${d.Label}`, await call("PUT", `/m/${id}/documents/${d.Id}`, { Status: "Verified" }), 200);
    rec = (await call("GET", `/m/${id}`)).json;
    check("All three mandatory documents verified", rec.documents.filter((d) => d.IsMandatory && d.Status === "Verified").length === 3);
    expectCall("A supporting document can be added", await upload(`/m/${id}/documents/upload`, { DocumentType: "Other", Label: "E2E extra" }), 200);

    section("Query from the authority");
    expectCall("A query needs remarks", await call("PUT", `/m/${id}/query`, {}), 400);
    expectCall("Resubmitting is refused while there is no query", await call("PUT", `/m/${id}/resubmit`), 400);
    expectCall("Record the authority's query", await call("PUT", `/m/${id}/query`, { Remarks: "Tax receipt is old" }), 200);
    rec = (await call("GET", `/m/${id}`)).json;
    check("Status is Query raised and the remarks are kept", rec.mutation.Status === "QueryRaised" && rec.mutation.QueryRemarks === "Tax receipt is old");
    check("The documents are reset for correction", rec.documents.filter((d) => d.IsMandatory && d.Status === "Verified").length < 3);
    expectCall("Approval is refused while a query is open", await call("PUT", `/m/${id}/approve`, { NewKhataNo: "NEW-E2E" }), 400);
    expectCall("Resubmitting before the documents are fixed is refused", await call("PUT", `/m/${id}/resubmit`), 400, "verified");
    for (const d of rec.documents.filter((x) => x.IsMandatory && x.Status !== "Verified")) {
      if (!d.HasFile) await upload(`/m/${id}/documents/upload`, { DocumentType: d.DocumentType, Label: d.Label });
      expectCall(`Re-verify ${d.Label}`, await call("PUT", `/m/${id}/documents/${d.Id}`, { Status: "Verified" }), 200);
    }
    expectCall("Resubmit to the authority", await call("PUT", `/m/${id}/resubmit`), 200);
    check("Back with the authority", (await call("GET", `/m/${id}`)).json.mutation.Status === "Applied");

    section("Approval");
    h.setActor({ role: "crm_executive" });
    const stranger = await call("PUT", `/m/${id}/approve`, { NewKhataNo: "NEW-E2E" });
    check("Someone not named in Approval Setup cannot approve", stranger.status === 403, `got ${stranger.status} ${stranger.json?.error}`);
    h.setActor({ role: "super_admin" });
    expectCall("The new khata number is required", await call("PUT", `/m/${id}/approve`, { NewKhataNo: " " }), 400);
    expectCall("Approve with the new khata", await call("PUT", `/m/${id}/approve`, { NewKhataNo: "NEW-E2E", ApprovedNo: "AUTH-E2E", ApprovedDate: "2026-11-09" }), 200);
    rec = (await call("GET", `/m/${id}`)).json;
    check("Approved with the khata, number and date stored", rec.mutation.Status === "Approved" && rec.mutation.NewKhataNo === "NEW-E2E" && rec.mutation.ApprovedNo === "AUTH-E2E" && String(rec.mutation.ApprovedDate).startsWith("2026-11-09"));
    expectCall("Approving twice is refused", await call("PUT", `/m/${id}/approve`, { NewKhataNo: "X" }), 400, "Already");
    expectCall("No query after approval", await call("PUT", `/m/${id}/query`, { Remarks: "late" }), 400);
    expectCall("Papers are closed after approval: upload", await upload(`/m/${id}/documents/upload`, { DocumentType: "Other" }), 400);
    expectCall("Papers are closed after approval: request", await call("POST", `/m/${id}/documents/request`, { DocumentType: "Other" }), 400);
    expectCall("Papers are closed after approval: review", await call("PUT", `/m/${id}/documents/${form.Id}`, { Status: "Rejected", Remarks: "x" }), 400);
    check("Every step is in the history", ["Applied"].every((a) => rec.history.some((x) => x.Action === a)) && rec.history.length >= 5, `${rec.history.length} entries`);
    const file = await fetch(`${h.base}/m/documents/file/${form.Id}`);
    check("A document's file opens", file.status === 200);
    expectCall("An unknown mutation is not found", await call("GET", "/m/999999"), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });

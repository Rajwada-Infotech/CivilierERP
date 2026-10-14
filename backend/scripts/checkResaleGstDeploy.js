// Read-only check after deploying Resale (cases, transfer deeds, ownership
// changes), the refund credit notes and the approval self-approval setting
// (migrations 557-571). Changes nothing.
//   node scripts/checkResaleGstDeploy.js
const fs = require("fs");
const path = require("path");
const { connectDB, getPool, closeDB } = require("../db");

const line = (ok, msg) => console.log(`${ok ? "OK  " : "FIX "} ${msg}`);

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;

  console.log("== Database changes ==");
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : f.endsWith(".sql") && files.push(f); } })(path.join(__dirname, "..", "migrations"));
  const applied = new Set((await q("SELECT name FROM dbo.__Migrations")).map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f)).sort();
  line(!pending.length, pending.length ? `${pending.length} not applied: ${pending.join(", ")}` : `all ${files.length} applied`);
  for (const t of ["CrmTransferDeed", "CrmOwnershipChange", "CrmOwnershipChangeLog", "CrmGstNote", "ApprovalRaiserRule"]) {
    const n = (await q(`SELECT OBJECT_ID('dbo.${t}', 'U') AS id`))[0].id;
    line(!!n, `table ${t}${n ? "" : " missing"}`);
  }

  const ck = (await q("SELECT definition FROM sys.check_constraints WHERE name = 'CK_CrmUnitResale_Status'"))[0];
  const draftOk = !!ck && /Draft/.test(ck.definition);
  line(draftOk, `resale case can start as a draft (being prepared)${draftOk ? "" : " — migration 569 not applied"}`);

  console.log("\n== Approval workflows (Approval Setup) ==");
  for (const m of ["crm-transfer-deeds", "crm-transfer-deed-date", "crm-ownership-changes", "crm-resales", "crm-credit-notes", "crm-credit-note-cancel"]) {
    const w = await q(`SELECT TOP 1 Name, active, LevelsData FROM dbo.ApprovalWorkflows WHERE modules LIKE N'%"${m}"%'`);
    line(!!w.length && w[0].active, w.length ? `${m}: "${w[0].Name}"${w[0].active ? "" : " (inactive)"}${w[0].LevelsData ? "" : " — no levels set"}` : `${m}: no workflow — set it up in Approval Setup`);
  }

  console.log("\n== Who may approve their own request (Approval Setup) ==");
  if ((await q("SELECT OBJECT_ID('dbo.ApprovalRaiserRule', 'U') AS id"))[0].id) {
    for (const r of await q("SELECT Module, RaiserMayApprove, UpdatedBy FROM dbo.ApprovalRaiserRule ORDER BY Module")) {
      console.log(`   ${r.Module}: ${r.RaiserMayApprove ? "the raiser may approve" : "someone else has to"} (set by ${r.UpdatedBy || "?"})`);
    }
  } else console.log("   not set up yet — migration 571 not applied");

  console.log("\n== Page access (Role Rights) ==");
  for (const k of ["crm-transfer-deeds", "crm-ownership-changes"]) {
    const p = (await q(`SELECT COUNT(*) AS n FROM dbo.PageDefinitions WHERE PageKey = '${k}' AND IsActive = 1`))[0].n;
    const r = (await q(`SELECT COUNT(*) AS n FROM dbo.RoleRights WHERE SubModule = '${k}' AND CanView = 1`))[0].n;
    line(p > 0 && r > 0, `${k}: page ${p ? "defined" : "MISSING"}, ${r} role(s) can view`);
  }

  console.log("\n== Companies on CRM bookings (printed on credit notes) ==");
  const comps = await q(`SELECT e.id, e.name, e.gst_no, e.address, e.state, COUNT(b.Id) AS bookings
    FROM dbo.enterprise e JOIN dbo.CrmBooking b ON b.CompanyId = e.id AND b.IsActive = 1
    WHERE e.business_type = 'C' GROUP BY e.id, e.name, e.gst_no, e.address, e.state ORDER BY e.name`);
  for (const c of comps) {
    const miss = [!c.address && "address", !c.state && "state"].filter(Boolean);
    line(!miss.length, `${c.name} (${c.bookings} bookings)${miss.length ? ` — missing ${miss.join(", ")} (Company master)` : ""}${c.gst_no ? "" : " · no GSTIN (right only if it isn't GST-registered — then it shouldn't charge GST)"}`);
  }
  // Place of supply is the company's GSTIN state: projects carry no GSTIN of
  // their own (routes/projectMaster.js — GST lives on the parent company), so
  // there is nothing to fill per project. A registered company's GSTIN must be valid.
  const { checkGstin, STATE_CODES } = require("../services/gstin");
  for (const c of comps.filter((x) => x.gst_no)) {
    const g = checkGstin(c.gst_no);
    line(!g.error, g.error ? `${c.name}: ${g.error} (Company master)` : `${c.name}: GSTIN ${g.value} — place of supply ${STATE_CODES[g.stateCode] || g.stateCode}`);
  }

  console.log("\n== Refunds paid before credit notes existed (issue on request: Refunds → Credit note) ==");
  const old = await q(`SELECT r.RefundNo, r.NetAmount, r.PaidAt, b.BookingNo FROM dbo.CrmRefund r JOIN dbo.CrmBooking b ON b.Id = r.BookingId
    WHERE r.Status = 'Paid' AND ISNULL(b.TotalGstAmount, 0) > 0 AND r.NetAmount > 0
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmGstNote n WHERE n.RefundId = r.Id) ORDER BY r.PaidAt`);
  console.log(old.length ? old.map((r) => `   ${r.RefundNo} · ${r.BookingNo} · Rs.${Number(r.NetAmount).toLocaleString("en-IN")} · paid ${String(r.PaidAt).slice(4, 15)}`).join("\n") : "   none");

  console.log("\n== Live work in the new pages ==");
  const live = (await q(`SELECT
    (SELECT COUNT(*) FROM dbo.CrmUnitResale WHERE IsActive = 1 AND Status IN ('Draft', 'Pending', 'Approved', 'Rejected')) AS openCases,
    (SELECT COUNT(*) FROM dbo.CrmTransferDeed WHERE IsActive = 1 AND Status NOT IN ('Registered', 'Cancelled')) AS openDeeds,
    (SELECT COUNT(*) FROM dbo.CrmOwnershipChange WHERE IsActive = 1 AND Status IN ('Draft', 'Pending', 'Rejected')) AS openChanges`))[0];
  console.log(`   open resale cases ${live.openCases} · deeds in progress ${live.openDeeds} · ownership changes open ${live.openChanges}`);
  await closeDB();
})().catch(async (e) => { console.error("Check failed:", e.message); try { await closeDB(); } catch { /* closed */ } process.exit(1); });

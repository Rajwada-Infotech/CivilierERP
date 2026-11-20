"use strict";
/**
 * Download of one land version (Legal Flow Chart): a PDF summary, or a ZIP with that PDF and every document file the
 * land had at that version (documents' file versions uploaded up to the approval; RS / LR record copies; clearance
 * certificates). Files come from LegalMasterFile (stored in the database).
 */
const PDFDocument = require("pdfkit");
const JSZip = require("jszip");
const { sql } = require("../db");

const label = (k) => String(k).replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^Rs /, "RS ").replace(/^Lr /, "LR ");
function fmt(v, k = "") {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date || (typeof v === "string" && /(Date|At|On|From|To)$/.test(k) && /^\d{4}-\d{2}-\d{2}/.test(v))) {
    const d = new Date(v);
    return Number.isNaN(+d) ? String(v) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const when = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "-");
const fileSafe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

function diffFields(a = {}, b = {}) {
  return Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]))
    .filter((k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null))
    .map((k) => ({ key: k, from: a?.[k], to: b?.[k] }));
}

function pdfBuffer(data, v, prev) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: `${data.land.LandCode} Version ${v.no}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const W = doc.page.width - 88;
    const h1 = (t) => { doc.moveDown(0.8).font("Helvetica-Bold").fontSize(11).fillColor("#111").text(t.toUpperCase(), { characterSpacing: 0.8 }); doc.moveTo(44, doc.y + 2).lineTo(44 + W, doc.y + 2).strokeColor("#999").lineWidth(0.5).stroke(); doc.moveDown(0.4); };
    const kv = (rows) => rows.forEach(([k, val]) => { doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text(`${k}: `, { continued: true }).font("Helvetica").fillColor("#111").text(val); });
    const table = (cols, rows, widths) => {
      const x0 = 44; let y = doc.y;
      const row = (cells, bold) => {
        const hgt = Math.max(...cells.map((c, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).heightOfString(String(c), { width: widths[i] - 6 }))) + 6;
        if (y + hgt > doc.page.height - 50) { doc.addPage(); y = doc.y; }
        let x = x0;
        cells.forEach((c, i) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(bold ? "#555" : "#111").text(String(c), x + 3, y + 3, { width: widths[i] - 6 }); x += widths[i]; });
        y += hgt; doc.moveTo(x0, y).lineTo(x0 + W, y).strokeColor("#ddd").lineWidth(0.5).stroke();
      };
      row(cols, true); rows.forEach((r) => row(r, false)); doc.x = x0; doc.y = y + 4;
    };

    doc.font("Helvetica").fontSize(8).fillColor("#666").text("CIVILIERERP · LEGAL · LAND VERSION", { characterSpacing: 1 });
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#111").text(`${data.land.LandCode} — Version ${v.no}`);
    doc.font("Helvetica").fontSize(11).fillColor("#333").text(String(data.land.LandName || ""));
    doc.moveDown(0.4);
    kv([["Status", v.status], ["Covers", v.no === 1 ? "Enquiry, land register and verification" : `Changes after version ${v.no - 1} was approved`],
      ["Started", when(v.startedAt)], ["Approved", v.approvedAt ? `${when(v.approvedAt)}${v.approvedBy ? ` by ${v.approvedBy}` : ""}` : "Not approved yet"],
      ["Mouza", [data.land.MouzaName, data.land.DistrictName].filter(Boolean).join(", ") || "-"], ["Project", data.land.ProjectName || "-"], ["Printed", when(new Date())]]);
    if (v.approxSnapshot) doc.moveDown(0.3).font("Helvetica-Oblique").fontSize(8.5).fillColor("#a15c00").text("This version was approved before versions were saved; its details are shown as they are now.");

    h1("Steps of this version");
    table(["Step", "State", "Date"], v.flow.map((f) => [f.label, f.state === "done" ? "Done" : f.state === "current" ? "In progress" : f.state === "skipped" ? "Not used" : "Not yet", f.date ? when(f.date) : "-"]), [W * 0.5, W * 0.2, W * 0.3]);

    h1(prev ? `What changed from version ${prev.no}` : "First version — the complete record below");
    if (prev?.snapshot && v.snapshot) {
      const d = diffFields(prev.snapshot.land, v.snapshot.land);
      if (d.length) table(["Field", `Version ${prev.no}`, `Version ${v.no}`], d.map((x) => [label(x.key), fmt(x.from, x.key), fmt(x.to, x.key)]), [W * 0.3, W * 0.35, W * 0.35]);
      else doc.font("Helvetica").fontSize(9).text("No change in the land's details.");
    }

    if (v.snapshot) {
      h1(`Land record in version ${v.no}`);
      table(["Field", "Value"], Object.entries(v.snapshot.land).map(([k, val]) => [label(k), fmt(val, k)]), [W * 0.35, W * 0.65]);
      const list = (title, rows, cols) => { if (!rows?.length) return; h1(title); table(cols.map((c) => c[1]), rows.map((r) => cols.map(([k]) => fmt(r[k], k))), cols.map(() => W / cols.length)); };
      list("RS records", v.snapshot.rsRecords, [["MouzaName", "Mouza"], ["RsKhatianNo", "Khatian"], ["RsDagNo", "Dag"], ["RecordedHolder", "Holder"], ["Area", "Area"], ["VerificationStatus", "Verified"]]);
      list("LR records", v.snapshot.lrRecords, [["MouzaName", "Mouza"], ["LrKhatianNo", "Khatian"], ["LrDagNo", "Dag"], ["RecordedHolder", "Holder"], ["Area", "Area"], ["VerificationStatus", "Verified"]]);
      list("Owners", v.snapshot.owners, [["OwnerName", "Owner"], ["OwnerGuardian", "Father / husband"], ["SharePct", "Share %"], ["ValidFrom", "From"]]);
      list("Documents", v.snapshot.documents, [["DocumentCode", "Code"], ["DocTypeName", "Type"], ["Title", "Title"], ["DocumentNo", "No."], ["CurrentVersionNo", "File version"]]);
      list("LA & ULC clearance", v.snapshot.clearances, [["Kind", "Clearance"], ["Status", "Status"], ["AppliedOn", "Applied"], ["ObtainedOn", "Obtained"], ["CertificateNo", "Certificate"]]);
      list("Mutation", v.snapshot.mutations, [["ApplicationNo", "Application"], ["ApplicationDate", "Applied"], ["ApplicationStatus", "Status"], ["OrderNo", "Order"]]);
    }

    h1(`Documents uploaded in version ${v.no}`);
    if (v.uploads?.length) table(["Document", "Type", "File version", "Uploaded", "Review"], v.uploads.map((d) => [`${d.DocumentCode} ${d.Title || ""}`, d.DocTypeName || "-", `v${d.VersionNo}`, `${when(d.UploadedAt)}${d.UploadedBy ? ` · ${d.UploadedBy}` : ""}`, d.ReviewStatus || "-"]), [W * 0.32, W * 0.18, W * 0.12, W * 0.24, W * 0.14]);
    else doc.font("Helvetica").fontSize(9).fillColor("#111").text("None.");
    const items = v.checklist?.items || [];
    const pending = items.filter((i) => ["Missing", "Pending", "Rejected"].includes(i.state));
    h1(`Document checklist — ${pending.length ? `${pending.length} pending` : "nothing pending"}`);
    if (items.length) table(["Document", "Needed", "State"], items.map((i) => [i.doc, i.requirement, i.state === "Pending" ? "Waiting for review" : i.state]), [W * 0.5, W * 0.2, W * 0.3]);
    else doc.font("Helvetica").fontSize(9).fillColor("#111").text("No document checklist is set for this land.");

    const open = [
      ...v.flow.filter((f) => f.state === "current" || f.state === "pending").map((f) => [f.label, f.state === "current" ? "In progress" : "Not started", "Step of this version"]),
      ...pending.map((i) => [`Document: ${i.doc}`, i.state === "Pending" ? "Waiting for review" : i.state, i.requirement]),
      ...(v.no === (data.versions || []).length ? (data.stages || []).filter((x) => x.state === "current" || x.state === "pending").map((x) => [x.label, x.state === "current" ? "In progress" : "Not started", x.note || "Land pipeline"]) : []),
    ];
    h1(open.length ? `Incomplete — ${open.length} not done yet` : "Incomplete — everything complete");
    if (open.length) table(["Not done yet", "State", "Detail"], open, [W * 0.4, W * 0.2, W * 0.4]);

    h1("Actions recorded");
    if (v.events.length) table(["When", "Action", "By", "Note"], v.events.map((e) => [when(e.CreatedAt), e.Action, e.UserName || "System", e.Remarks || ""]), [W * 0.22, W * 0.33, W * 0.17, W * 0.28]);
    else doc.font("Helvetica").fontSize(9).text("None.");
    doc.end();
  });
}

/**
 * Files the land had at this version: for each document in the version's saved record, the file version it had
 * (CurrentVersionNo then), plus RS / LR record copies and LA / ULC certificates.
 */
async function versionFiles(pool, landId, snapshot) {
  const docs = (snapshot?.documents || []).filter((d) => d.DocumentCode);
  const out = [];
  for (const d of docs) {
    const r = await pool.request().input("L", sql.Int, landId).input("C", sql.NVarChar(60), d.DocumentCode).input("N", sql.Int, Number(d.CurrentVersionNo) || null).query(`
      SELECT TOP 1 N'documents' AS Folder, CONCAT(x.DocumentCode, N' ', x.Title, N' (file v', v.VersionNo, N')') AS Name, f.FileName, f.FileBase64
      FROM dbo.LegalLandDocument x JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = x.DocumentId JOIN dbo.LegalMasterFile f ON f.FileId = v.FileId
      WHERE x.LandId = @L AND x.DocumentCode = @C ORDER BY CASE WHEN v.VersionNo = @N THEN 0 ELSE 1 END, v.VersionNo DESC`);
    if (r.recordset[0]) out.push(r.recordset[0]);
  }
  const rest = await pool.request().input("L", sql.Int, landId).query(`
    SELECT N'records' AS Folder, CONCAT(N'RS khatian ', r.RsKhatianNo, N' dag ', r.RsDagNo) AS Name, f.FileName, f.FileBase64
    FROM dbo.LegalLandRsRecord r JOIN dbo.LegalMasterFile f ON f.FileId = r.DocFileId WHERE r.LandId = @L AND r.IsActive = 1
    UNION ALL SELECT N'records', CONCAT(N'LR khatian ', r.LrKhatianNo, N' dag ', r.LrDagNo), f.FileName, f.FileBase64
    FROM dbo.LegalLandLrRecord r JOIN dbo.LegalMasterFile f ON f.FileId = r.DocFileId WHERE r.LandId = @L AND r.IsActive = 1
    UNION ALL SELECT N'clearance', CONCAT(c.Kind, N' certificate ', ISNULL(c.CertificateNo, N'')), f.FileName, f.FileBase64
    FROM dbo.LegalLandClearance c JOIN dbo.LegalMasterFile f ON f.FileId = c.FileId WHERE c.LandId = @L`);
  return [...out, ...rest.recordset];
}

async function zipBuffer(pool, data, v, prev) {
  const zip = new JSZip();
  const root = zip.folder(`${fileSafe(data.land.LandCode)} - Version ${v.no}`);
  root.file(`Version ${v.no} - summary.pdf`, await pdfBuffer(data, v, prev));
  const used = new Set();
  const files = await versionFiles(pool, data.land.LandId, v.snapshot);
  for (const f of files) {
    if (!f.FileBase64) continue;
    const ext = (/\.[A-Za-z0-9]{1,6}$/.exec(f.FileName || "") || [""])[0];
    let name = `${fileSafe(f.Name)}${ext}`, i = 2;
    while (used.has(`${f.Folder}/${name}`)) name = `${fileSafe(f.Name)} (${i++})${ext}`;
    used.add(`${f.Folder}/${name}`);
    const b64 = String(f.FileBase64).replace(/^data:[^;]+;base64,/, "");
    root.folder(f.Folder).file(name, b64, { base64: true });
  }
  root.file("README.txt", `${data.land.LandCode} — ${data.land.LandName}\nVersion ${v.no}: ${v.status}\n` +
    `${v.approvedAt ? `Approved ${when(v.approvedAt)}${v.approvedBy ? ` by ${v.approvedBy}` : ""}` : "Not approved yet (current state)"}\n\n` +
    `summary PDF  — steps, what changed, the full land record and actions of this version\n` +
    `documents/   — each land document's file as it was at this version\nrecords/     — RS / LR record copies\nclearance/   — LA / ULC certificates\n` +
    `Files included: ${used.size}\n`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { pdfBuffer, zipBuffer, fileSafe };

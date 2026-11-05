// Daily Progress Report exports: CSV download and the printable copy (built from the hidden PrintView).
import React from "react";
import { type DPRResponse, fmt, fmtDate, fmtDateTime, fmtNum } from "./config";

// ─── Export Helpers ───────────────────────────────────────────────────────────

function buildCSV(data: DPRResponse): string {
  const lines: string[] = [];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row = (...cells: unknown[]) => lines.push(cells.map(esc).join(","));

  row(`Daily Progress Report — ${data.date}`);
  row(
    `BOQ: ${data.summary.boqCount} docs`,
    `Work Orders: ${data.summary.woCount} docs`,
    `Work Done: ${data.summary.wdCount} docs`,
  );
  lines.push("");

  // BOQ
  row("=== BOQ ===");
  row(
    "Doc No",
    "Company",
    "Project",
    "Description",
    "BOQ Date",
    "Total Amount",
    "Status",
    "Created By",
    "Created At",
  );
  for (const r of data.boq) {
    row(
      r.DocNo || r.BoqNo,
      r.CompanyName,
      r.ProjectName,
      r.Description,
      fmtDate(r.BoqDate),
      r.TotalAmount,
      r.Status,
      r.CreatedBy,
      fmtDateTime(r.CreatedAt),
    );
  }
  lines.push("");

  // Work Orders
  row("=== WORK ORDERS ===");
  row(
    "Doc No",
    "Company",
    "Project",
    "Contractor",
    "BOQ Ref",
    "Doc Date",
    "Activities",
    "Total Amount",
    "Status",
    "Partial?",
    "Created By",
    "Created At",
  );
  for (const r of data.workOrders) {
    const isPartial =
      r.Status === "Partially Received" || r.Status === "In Progress";
    row(
      r.DocNo || r.DocumentNumber,
      r.CompanyName,
      r.ProjectName,
      r.ContractorName || r.SupplierName || "",
      r.BoqDocNo || "",
      fmtDate(r.DocumentDate),
      r.ActivityCount,
      r.TotalAmount,
      r.Status,
      isPartial ? "YES" : "NO",
      r.CreatedBy,
      fmtDateTime(r.CreatedAt),
    );
    // Activities
    if (r.activities.length > 0) {
      row(
        "",
        "",
        "Activity Group",
        "Activity",
        "UOM",
        "Qty",
        "Rate",
        "Amount",
      );
      for (const a of r.activities) {
        row(
          "",
          "",
          a.ActivityGroupName || "",
          a.ActivityName || "",
          a.UOMName || "",
          a.Quantity ?? "",
          a.Rate ?? "",
          a.Amount ?? "",
        );
      }
    }
  }
  lines.push("");

  // Work Done
  row("=== WORK DONE ===");
  row(
    "Doc No",
    "Company",
    "Project",
    "Contractor",
    "WO Ref",
    "Period From",
    "Period To",
    "Description",
    "Qty Done",
    "Unit",
    "Rate",
    "Gross Amt",
    "Deductions",
    "Certified Amt",
    "Status",
    "Created By",
    "Created At",
  );
  for (const r of data.workDone) {
    row(
      r.DocNo,
      r.CompanyName,
      r.ProjectName,
      r.ContractorName || r.SupplierName || "",
      r.WorkOrderNo || "",
      fmtDate(r.PeriodFrom),
      fmtDate(r.PeriodTo),
      r.DescriptionOfWork,
      r.QuantityDone ?? "",
      r.Unit || "",
      r.RatePerUnit ?? "",
      r.GrossAmount ?? 0,
      r.Deductions ?? 0,
      r.CertifiedAmount,
      r.Status,
      r.CreatedBy,
      fmtDateTime(r.CreatedAt),
    );
  }

  return lines.join("\n");
}

export function downloadCSV(data: DPRResponse) {
  const csv = buildCSV(data);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DPR_${data.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function printPDF(
  printRef: React.RefObject<HTMLDivElement | null>,
  date: string,
) {
  const el = printRef.current;
  if (!el) return;

  const win = window.open("", "_blank");
  if (!win) return;

  // ── Safe DOM construction — no document.write() with untrusted HTML ─────────
  // Using document.write() with el.innerHTML (DOM-sourced) triggers
  // js/xss-through-dom. Instead we build the document via safe DOM APIs and
  // copy the print content with importNode(), which transfers the already-parsed
  // DOM tree without re-interpreting any text as HTML.
  const doc = win.document;

  doc.title = `DPR — ${date}`;

  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.appendChild(meta);

  const style = doc.createElement("style");
  style.textContent = [
    "* { box-sizing: border-box; margin: 0; padding: 0; }",
    "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 24px; }",
    "h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }",
    "h2 { font-size: 13px; font-weight: 700; margin: 20px 0 6px; color: #1a1a2e; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }",
    "h3 { font-size: 11px; font-weight: 600; margin: 12px 0 4px; color: #374151; }",
    ".summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 12px 0; }",
    ".card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }",
    ".card .val { font-size: 16px; font-weight: 700; }",
    ".card .lbl { font-size: 10px; color: #6b7280; margin-top: 2px; }",
    "table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }",
    "th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; color: #6b7280; border: 1px solid #e5e7eb; }",
    "td { padding: 5px 8px; border: 1px solid #e5e7eb; vertical-align: top; }",
    "tr:nth-child(even) td { background: #f9fafb; }",
    "tfoot td { background: #f3f4f6; font-weight: 700; }",
    ".docno { font-family: monospace; font-weight: 700; }",
    ".badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 600; border: 1px solid #e5e7eb; }",
    ".sub-table { margin: 0 16px 8px; }",
    ".sub-table th { background: #f9fafb; }",
    "@media print { body { padding: 0; } }",
  ].join("\n");
  doc.head.appendChild(style);

  // importNode deep-copies the already-parsed DOM node into the new document —
  // no HTML string is ever re-parsed, so there is no XSS vector.
  const imported = doc.importNode(el, true);
  doc.body.appendChild(imported);

  setTimeout(() => {
    win.print();
    win.close();
  }, 400);
}

// ─── Print-friendly content builder ──────────────────────────────────────────

export function PrintView({ data }: { data: DPRResponse }) {
  const { summary, boq, workOrders, workDone, date } = data;
  return (
    <>
      <h1>Daily Progress Report</h1>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
        Date: {fmtDate(date)} &nbsp;|&nbsp; Values leave rejected documents out &nbsp;|&nbsp; Generated:{" "}
        {new Date().toLocaleString("en-IN")}
      </p>

      <div
        className="summary"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 12,
          margin: "16px 0",
        }}
      >
        {[
          { label: "BOQ", count: summary.boqCount, total: summary.boqTotal as number | null },
          {
            label: "Work Orders",
            count: summary.woCount,
            total: summary.woTotal,
          },
          {
            label: "Work Done",
            count: summary.wdCount,
            total: summary.wdTotal,
          },
          {
            label: "Documents",
            count: summary.boqCount + summary.woCount + summary.wdCount,
            total: null,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="card"
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div className="val" style={{ fontSize: 15, fontWeight: 700 }}>
              {c.total == null ? c.count : fmt(c.total)}
            </div>
            <div
              className="lbl"
              style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}
            >
              {c.total == null ? `created on ${fmtDate(date)}` : `${c.label} · ${c.count} docs`}
            </div>
          </div>
        ))}
      </div>

      {/* BOQ */}
      <h2>BOQ Documents ({boq.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Doc No</th>
            <th>Company</th>
            <th>Project</th>
            <th>Description</th>
            <th>BOQ Date</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th>Status</th>
            <th>Created By</th>
          </tr>
        </thead>
        <tbody>
          {boq.map((r) => (
            <tr key={r.BoqID}>
              <td className="docno">{r.DocNo || r.BoqNo}</td>
              <td>{r.CompanyName}</td>
              <td>{r.ProjectName}</td>
              <td>{r.Description}</td>
              <td>{fmtDate(r.BoqDate)}</td>
              <td style={{ textAlign: "right" }}>{fmt(r.TotalAmount)}</td>
              <td>
                <span className="badge">{r.Status}</span>
              </td>
              <td>{r.CreatedBy}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Total ({boq.length})</td>
            <td style={{ textAlign: "right" }}>{fmt(summary.boqTotal)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      {/* Work Orders */}
      <h2>Work Orders ({workOrders.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Doc No</th>
            <th>Company</th>
            <th>Project</th>
            <th>Contractor</th>
            <th>BOQ Ref</th>
            <th>Acts</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {workOrders.map((r) => (
            <React.Fragment key={r.Id}>
              <tr>
                <td className="docno">{r.DocNo || r.DocumentNumber}</td>
                <td>{r.CompanyName}</td>
                <td>{r.ProjectName}</td>
                <td>{r.ContractorName || r.SupplierName || "—"}</td>
                <td className="docno">{r.BoqDocNo || "—"}</td>
                <td style={{ textAlign: "center" }}>{r.ActivityCount}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.TotalAmount)}</td>
                <td>
                  <span className="badge">{r.Status}</span>
                </td>
              </tr>
              {r.activities.length > 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{ padding: "4px 8px", background: "#f9fafb" }}
                  >
                    <table
                      style={{ width: "95%", margin: "4px auto", fontSize: 10 }}
                    >
                      <thead>
                        <tr>
                          <th>Activity Group</th>
                          <th>Activity</th>
                          <th>UOM</th>
                          <th style={{ textAlign: "right" }}>Qty</th>
                          <th style={{ textAlign: "right" }}>Rate</th>
                          <th style={{ textAlign: "right" }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.activities.map((a) => (
                          <tr key={a.Id}>
                            <td>{a.ActivityGroupName || "—"}</td>
                            <td>{a.ActivityName || "—"}</td>
                            <td>{a.UOMName || "—"}</td>
                            <td style={{ textAlign: "right" }}>
                              {fmtNum(a.Quantity)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {fmt(a.Rate)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {fmt(a.Amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Total ({workOrders.length})</td>
            <td style={{ textAlign: "right" }}>{fmt(summary.woTotal)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* Work Done */}
      <h2>Work Done ({workDone.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Doc No</th>
            <th>Company</th>
            <th>Project</th>
            <th>Contractor</th>
            <th>WO Ref</th>
            <th>Description</th>
            <th style={{ textAlign: "right" }}>Gross</th>
            <th style={{ textAlign: "right" }}>Deduct.</th>
            <th style={{ textAlign: "right" }}>Certified</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {workDone.map((r) => (
            <tr key={r.ID}>
              <td className="docno">{r.DocNo}</td>
              <td>{r.CompanyName}</td>
              <td>{r.ProjectName}</td>
              <td>{r.ContractorName || r.SupplierName || "—"}</td>
              <td className="docno">{r.WorkOrderNo || "—"}</td>
              <td>{r.DescriptionOfWork}</td>
              <td style={{ textAlign: "right" }}>{fmt(r.GrossAmount)}</td>
              <td style={{ textAlign: "right" }}>
                {r.Deductions ? `(${fmt(r.Deductions)})` : "—"}
              </td>
              <td style={{ textAlign: "right" }}>{fmt(r.CertifiedAmount)}</td>
              <td>
                <span className="badge">{r.Status}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Total ({workDone.length})</td>
            <td style={{ textAlign: "right" }}>
              {fmt(workDone.reduce((s, r) => s + (r.GrossAmount ?? 0), 0))}
            </td>
            <td style={{ textAlign: "right" }}>
              ({fmt(workDone.reduce((s, r) => s + (r.Deductions ?? 0), 0))})
            </td>
            <td style={{ textAlign: "right" }}>{fmt(summary.wdTotal)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </>
  );
}

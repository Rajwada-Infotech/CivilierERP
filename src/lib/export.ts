/**
 * export.ts — data-export utilities for the ERP
 *
 * Three formats:
 *  • CSV  — zero dependencies, always available
 *  • XLSX — SheetJS (xlsx) with styled headers
 *  • PDF  — @react-pdf/renderer, built via exportToPdf()
 *
 * Usage:
 *   exportToCsv(rows, columns, "bank-master")
 *   exportToXlsx(rows, columns, "bank-master")
 *   exportToPdf(rows, columns, { title: "Bank Master", filename: "bank-master" })
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportColumn {
  /** Header label shown in the output file */
  header: string;
  /** Key on each data row, or accessor function */
  accessor: string | ((row: Record<string, unknown>) => unknown);
}

export interface PdfExportOptions {
  title: string;
  filename?: string;
  /** Optional subtitle / date range shown under the title */
  subtitle?: string;
  /** Hex colour for header row background — defaults to brand blue */
  headerColor?: string;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getCell(
  row: Record<string, unknown>,
  col: ExportColumn
): string {
  const raw =
    typeof col.accessor === "function"
      ? col.accessor(row)
      : row[col.accessor];

  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportToCsv(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  filename = "export"
): void {
  const escape = (v: string) =>
    v.includes(",") || v.includes('"') || v.includes("\n")
      ? `"${v.replace(/"/g, '""')}"`
      : v;

  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escape(getCell(row, c))).join(","))
    .join("\n");

  const blob = new Blob([`${header}\n${body}`], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${filename}.csv`);
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export async function exportToXlsx(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  filename = "export",
  sheetName = "Sheet1"
): Promise<void> {
  // Dynamic import — keeps the main bundle slim
  const XLSX = await import("xlsx");

  // Build data: header row first
  const headerRow = columns.map((c) => c.header);
  const dataRows = rows.map((row) => columns.map((c) => getCell(row, c)));

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

  // ── Column widths — auto-fit to widest cell ──────────────────────────────
  ws["!cols"] = columns.map((col, i) => {
    const maxLen = Math.max(
      col.header.length,
      ...rows.map((r) => getCell(r, col).length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });

  // ── Header row styles ────────────────────────────────────────────────────
  // SheetJS CE doesn't support cell styles natively; xlsx-style or exceljs
  // would be needed for full styling. We freeze the header row and set
  // a freeze pane so headers stay visible on scroll.
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function exportToPdf(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  options: PdfExportOptions
): Promise<void> {
  const {
    title,
    filename = "export",
    subtitle,
    headerColor = "#1e40af", // brand blue
  } = options;

  // Dynamic import — @react-pdf/renderer is large
  const { pdf, Document, Page, Text, View, StyleSheet, Font } =
    await import("@react-pdf/renderer");

  // ── Styles ─────────────────────────────────────────────────────────────────
  const styles = StyleSheet.create({
    page: {
      padding: 36,
      fontSize: 8,
      fontFamily: "Helvetica",
      backgroundColor: "#ffffff",
    },
    // Header section
    titleBlock: {
      marginBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: "#e2e8f0",
      paddingBottom: 10,
    },
    title: {
      fontSize: 16,
      fontFamily: "Helvetica-Bold",
      color: "#0f172a",
      marginBottom: 3,
    },
    subtitle: {
      fontSize: 8,
      color: "#64748b",
    },
    meta: {
      fontSize: 7,
      color: "#94a3b8",
      marginTop: 3,
    },
    // Table
    table: { width: "100%" },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: headerColor,
      borderRadius: 3,
      marginBottom: 1,
    },
    tableHeaderCell: {
      flex: 1,
      padding: "5 6",
      color: "#ffffff",
      fontFamily: "Helvetica-Bold",
      fontSize: 7,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: "#f1f5f9",
    },
    tableRowAlt: {
      backgroundColor: "#f8fafc",
    },
    tableCell: {
      flex: 1,
      padding: "4 6",
      color: "#334155",
      fontSize: 7.5,
    },
    // Footer
    footer: {
      position: "absolute",
      bottom: 24,
      left: 36,
      right: 36,
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 0.5,
      borderTopColor: "#e2e8f0",
      paddingTop: 6,
    },
    footerText: {
      fontSize: 7,
      color: "#94a3b8",
    },
  });

  // ── Document component ─────────────────────────────────────────────────────
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Split rows into pages (react-pdf handles pagination, but we chunk
  // manually so we can add alternating row colours without logic in JSX)
  const ExportDoc = () => (
    <Document title={title} author="CivilierERP">
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Title */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          <Text style={styles.meta}>
            Exported on {dateStr} at {timeStr} · {rows.length} record
            {rows.length !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Header */}
          <View style={styles.tableHeader}>
            {columns.map((col) => (
              <Text key={col.header} style={styles.tableHeaderCell}>
                {col.header}
              </Text>
            ))}
          </View>

          {/* Rows */}
          {rows.map((row, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {columns.map((col) => (
                <Text key={col.header} style={styles.tableCell}>
                  {getCell(row, col)}
                </Text>
              ))}
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>CivilierERP · {title}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );

  const blob = await pdf(<ExportDoc />).toBlob();
  triggerDownload(blob, `${filename}.pdf`);
}

// RN port of src/pages/material/dashboard/DrillDialog.tsx — the records behind one figure of the Material Overview,
// on the sheet: an eyebrow, the title with the count, a search box and the ruled table. A row opens that record's own
// view (MR, PO, GRN, issue), the way the web opens the record's page preview.
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react-native";
import { fetchDrill, type DrillKey } from "@/api/materialDashboardApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, IconKey, Input, Label, Notice, SheetMark, SheetTable, Skel, statusTone, type Col, Press } from "@/components/sheet/Sheet";
import { GRNDetailModal } from "../grn/GRNDetailModal";
import { PurchaseOrderDetailModal } from "../purchaseOrder/PurchaseOrderDetailModal";
import { MaterialRequestDetailModal } from "../materialRequest/MaterialRequestDetailModal";
import { MaterialIssueDetailModal } from "../materialIssues/MaterialIssueDetailModal";

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const docCell = (t: string) => <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, letterSpacing: 0.3, color: S.ink }}>{t}</Text>;
const muted = (t: string | null | undefined) => (
  <Text numberOfLines={2} style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
    {t || "—"}
  </Text>
);
const dateCell = (d: string | null | undefined) => <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>{fmtDate(d)}</Text>;
const amountCell = (v: unknown) => <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, color: S.ink }}>{v == null ? "—" : fmt(Number(v))}</Text>;
const mark = (s: string | null | undefined, fallback = "Draft") => {
  const t = s || fallback;
  return <SheetMark text={t} tone={statusTone(t)} />;
};

const docCols = (docNo: string, id: string, party: string, partyHeader: string, date: string, amount: string, status: string, defaultStatus = "Draft"): Col<any>[] => [
  { title: "Doc No", width: 120, render: (r) => docCell(r[docNo] || `#${r[id]}`) },
  { title: partyHeader, width: 150, render: (r) => muted(r[party]) },
  { title: "Date", width: 92, render: (r) => dateCell(r[date]) },
  { title: "Amount", width: 96, num: true, render: (r) => amountCell(r[amount]) },
  { title: "Status", width: 110, render: (r) => mark(r[status], defaultStatus) },
];

const pipeCols = (dueHeader: string, withParty: boolean): Col<any>[] => [
  { title: "Doc No", width: 120, render: (r) => docCell(r.DocNo || `#${r.Id}`) },
  { title: "Project", width: 140, render: (r) => muted(r.ProjectName) },
  ...(withParty ? [{ title: "Supplier", width: 140, render: (r: any) => muted(r.PartyName) }] : []),
  { title: "Date", width: 92, render: (r) => dateCell(r.DocDate) },
  {
    title: dueHeader,
    width: 104,
    render: (r) => {
      const late = !!r.DueDate && new Date(r.DueDate) < new Date(new Date().toDateString());
      return <Text style={{ fontFamily: late ? fonts.body.semibold : fonts.body.regular, fontSize: 12, color: late ? S.red : S.graphite }}>{fmtDate(r.DueDate)}</Text>;
    },
  },
  ...(withParty ? [{ title: "Amount", width: 96, num: true, render: (r: any) => amountCell(r.Amount) }] : []),
  { title: "Status", width: 110, render: (r) => mark(r.Status) },
];

type Opens = "mr" | "po" | "grn" | "issue";
export const DRILLS: Record<DrillKey, { title: string; cols: Col<any>[]; empty: string; opens?: Opens; idOf?: (r: any) => number }> = {
  items: {
    title: "Item master",
    empty: "No items found.",
    cols: [
      { title: "Code", width: 96, render: (r) => docCell(r.M_code || "—") },
      { title: "Item Name", width: 170, render: (r) => <Body size={12}>{r.M_Name}</Body> },
      { title: "Group", width: 110, render: (r) => muted(r.M_Group) },
      { title: "Type", width: 90, render: (r) => muted(r.M_Type) },
      { title: "UOM", width: 64, render: (r) => muted(r.M_UOM) },
      { title: "HSN", width: 80, render: (r) => muted(r.M_HSN) },
    ],
  },
  grns: { title: "Goods receipts", empty: "No GRNs found.", cols: docCols("GRNNo", "GRNID", "SupplierName", "Supplier", "GRNDate", "TotalAmount", "Status"), opens: "grn", idOf: (r) => r.GRNID },
  pos: { title: "Open purchase orders", empty: "No open purchase orders.", cols: docCols("PurchaseOrderNo", "PurchaseOrderID", "SupplierName", "Supplier", "PODate", "TotalAmount", "Status"), opens: "po", idOf: (r) => r.PurchaseOrderID },
  expenses: { title: "Pending expenses", empty: "No expenses waiting for approval.", cols: docCols("EDocNo", "Eid", "EProjectName", "Project", "EDocDate", "EAmount", "EStatus", "Pending") },
  stock: {
    title: "Stock transfers",
    empty: "No stock transfers found.",
    cols: [
      { title: "Doc No", width: 120, render: (r) => docCell(r.DocNo || "—") },
      { title: "Date", width: 92, render: (r) => dateCell(r.TransferDate) },
      { title: "From Godown", width: 130, render: (r) => <Body size={12}>{r.FromGodownName || "—"}</Body> },
      { title: "To Godown", width: 130, render: (r) => <Body size={12}>{r.ToGodownName || "—"}</Body> },
      { title: "Status", width: 110, render: (r) => mark(r.Status, "—") },
      { title: "Created By", width: 140, render: (r) => muted(r.CreatedBy) },
    ],
  },
  issues: {
    title: "Material issues",
    empty: "No material issues found.",
    opens: "issue",
    idOf: (r) => r.IssueId,
    cols: [
      { title: "Doc No", width: 120, render: (r) => docCell(r.DocNo || `#${r.IssueId}`) },
      { title: "Project", width: 150, render: (r) => muted(r.ProjectName) },
      { title: "Date", width: 92, render: (r) => dateCell(r.IssueDate ?? r.Date) },
      { title: "Items", width: 56, num: true, render: (r) => docCell(String(r.ItemCount ?? "—")) },
      { title: "Status", width: 110, render: (r) => mark(r.Status) },
    ],
  },
  requests: {
    title: "Material requests",
    empty: "No material requests found.",
    opens: "mr",
    idOf: (r) => r.MRId,
    cols: [
      { title: "Doc No", width: 120, render: (r) => docCell(r.DocNo || `#${r.MRId}`) },
      { title: "Project", width: 140, render: (r) => muted(r.ProjectName) },
      { title: "Date", width: 92, render: (r) => dateCell(r.RequestDate) },
      {
        title: "Priority",
        width: 80,
        render: (r) => {
          const p = r.Priority || "Normal";
          const hot = p === "High" || p === "Urgent";
          return (
            <View style={{ borderWidth: 1, borderColor: hot ? S.red : S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: hot ? S.red : S.graphite }}>{p}</Text>
            </View>
          );
        },
      },
      { title: "Status", width: 110, render: (r) => mark(r.Status) },
    ],
  },
  "mr-unapproved": { title: "Material requests not approved", cols: pipeCols("Required by", false), empty: "Every material request is approved.", opens: "mr", idOf: (r) => r.Id },
  "mr-pending": { title: "Approved material requests with no purchase order", cols: pipeCols("Required by", false), empty: "Every approved request has a purchase order.", opens: "mr", idOf: (r) => r.Id },
  "mr-overdue": { title: "Overdue material requests", cols: pipeCols("Required by", false), empty: "No material request is past its required-by date.", opens: "mr", idOf: (r) => r.Id },
  "po-unapproved": { title: "Purchase orders not approved", cols: pipeCols("Expected delivery", true), empty: "Every purchase order is approved.", opens: "po", idOf: (r) => r.Id },
  "po-pending": { title: "Approved purchase orders with no GRN", cols: pipeCols("Expected delivery", true), empty: "Every approved purchase order has a GRN.", opens: "po", idOf: (r) => r.Id },
  "po-overdue": { title: "Overdue purchase orders", cols: pipeCols("Expected delivery", true), empty: "No purchase order is past its expected delivery.", opens: "po", idOf: (r) => r.Id },
  "grn-unapproved": { title: "GRNs not approved", cols: pipeCols("Invoice due by", true), empty: "Every GRN is approved.", opens: "grn", idOf: (r) => r.Id },
  "grn-pending": { title: "Approved GRNs with no invoice", cols: pipeCols("Invoice due by", true), empty: "Every approved GRN has an invoice.", opens: "grn", idOf: (r) => r.Id },
  "grn-overdue": { title: "Overdue GRNs", cols: pipeCols("Invoice due by", true), empty: "No GRN is overdue for its invoice.", opens: "grn", idOf: (r) => r.Id },
};

const PAGE = 25;

export function DrillSheet({ open, onClose }: { open: DrillKey | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const d = open ? DRILLS[open] : null;
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [opened, setOpened] = useState<{ kind: Opens; id: number } | null>(null);
  const { data, isLoading, isError } = useQuery<any[]>({
    queryKey: ["material-dashboard-drill", open],
    queryFn: () => fetchDrill(open!),
    enabled: !!open,
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    const s = q.trim().toLowerCase();
    return s ? all.filter((r) => Object.values(r).some((v) => v != null && typeof v !== "object" && String(v).toLowerCase().includes(s))) : all;
  }, [data, q]);

  const close = () => {
    setQ("");
    setShown(PAGE);
    onClose();
  };

  return (
    <Modal visible={open !== null} animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flex: 1, margin: 8, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: S.ink }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Label>Material overview</Label>
              <Text style={{ fontFamily: fonts.heading.bold, fontSize: 18, letterSpacing: -0.4, color: S.ink }}>
                {d?.title}
                {data ? <Text style={{ fontFamily: fonts.heading.regular, fontSize: 13, color: S.graphite }}>{`  ${data.length}`}</Text> : null}
              </Text>
              {!!d?.opens && <Body size={11.5} color={S.graphite}>Open a row to see that record.</Body>}
            </View>
            <IconKey onPress={close}>
              <X size={15} color={S.ink} />
            </IconKey>
          </View>

          {isLoading ? (
            <View style={{ padding: 16 }}>
              <Skel h={26} />
              <Skel h={26} />
              <Skel h={26} />
            </View>
          ) : isError ? (
            <View style={{ padding: 16 }}>
              <Notice>Could not load these records.</Notice>
            </View>
          ) : !data?.length ? (
            <Body color={S.graphite} style={{ padding: 16 }}>{d?.empty}</Body>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
              <Input value={q} onChangeText={setQ} placeholder="Search these records…" right={<View style={{ paddingHorizontal: 10 }}><Search size={14} color={S.graphite} /></View>} />
              {rows.length === 0 ? (
                <Body color={S.graphite}>{d?.empty}</Body>
              ) : (
                <SheetTable
                  rows={rows.slice(0, shown)}
                  cols={d!.cols}
                  keyOf={(r, i) => `${d!.idOf?.(r) ?? ""}-${i}`}
                  onRowPress={d!.opens && d!.idOf ? (r) => setOpened({ kind: d!.opens!, id: Number(d!.idOf!(r)) }) : undefined}
                />
              )}
              {rows.length > shown && (
                <Press onPress={() => setShown((n) => n + PAGE)} style={(pressed) => ({ alignSelf: "flex-start", borderWidth: 1, borderColor: S.ink, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: pressed ? S.blueWash : "transparent" })}>
                  <Label color={S.ink}>{`Show ${Math.min(PAGE, rows.length - shown)} more of ${rows.length - shown}`}</Label>
                </Press>
              )}
            </ScrollView>
          )}
        </View>

        <MaterialRequestDetailModal recordId={opened?.kind === "mr" ? opened.id : null} onClose={() => setOpened(null)} />
        <PurchaseOrderDetailModal recordId={opened?.kind === "po" ? opened.id : null} onClose={() => setOpened(null)} />
        <GRNDetailModal recordId={opened?.kind === "grn" ? opened.id : null} onClose={() => setOpened(null)} />
        <MaterialIssueDetailModal recordId={opened?.kind === "issue" ? opened.id : null} onClose={() => setOpened(null)} />
      </View>
    </Modal>
  );
}

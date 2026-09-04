// Depreciation Tag Stickers — view / filter / multi-select FA Item Codes
// whose Fixed Asset Depreciation Tag (Asset Register) process is complete,
// and print asset stickers (FA Item Code + Item Name + Code 128 barcode)
// via the OS print dialog. Read-only: no FA Item Code is generated here.
import { useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import { Search, X, Check, Printer, SlidersHorizontal, RotateCcw } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { code128SVG } from "@/utils/code128";
import { toast } from "@/components/Toast";
import { PickerField } from "@/components/form/PickerField";
import { DateField } from "@/components/form/DateField";
import { useActiveFinYear } from "@/hooks/useActiveFinYear";
import { usePageRights } from "@/hooks/usePageRights";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { getCompanies } from "@/api/mastersApi";
import { getTaggedFAItemCodes, type TaggedFAItemCode } from "@/api/fixedAssetApi";

const ACCENT = "#eab308";

interface Filters { companyId: string; fromDate: string; toDate: string; finYear: string; faCode: string; itemName: string }
const EMPTY: Filters = { companyId: "", fromDate: "", toDate: "", finYear: "", faCode: "", itemName: "" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function stickerSheetHtml(rows: TaggedFAItemCode[]): string {
  const stickers = rows.map((r) => `
    <div class="sticker">
      <div class="tab"><span>FIXED ASSET</span></div>
      <div class="body">
        <div class="prop">PROPERTY OF</div>
        ${r.CompanyName ? `<div class="company">${escapeHtml(r.CompanyName)}</div>` : ""}
        <div class="barcode">${code128SVG(r.FAItemCode, { moduleWidth: 1.5, height: 60, quietZone: 8 })}</div>
        <div class="code">${escapeHtml(r.FAItemCode)}</div>
        <div class="name">${escapeHtml(r.ItemName || "")}</div>
      </div>
    </div>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;padding:6mm;color:#000;background:#fff}
    .sheet{display:flex;flex-wrap:wrap;gap:4mm}
    .sticker{display:flex;width:76mm;height:30mm;border:.4mm solid #999;border-radius:1.5mm;overflow:hidden;page-break-inside:avoid;background:#fff}
    .tab{width:11mm;background:#f4c400;display:flex;align-items:center;justify-content:center}
    .tab span{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:800;font-size:8pt;letter-spacing:1.5px;color:#222}
    .body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5mm 2mm;text-align:center;min-width:0}
    .prop{font-size:5.5pt;letter-spacing:1.5px;color:#444}
    .company{font-size:10pt;font-weight:800;line-height:1.1;margin:.3mm 0 .8mm}
    .barcode{width:100%;height:9mm}
    .barcode svg{width:100%;height:100%;display:block}
    .code{font-size:8.5pt;font-weight:700;letter-spacing:.4px;margin-top:.6mm}
    .name{font-size:6.5pt;color:#333;margin-top:.3mm;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style></head><body><div class="sheet">${stickers}</div></body></html>`;
}

export default function StickerScreen() {
  usePageRights("fixed-asset-tagging");
  const { finYearOptions } = useActiveFinYear();

  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);

  const companiesQ = useQuery({ queryKey: ["m-companies"], queryFn: getCompanies });
  const query = useQuery({
    queryKey: ["fa-tagged-codes", applied],
    queryFn: () => getTaggedFAItemCodes({
      companyId: applied.companyId ? Number(applied.companyId) : undefined,
      finYear: applied.finYear || undefined,
      fromDate: applied.fromDate || undefined,
      toDate: applied.toDate || undefined,
      faCode: applied.faCode || undefined,
      itemName: applied.itemName || undefined,
    }),
  });
  useRefetchOnFocus(query.refetch);

  const list = query.data ?? [];
  const companyOpts = useMemo(() => (companiesQ.data ?? []).map((c) => ({ key: String(c.id), label: c.label })), [companiesQ.data]);
  const finYearOpts = useMemo(() => finYearOptions.map((y) => ({ key: y, label: y })), [finYearOptions]);
  const hasFilters = Object.values(applied).some(Boolean);

  const apply = () => { setApplied(draft); setShowFilters(false); };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setSelected(new Set()); };

  const allSelected = list.length > 0 && list.every((r) => selected.has(r.TagId));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(list.map((r) => r.TagId)));
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const selectedRows = useMemo(() => list.filter((r) => selected.has(r.TagId)), [list, selected]);

  const onRefresh = async () => { setRefreshing(true); await query.refetch(); setRefreshing(false); };

  const print = async () => {
    if (selectedRows.length === 0) { toast.error("Select at least one FA Item Code"); return; }
    try {
      setPrinting(true);
      await Print.printAsync({ html: stickerSheetHtml(selectedRows) });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (!/did not complete|cancel/i.test(msg)) toast.error(msg || "Could not open the print dialog");
    } finally {
      setPrinting(false);
    }
  };

  const renderItem = ({ item }: { item: TaggedFAItemCode }) => {
    const on = selected.has(item.TagId);
    return (
      <Pressable
        onPress={() => toggleOne(item.TagId)}
        style={{
          flexDirection: "row", alignItems: "flex-start", gap: 10,
          backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8,
          borderWidth: 1, borderColor: on ? "rgba(234,179,8,0.5)" : colors.border,
        }}
      >
        <View style={{
          width: 20, height: 20, borderRadius: 6, marginTop: 1,
          alignItems: "center", justifyContent: "center",
          backgroundColor: on ? ACCENT : "transparent", borderWidth: 1.5, borderColor: on ? ACCENT : colors.border,
        }}>
          {on && <Check size={13} color="#1a1a1a" />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{
            alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7,
            backgroundColor: "rgba(234,179,8,0.14)", borderWidth: 1, borderColor: "rgba(234,179,8,0.35)",
          }}>
            <Text style={{ color: "#fde047", fontSize: 11, fontFamily: fonts.heading.bold }}>{item.FAItemCode}</Text>
          </View>
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 5 }}>
            {item.ItemName || "—"}
          </Text>
          <View style={{ alignSelf: "flex-start", marginTop: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(16,185,129,0.14)" }}>
            <Text style={{ color: "#10b981", fontSize: 9, fontFamily: fonts.heading.bold }}>TAGGED</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* toolbar */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8, height: 42, paddingHorizontal: 12,
          backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
        }}>
          <Search size={15} color="#5c6270" />
          <TextInput
            value={draft.faCode}
            onChangeText={(v) => setDraft((p) => ({ ...p, faCode: v }))}
            onSubmitEditing={apply}
            placeholder="Search FA Item Code…"
            placeholderTextColor="#5c6270"
            autoCapitalize="characters"
            style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular }}
          />
          {draft.faCode ? (
            <Pressable onPress={() => { setDraft((p) => ({ ...p, faCode: "" })); setApplied((p) => ({ ...p, faCode: "" })); }} hitSlop={8}>
              <X size={14} color="#5c6270" />
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => setShowFilters((s) => !s)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7,
                borderRadius: 999, borderWidth: 1,
                backgroundColor: hasFilters ? "rgba(234,179,8,0.14)" : colors.card,
                borderColor: hasFilters ? "rgba(234,179,8,0.35)" : colors.border,
              }}
            >
              <SlidersHorizontal size={13} color={hasFilters ? "#fde68a" : colors.mutedForeground} />
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: hasFilters ? "#fde68a" : colors.mutedForeground }}>
                Filters{hasFilters ? " •" : ""}
              </Text>
            </Pressable>
            {list.length > 0 && (
              <Pressable
                onPress={toggleAll}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}
              >
                <Check size={13} color={colors.mutedForeground} />
                <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>
                  {allSelected ? "Clear" : "Select all"}
                </Text>
              </Pressable>
            )}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
            {query.isLoading ? "…" : `${list.length} code${list.length === 1 ? "" : "s"}`}
          </Text>
        </View>

        {showFilters && (
          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Item Name</Text>
              <TextInput
                value={draft.itemName}
                onChangeText={(v) => setDraft((p) => ({ ...p, itemName: v }))}
                placeholder="Search Item Name…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.background}`, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, color: colors.foreground, fontSize: 13.5, fontFamily: fonts.body.regular, marginBottom: 14 }}
              />
              <PickerField label="Company" value={draft.companyId} options={companyOpts} clearable
                loading={companiesQ.isLoading} onSelect={(v) => setDraft((p) => ({ ...p, companyId: v }))} />
              <PickerField label="Financial Year" value={draft.finYear} options={finYearOpts} searchable={false} clearable
                onSelect={(v) => setDraft((p) => ({ ...p, finYear: v }))} />
              <DateField label="From Date" value={draft.fromDate} onChange={(v) => setDraft((p) => ({ ...p, fromDate: v }))} />
              <DateField label="To Date" value={draft.toDate} onChange={(v) => setDraft((p) => ({ ...p, toDate: v }))} />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
                <Pressable onPress={reset}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                  <RotateCcw size={13} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Reset</Text>
                </Pressable>
                <Pressable onPress={apply}
                  style={{ flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10, backgroundColor: ACCENT }}>
                  <SlidersHorizontal size={13} color="#1a1a1a" />
                  <Text style={{ color: "#1a1a1a", fontSize: 12.5, fontFamily: fonts.heading.bold }}>Apply Filter</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        )}
      </View>

      {query.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : query.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>{(query.error as Error).message}</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r) => String(r.TagId)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
No FA Item Codes with a completed Asset Register{hasFilters ? " match these filters" : " yet"}.
            </Text>
          }
        />
      )}

      {/* Sticker Print bar */}
      {selectedRows.length > 0 && (
        <View style={{ position: "absolute", left: 16, right: 16, bottom: 78 }}>
          <Pressable
            onPress={print}
            disabled={printing}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              paddingVertical: 14, borderRadius: 14, backgroundColor: ACCENT, opacity: printing ? 0.7 : 1,
              shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10,
            }}
          >
            {printing ? (
              <ActivityIndicator size="small" color="#1a1a1a" />
            ) : (
              <>
                <Printer size={16} color="#1a1a1a" />
                <Text style={{ color: "#1a1a1a", fontSize: 13, fontFamily: fonts.heading.bold }}>
                  Print Depreciation Tag Stickers ({selectedRows.length})
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

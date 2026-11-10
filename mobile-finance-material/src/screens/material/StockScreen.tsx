// RN port of src/pages/material/Stock.tsx (web), on the drawing sheet as the web draws it (title block with Ledger,
// the godown & period panel, the four figures, a ruled register of items held) — a current-balance
// (item × godown) view, not a transaction ledger, despite the page's
// pageKey being "stock-ledger". Web's 10-column desktop table (with a #
// index column and a Customer Rate/Stock Value pair that's always empty —
// CustomerRate is hard-coded NULL server-side today) becomes ruled rows
// here, dropping the dead-weight rate/value columns. Company/Project/
// Godown filtering stays client-side against the one full godowns list,
// matching web exactly. Tapping a row opens the ledger drill-down
// (StockLedgerScreen) scoped to that item+godown — a mobile-only addition
// since web never wired up its own (otherwise unused) ledger endpoint.
import { istToday } from "@/utils/istTime";
import { useEffect, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { ListTree } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, IconKey, Input, Key, Notice, Panel, RegisterHead, SearchBox, SheetMark, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { Facts, NoAccess, RecordRow, RegisterBox, RegisterLoading, SheetPage } from "@/components/sheet/Register";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getGodowns, getCompanies, getProjects, getInventoryMaster, type Godown, type InventoryMasterRow } from "@/api/stockApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import type { MainStackParamList } from "@/navigation/MainStack";

function todayISO() { return istToday(); }

function fmtNum(n: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
}

export default function StockScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rights = usePageRights("stock-ledger");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [godownId, setGodownId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState<"company" | "project" | "godown" | null>(null);

  const { data: godowns = [] } = useQuery({ queryKey: ["stock-godowns"], queryFn: getGodowns, enabled: rights.canView });
  const { data: companies = [] } = useQuery({ queryKey: ["stock-companies"], queryFn: getCompanies, enabled: rights.canView });
  const { data: projects = [] } = useQuery({ queryKey: ["stock-projects"], queryFn: getProjects, enabled: rights.canView });

  // Once a project is picked, its godown is the unambiguous match regardless
  // of which company it's filed under — a project merely tagged to a
  // company (not owned by it) has its godown listed under the OWNING
  // company, so requiring both to match hid it entirely (same bug fixed in
  // StockTransferFormModal.tsx and MaterialIssueFormModal.tsx). Company
  // alone only narrows the list before a project is chosen.
  const filteredGodowns = useMemo(
    () => godowns.filter((g) => (projectId ? String(g.projectId) === projectId : companyId ? String(g.companyId) === companyId : true)),
    [godowns, companyId, projectId],
  );

  useEffect(() => {
    if (godownId != null && filteredGodowns.length > 0 && !filteredGodowns.some((g) => g.id === godownId)) {
      setGodownId(filteredGodowns[0]?.id ?? null);
    }
  }, [filteredGodowns, godownId]);

  const selectedGodown: Godown | undefined = godowns.find((g) => g.id === godownId);

  const { data: inventory, isLoading, isFetching, isError } = useQuery({
    queryKey: ["inventory-master", godownId, dateFrom, dateTo],
    queryFn: () => getInventoryMaster(dateTo || todayISO(), godownId, dateFrom || undefined, dateTo || undefined),
    enabled: rights.canView && godownId != null,
  });

  const rows = inventory?.data ?? [];
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.ItemName || "").toLowerCase().includes(q) || (r.ItemGroupName || "").toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({
      opening: acc.opening + (r.OpeningStock || 0), in: acc.in + (r.StockIn || 0), out: acc.out + (r.StockOut || 0), closing: acc.closing + (r.ClosingStock || 0),
    }), { opening: 0, in: 0, out: 0, closing: 0 }),
    [rows],
  );

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  // Only the selected company's projects (all of them while no company is picked).
  const projectOptions: PickerOption[] = projects
    .filter((p) => !companyId || p.companyId === companyId)
    .map((p) => ({ key: p.id, label: p.name }));
  const godownOptions: PickerOption[] = filteredGodowns.map((g) => ({ key: String(g.id), label: g.name, sublabel: g.code ?? undefined }));

  const goToLedger = (row?: InventoryMasterRow) => {
    navigation.navigate("StockLedger", {
      itemId: row?.ItemID, itemName: row?.ItemName ?? undefined,
      godownId: godownId ?? undefined, godownName: selectedGodown?.name,
      dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    });
  };

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Stock" what="stock" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Stock"
          subtitle="What each godown holds: opening, in, out and closing for the period, with every movement behind an item."
          action={godownId != null ? <Key label="Ledger" icon={<ListTree size={13} color={S.ink} />} onPress={() => goToLedger()} style={{ alignSelf: "flex-start" }} /> : undefined}
        >
          <Panel title="Godown & period">
            <View>
              <PickerRow label="Company" value={companies.find((c) => c.id === companyId)?.name ?? ""} placeholder="All" onPress={() => setPicker("company")} />
              <PickerRow label="Project" value={projects.find((p) => p.id === projectId)?.name ?? ""} placeholder="All" onPress={() => setPicker("project")} />
              <PickerRow label="Godown" value={selectedGodown?.name ?? ""} placeholder="Select a godown…" onPress={() => setPicker("godown")} />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="From" style={{ flex: 1 }}>
                <Input value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" />
              </Field>
              <Field label="To" style={{ flex: 1 }}>
                <Input value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" />
              </Field>
            </View>
          </Panel>

          {godownId == null ? (
            <Body color={S.graphite}>Select a godown to see what it holds.</Body>
          ) : (
            <>
              {!!selectedGodown && (
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{selectedGodown.name}</Text>
                    {!selectedGodown.isActive && <SheetMark text="Inactive" tone="stopped" />}
                  </View>
                  <Body size={12} color={S.graphite}>{[selectedGodown.code, selectedGodown.companyName, selectedGodown.projectName, selectedGodown.location].filter(Boolean).join(" · ") || "—"}</Body>
                </View>
              )}

              {!isLoading && !isError && (
                <StatRow
                  items={[
                    { label: "Opening", value: fmtNum(totals.opening), note: "at the start" },
                    { label: "Stock in", value: `+${fmtNum(totals.in)}`, note: "received" },
                    { label: "Stock out", value: `−${fmtNum(totals.out)}`, note: "issued" },
                    { label: "Closing", value: fmtNum(totals.closing), note: "at the end", red: totals.closing < 0 },
                  ]}
                />
              )}

              <RegisterBox>
                <RegisterHead title="Items held" count={filteredRows.length} unit={["item", "items"]} />
                {rows.length > 0 && <SearchBox value={search} onChange={setSearch} placeholder="Search item or group…" />}
                {isLoading ? (
                  <RegisterLoading />
                ) : isError ? (
                  <Notice>Could not load the stock. Try again.</Notice>
                ) : filteredRows.length === 0 ? (
                  <Body color={S.graphite}>{search ? "No item matches that search." : "No stock found in this godown."}</Body>
                ) : (
                  <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                    {filteredRows.map((row, i) => (
                      <RecordRow
                        key={row.ItemID}
                        last={i === filteredRows.length - 1}
                        title={row.ItemName || row.ItemID}
                        side={fmtNum(row.ClosingStock)}
                        sideNote={`closing · ${row.UOMSymbol || row.UOMName || ""}`}
                        onPress={() => goToLedger(row)}
                        lines={[
                          row.ItemGroupName || null,
                          <Facts
                            key="f"
                            items={[
                              ["Opening", fmtNum(row.OpeningStock)],
                              ["In", row.StockIn > 0 ? `+${fmtNum(row.StockIn)}` : "—"],
                              ["Out", row.StockOut > 0 ? `−${fmtNum(row.StockOut)}` : "—"],
                            ]}
                          />,
                        ]}
                        marks={row.ClosingStock < 0 ? <SheetMark text="Below zero" tone="stopped" /> : undefined}
                        actions={
                          <IconKey onPress={() => goToLedger(row)} size={32}>
                            <ListTree size={14} color={S.ink} />
                          </IconKey>
                        }
                      />
                    ))}
                    {isFetching && <View style={{ paddingTop: 10 }}><Skel h={40} /></View>}
                  </View>
                )}
              </RegisterBox>
            </>
          )}
        </SheetShell>
      </SheetPage>

      <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={companyId ?? ""}
        onSelect={(k) => {
          setCompanyId(k || null);
          // A project that belongs to a different company no longer applies.
          if (k && projectId && projects.find((p) => p.id === projectId)?.companyId !== k) setProjectId(null);
          setPicker(null);
        }} onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={projectId ?? ""}
        onSelect={(k) => { setProjectId(k || null); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "godown"} title="Select godown" options={godownOptions} selectedKey={godownId != null ? String(godownId) : ""}
        onSelect={(k) => { setGodownId(k ? Number(k) : null); setPicker(null); }} onClose={() => setPicker(null)} searchable />
    </View>
  );
}

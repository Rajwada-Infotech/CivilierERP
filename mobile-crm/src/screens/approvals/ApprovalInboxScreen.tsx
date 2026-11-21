// RN port of src/pages/admin/ApprovalInbox.tsx, on the drawing sheet as the web draws it: the title block with Refresh;
// the figures (waiting, types, showing); a search box over document numbers; the type filter (several types at once,
// grouped by business category, each with its count) beside the date-order key; then every record waiting on this
// approver, grouped by category (Material, Finance, Engineering, Civil Work DPR, Sales / CRM, Admin) and, within it, by
// module — each module a ruled head with its count that opens to its records (collapsed at first, as on the web, so a
// long inbox reads as a short list of kinds). A record's row carries its reference, date, party, amount (or activity),
// status and step, and opens ApprovalInboxDetailModal to approve, reject or confirm. Approving or rejecting hides the
// row at once; the next fetch is the truth again.
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, ChevronDown, ChevronRight, ClipboardCheck, RefreshCw, SlidersHorizontal } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { fetchInbox, type InboxItem } from "@/api/approvalInboxApi";
import { Body, IconKey, Key, Label, Notice, Press, SearchBox, SheetMark, SheetShell, StatRow, statusTone } from "@/components/sheet/Sheet";
import { OptionRow, SheetPicker } from "@/components/sheet/FormParts";
import { RegisterBox, RegisterLoading, SheetPage, fmtDate } from "@/components/sheet/Register";
import { ALL_MODULES, CATEGORY_LABEL, CATEGORY_ORDER, DISPLAY_GROUP, MODULE_CONFIG, categoryOf, moduleOrderOf, type CategoryId } from "./approvalInboxConfig";
import { ApprovalInboxDetailModal } from "./ApprovalInboxDetailModal";

const statusText = (item: InboxItem) => (item._stage ? `${item.Status} · ${item._stage.label}` : item.Status);
const markOf = (status?: string | null) => (/draft/i.test(status || "") ? "draft" : statusTone(status || "Pending")) as "draft" | "done" | "waiting" | "stopped";

function InboxRow({ item, onPress, last }: { item: InboxItem; onPress: () => void; last: boolean }) {
  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const activity = item.Module === "civilworkdpr-approval" ? item.ActivityName?.trim() || null : null;
  const transfer = item.Module === "goods-receipt" && item.SourceTransferDocNo;
  return (
    <Press
      onPress={onPress}
      style={(pressed) => ({ paddingVertical: 11, paddingLeft: 30, paddingRight: 4, gap: 5, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: 0.2, color: S.ink }}>
          {item.Reference || `#${item.RecordId}`}
          <Text style={{ color: S.graphite, fontFamily: fonts.body.regular, fontSize: 11.5, letterSpacing: 0 }}>{`  ${fmtDate(item.RecordDate)}`}</Text>
        </Text>
        {/* A material request has no amount (pricing comes with its PO): no "₹0.00". */}
        {item.Amount != null ? (
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13.5, color: S.ink, fontVariant: ["tabular-nums"] }}>{formatINR(item.Amount, { decimals: 2 })}</Text>
        ) : activity ? (
          <Text numberOfLines={1} style={{ maxWidth: "45%", fontFamily: fonts.body.medium, fontSize: 12, color: S.ink }}>{activity}</Text>
        ) : null}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink2 }}>
        {transfer ? `Transfer ${item.SourceTransferDocNo}${item.FromGodownName && item.ToGodownName ? ` · ${item.FromGodownName} → ${item.ToGodownName}` : ""}` : party}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <SheetMark text={statusText(item)} tone={markOf(item.Status)} />
        {item.Status === "Pending" && item._canAct === false && <Label>{`Waiting on level ${item._currentLevel}${item._totalLevels ? ` of ${item._totalLevels}` : ""}`}</Label>}
        {!!item.RejectedBy && <Label color={S.red}>{`Rejected · ${item.RejectedBy}`}</Label>}
      </View>
    </Press>
  );
}

export default function ApprovalInboxScreen() {
  const queryClient = useQueryClient();
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const [docSearch, setDocSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  const { data: allItems = [], dataUpdatedAt, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // A fresh fetch is the truth about what is pending, so the rows hidden on approve / reject come back into its hands.
  // (A Civil Work DPR rung keeps its id across rework attempts: without this, rejecting attempt 1 hid attempt 2 for the
  // rest of the session.)
  const lastFetch = useRef(dataUpdatedAt);
  useEffect(() => {
    if (dataUpdatedAt !== lastFetch.current) {
      lastFetch.current = dataUpdatedAt;
      setRemovedKeys(new Set());
    }
  }, [dataUpdatedAt]);

  const items = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    return (activeModules.length ? allItems.filter((i) => activeModules.includes(i.Module)) : allItems)
      .filter((i) => !removedKeys.has(`${i.Module}-${i.RecordId}`))
      .filter((i) => !q || (i.Reference ?? "").toLowerCase().includes(q) || String(i.RecordId).includes(q))
      .sort((a, b) => {
        const m = moduleOrderOf(a.Module) - moduleOrderOf(b.Module);
        if (m) return m;
        const da = a.RecordDate ? new Date(a.RecordDate).getTime() : 0;
        const db = b.RecordDate ? new Date(b.RecordDate).getTime() : 0;
        return dateSort === "desc" ? db - da : da - db;
      });
  }, [allItems, activeModules, removedKeys, docSearch, dateSort]);

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => {
        const byModule = new Map<string, InboxItem[]>();
        items
          .filter((i) => categoryOf(i.Module) === cat)
          .forEach((i) => {
            const key = DISPLAY_GROUP[i.Module] ?? i.Module;
            if (!byModule.has(key)) byModule.set(key, []);
            byModule.get(key)!.push(i);
          });
        return { cat, count: Array.from(byModule.values()).reduce((s, l) => s + l.length, 0), modules: Array.from(byModule.entries()) };
      }).filter((g) => g.count > 0),
    [items],
  );

  const countOf = (mod: string) => allItems.filter((i) => i.Module === mod).length;
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const filtering = activeModules.length > 0 || !!docSearch.trim();

  const handleActionDone = (recordId: string, module: string) => {
    setRemovedKeys((prev) => new Set(prev).add(`${module}-${recordId}`));
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
  };

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={isFetching && !isLoading} onRefresh={() => void refetch()}>
        <SheetShell
          eyebrow="CivilierERP · Approvals"
          title="Approval inbox"
          subtitle="Every record waiting on your approval, across all modules, grouped by the kind of document."
          action={<Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => void refetch()} disabled={isFetching} style={{ alignSelf: "flex-start" }} />}
        >
          <StatRow
            items={[
              { label: "Waiting", value: isLoading ? "…" : allItems.length.toLocaleString("en-IN"), note: allItems.length ? "records for you to act on" : "nothing waiting" },
              { label: "Types", value: isLoading ? "…" : String(new Set(allItems.map((i) => i.Module)).size), note: "kinds of document waiting" },
              { label: "Showing", value: isLoading ? "…" : items.length.toLocaleString("en-IN"), note: filtering ? "after search and filter" : "everything" },
            ]}
          />

          <RegisterBox>
            <SearchBox value={docSearch} onChange={setDocSearch} placeholder="Search by document number (e.g. JV-2026-00067)…" />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Press
                onPress={() => setFilterOpen(true)}
                style={(pressed) => ({ flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: activeModules.length ? S.ink : S.line40, backgroundColor: pressed ? S.blueWash : S.paper })}
              >
                <SlidersHorizontal size={14} color={activeModules.length ? S.blue : S.graphite} />
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body.regular, fontSize: 13.5, color: activeModules.length ? S.ink : S.faint }}>
                  {activeModules.length === 0
                    ? "All approval types"
                    : activeModules.length === 1
                      ? MODULE_CONFIG[activeModules[0]]?.label ?? activeModules[0]
                      : `${activeModules.length} types`}
                </Text>
                <ChevronDown size={13} color={S.graphite} />
              </Press>
              <IconKey onPress={() => setDateSort((s) => (s === "desc" ? "asc" : "desc"))} size={44}>
                {dateSort === "desc" ? <ArrowDownWideNarrow size={15} color={S.ink} /> : <ArrowUpWideNarrow size={15} color={S.ink} />}
              </IconKey>
            </View>
            <Label>{dateSort === "desc" ? "Newest first" : "Oldest first"}</Label>

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the inbox. Pull down to try again.</Notice>
            ) : items.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 28, gap: 4 }}>
                <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, color: S.ink }}>
                  {docSearch.trim() ? `No document matches "${docSearch.trim()}"` : activeModules.length ? "No pending items for the chosen types" : "All clear"}
                </Text>
                <Body size={12} color={S.graphite}>
                  {docSearch.trim() ? "Clear the search to see the full inbox." : activeModules.length ? "Clear the filter to see the full inbox." : "No records are awaiting approval right now."}
                </Body>
              </View>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {grouped.map(({ cat, count, modules }) => (
                  <View key={cat}>
                    {/* The category heading only when the list spans more than one. */}
                    {grouped.length > 1 && (
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                        <Label color={S.ink}>{CATEGORY_LABEL[cat as CategoryId]}</Label>
                        <Label>{String(count)}</Label>
                      </View>
                    )}
                    {modules.map(([mod, modItems]) => {
                      const key = `${cat}:${mod}`;
                      const open = expanded.has(key) || !!docSearch.trim();
                      const cfg = MODULE_CONFIG[mod];
                      const Icon = cfg?.icon ?? ClipboardCheck;
                      return (
                        <View key={key} style={{ borderBottomWidth: 1, borderBottomColor: S.line15 }}>
                          <Press
                            onPress={() => toggle(key)}
                            style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, backgroundColor: pressed ? S.blueWash : "transparent" })}
                          >
                            {open ? <ChevronDown size={13} color={S.graphite} /> : <ChevronRight size={13} color={S.graphite} />}
                            <View style={{ width: 28, height: 28, borderWidth: 1, borderColor: S.line40, alignItems: "center", justifyContent: "center" }}>
                              <Icon size={13} color={S.ink} />
                            </View>
                            <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body.semibold, fontSize: 13.5, color: S.ink }}>{cfg?.label ?? modItems[0]?.ModuleLabel ?? mod}</Text>
                            <View style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10.5, color: S.graphite, fontVariant: ["tabular-nums"] }}>{modItems.length}</Text>
                            </View>
                          </Press>
                          {open && modItems.map((item, i) => <InboxRow key={`${item.Module}-${item.RecordId}`} item={item} last={i === modItems.length - 1} onPress={() => setSelected(item)} />)}
                        </View>
                      );
                    })}
                  </View>
                ))}
                <Label style={{ paddingTop: 10 }}>
                  {`${items.length} record${items.length === 1 ? "" : "s"} pending approval${activeModules.length ? ` · ${activeModules.map((m) => MODULE_CONFIG[m]?.label ?? m).join(", ")}` : ""}`}
                </Label>
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      {/* The type filter: every module, grouped by category, several at once, with its pending count. */}
      <SheetPicker
        visible={filterOpen}
        title="Filter by type"
        note={activeModules.length ? `${activeModules.length} chosen` : "All approval types"}
        onClose={() => setFilterOpen(false)}
        footer={
          <View style={{ flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: S.ink }}>
            <Key label="Clear" onPress={() => setActiveModules([])} disabled={!activeModules.length} />
            <Key tone="ink" label="Done" onPress={() => setFilterOpen(false)} style={{ flex: 1 }} />
          </View>
        }
      >
        <ScrollView>
          {CATEGORY_ORDER.map((cat) => {
            const mods = ALL_MODULES.filter((m) => categoryOf(m) === cat);
            if (!mods.length) return null;
            return (
              <View key={cat}>
                <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                  <Label color={S.ink}>{CATEGORY_LABEL[cat]}</Label>
                </View>
                {mods.map((m) => {
                  const n = countOf(m);
                  const on = activeModules.includes(m);
                  return (
                    <OptionRow
                      key={m}
                      check
                      selected={on}
                      label={MODULE_CONFIG[m].label}
                      sub={n ? `${n} waiting` : undefined}
                      onPress={() => setActiveModules((prev) => (on ? prev.filter((x) => x !== m) : [...prev, m]))}
                    />
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </SheetPicker>

      <ApprovalInboxDetailModal item={selected} onClose={() => setSelected(null)} onActionDone={handleActionDone} />
    </View>
  );
}

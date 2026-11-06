// Mobile-only stock ledger drill-down, on the drawing sheet: web's Stock.tsx never wired up its own stockLedgerApi.ts,
// so this screen is the first UI on that (real, paginated) endpoint. Reached from StockScreen scoped to one item (tap a
// row) or to a whole godown (the Ledger key, no item filter). The title block names the item and godown; the figures
// are the period's in, out and balance; the register has a search box, From / To, the In / Out keys and one ruled row
// per movement (its date, type, reference and godown, the signed quantity). The API gives no running balance per line,
// only each line's signed quantity and the overall balance, so that is what shows: no running total is invented.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { sheet as S } from "@/theme/colors";
import { getStockLedger, REF_TYPE_LABEL, type StockLedgerEntry } from "@/api/stockLedgerApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Body, Field, Input, Notice, RegisterHead, SearchBox, SheetMark, SheetShell, StatRow } from "@/components/sheet/Sheet";
import { Facts, KeyRow, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, SheetPage, fmtDate } from "@/components/sheet/Register";

const PAGE_SIZE = 20;
const fmtNum = (n: number | null | undefined) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
const docRefFor = (e: StockLedgerEntry) => e.DocNo || e.GRNNo || e.PurchaseOrderNo || e.IssueNo || "—";

export default function StockLedgerScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "StockLedger">>();
  const { itemId, itemName, godownId, godownName, dateFrom: initialFrom, dateTo: initialTo } = route.params ?? {};
  const [type, setType] = useState<"" | "IN" | "OUT">("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(initialFrom ?? "");
  const [dateTo, setDateTo] = useState(initialTo ?? "");

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["stock-ledger", itemId, godownId, type, search, dateFrom, dateTo],
    queryFn: ({ pageParam }) =>
      getStockLedger({
        page: pageParam,
        limit: PAGE_SIZE,
        itemId: itemId || undefined,
        godownId: godownId ?? undefined,
        type: type || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < (last?.totalPages ?? 1) ? pages.length + 1 : undefined),
  });

  const entries: StockLedgerEntry[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const summary = data?.pages?.[0]?.summary;

  return (
    <SheetPage onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
      <SheetShell eyebrow="CivilierERP · Material · Stock ledger" title={itemName || "Stock ledger"} subtitle={godownName || "All godowns"}>
        {!!summary && (
          <StatRow
            items={[
              { label: "Balance", value: fmtNum(summary.balance), note: "in minus out", red: summary.balance < 0 },
              { label: "In", value: `+${fmtNum(summary.stockIn)}`, note: "received" },
              { label: "Out", value: `−${fmtNum(summary.stockOut)}`, note: "issued" },
            ]}
          />
        )}

        <RegisterBox>
          <RegisterHead title="Movements" count={entries.length} unit={["movement loaded", "movements loaded"]} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search doc no, GRN, PO…" />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="From" style={{ flex: 1 }}>
              <Input value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" />
            </Field>
            <Field label="To" style={{ flex: 1 }}>
              <Input value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" />
            </Field>
          </View>
          <KeyRow
            options={[
              { value: "" as const, label: "All" },
              { value: "IN" as const, label: "In" },
              { value: "OUT" as const, label: "Out" },
            ]}
            value={type}
            onChange={setType}
          />

          {isLoading ? (
            <RegisterLoading />
          ) : isError ? (
            <Notice>{`Could not load the stock ledger. ${(error as Error | null)?.message ?? ""}`}</Notice>
          ) : entries.length === 0 ? (
            <Body color={S.graphite}>No movements found.</Body>
          ) : (
            <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
              {entries.map((e, i) => {
                const isIn = e.Type === "IN";
                return (
                  <RecordRow
                    key={e.StockID}
                    last={i === entries.length - 1}
                    title={!itemId ? e.ItemName || e.ItemID : REF_TYPE_LABEL[e.RefType ?? ""] || e.RefType || "Movement"}
                    date={fmtDate(e.LedgerDate)}
                    side={`${isIn ? "+" : "−"}${fmtNum(e.Qty)} ${e.UOMSymbol || e.UOM || ""}`}
                    lines={[<Facts key="f" items={[...(!itemId ? ([["Type", REF_TYPE_LABEL[e.RefType ?? ""] || e.RefType || "—"]] as [string, string][]) : []), ["Ref", docRefFor(e)], ["Godown", e.GodownName]]} />]}
                    marks={<SheetMark text={isIn ? "In" : "Out"} tone={isIn ? "done" : "stopped"} />}
                  />
                );
              })}
              <RegisterFoot loadingMore={isFetchingNextPage} done={!hasNextPage} shown={entries.length} />
            </View>
          )}
        </RegisterBox>
      </SheetShell>
    </SheetPage>
  );
}

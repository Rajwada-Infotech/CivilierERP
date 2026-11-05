// "Export" key that opens a PDF / Excel / CSV choice, as the web app's ExportMenu does.
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { Download } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { OptionPickerModal } from "@/components/OptionPicker";
import { exportRows, type ExportColumn, type ExportFormat } from "@/utils/exportFile";

const FORMATS = [
  { key: "pdf", label: "PDF", sublabel: "Print-ready table" },
  { key: "xlsx", label: "Excel (.xlsx)", sublabel: "Auto-fitted columns" },
  { key: "csv", label: "CSV", sublabel: "Opens in any spreadsheet" },
];

export function ExportButton<T>({ title, filename, rows, columns, disabled }: {
  title: string; filename: string; rows: T[]; columns: ExportColumn<T>[]; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const off = disabled || busy || rows.length === 0;

  const run = async (format: ExportFormat) => {
    setOpen(false);
    setBusy(true);
    try { await exportRows({ format, title, filename, rows, columns }); }
    catch (e) { toast.error((e as Error).message || "Export failed"); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Pressable
        onPress={off ? undefined : () => setOpen(true)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, opacity: off ? 0.45 : 1 }}
      >
        <Download size={13} color={colors.foreground} />
        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{busy ? "Preparing…" : "Export"}</Text>
      </Pressable>
      <OptionPickerModal
        visible={open} title={`Export ${rows.length} ${rows.length === 1 ? "row" : "rows"}`} searchable={false}
        options={FORMATS} selectedKey=""
        onSelect={(k) => run(k as ExportFormat)} onClose={() => setOpen(false)}
      />
    </>
  );
}

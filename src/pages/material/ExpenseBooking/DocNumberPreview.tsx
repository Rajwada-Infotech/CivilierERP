import React, { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Hash, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DocType {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix: string;
  Description: string;
  EntryType: string;
}

interface Props {
  entryTypeFilter?: string;
  finYear?: string;
  selectedDocTypeId: number | null;
  onSelect: (docTypeId: number | null, preview: string) => void;
  preview: string;
}

export async function fetchNextDocNumber(
  docTypeId: number,
  finYear?: string,
): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(
    `/api/document-type/${docTypeId}/next-number${qs}`,
  );
  if (!res.ok) return "";
  const data = await res.json();
  return data.nextDocNo ?? "";
}

async function fetchDocTypes(): Promise<DocType[]> {
  const res = await fetchWithAuth("/api/document-type");
  if (!res.ok) return [];
  return res.json();
}

export function DocNumberPreview({
  entryTypeFilter,
  finYear,
  selectedDocTypeId,
  onSelect,
}: Props) {
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [docTypesLoading, setDocTypesLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setDocTypesLoading(true);
    fetchDocTypes()
      .then((all) => {
        const filtered = entryTypeFilter
          ? all.filter(
              (d) =>
                d.EntryType?.toLowerCase().includes(
                  entryTypeFilter.toLowerCase(),
                ) ||
                d.Description?.toLowerCase().includes(
                  entryTypeFilter.toLowerCase(),
                ) ||
                d.Prefix?.toLowerCase().includes(entryTypeFilter.toLowerCase()),
            )
          : all;

        setDocTypes(filtered);
      })
      .finally(() => setDocTypesLoading(false));
  }, [entryTypeFilter]);

  const handleSelect = async (value: string) => {
    if (!value) {
      onSelect(null, "");
      return;
    }
    const id = parseInt(value, 10);
    setGenerating(true);
    const next = await fetchNextDocNumber(id, finYear);
    onSelect(id, next);
    setGenerating(false);
  };

  const handleRefresh = async () => {
    if (!selectedDocTypeId) return;
    setRefreshing(true);
    const next = await fetchNextDocNumber(selectedDocTypeId, finYear);
    onSelect(selectedDocTypeId, next);
    setRefreshing(false);
  };

  const selectedType = docTypes.find(
    (d) => d.TypeOfDocId === selectedDocTypeId,
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <Select
            value={selectedDocTypeId ? String(selectedDocTypeId) : ""}
            onValueChange={handleSelect}
            disabled={docTypesLoading}
          >
            <SelectTrigger>
              <div className="flex items-center gap-2 min-w-0">
                <Hash size={13} className="text-muted-foreground shrink-0" />
                <SelectValue
                  placeholder={
                    docTypesLoading
                      ? "Loading document types..."
                      : docTypes.length === 0
                        ? "No document types found"
                        : "Select document type..."
                  }
                />
              </div>
            </SelectTrigger>
            <SelectContent>
              {docTypes.map((dt) => (
                <SelectItem key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">
                      {dt.FullPrefix ?? dt.Prefix}
                    </span>
                    <span className="text-xs opacity-50">-</span>
                    <span className="text-xs opacity-80">{dt.Description}</span>
                    {dt.EntryType && (
                      <span className="text-[10px] opacity-50 ml-auto pl-3">
                        {dt.EntryType}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedDocTypeId && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Regenerate next number"
            className="h-9 w-9 flex items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors shrink-0"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {selectedType && generating && (
        <p className="px-1 text-xs text-muted-foreground animate-pulse">
          Generating next number...
          {finYear ? ` FY ${finYear}` : ""}
        </p>
      )}
    </div>
  );
}

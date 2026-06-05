/**
 * SignaturePicker.tsx
 *
 * Reusable component that fetches saved signatures from dbo.Signatures,
 * lets the user select one, and renders the stamp inline.
 *
 * Props:
 *   value       — currently selected signature Id (null = none)
 *   onChange    — called with (id: number | null)
 *   disabled?   — grey-out for read-only contexts
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PenLine, CheckCircle2, X, ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Types ──────────────────────────────────────────────────────────────────────
interface SignatureRecord {
  Id: number;
  Name: string;
  Owner: string | null;
  SignatureData: string; // base64 image, e.g. "data:image/png;base64,..."
  Status: string;
}

interface Props {
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
}

// ── API ────────────────────────────────────────────────────────────────────────
async function fetchSignatures(): Promise<SignatureRecord[]> {
  const res = await fetchWithAuth("/api/signatures");
  if (!res.ok) throw new Error("Failed to load signatures");
  const data = await res.json();
  // API may return { data: [...] } or [...] directly
  return Array.isArray(data) ? data : (data.data ?? []);
}

// ── Component ──────────────────────────────────────────────────────────────────
export function SignaturePicker({ value, onChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false);

  const { data: signatures = [], isLoading } = useQuery<SignatureRecord[]>({
    queryKey: ["signatures-library"],
    queryFn: fetchSignatures,
    staleTime: 5 * 60 * 1000,
  });

  const active = signatures.find((s) => s.Id === value) ?? null;

  return (
    <div style={{ userSelect: "none" }}>
      {/* ── Trigger row ── */}
      <div
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          border: "1.5px solid var(--border)",
          borderRadius: 9,
          cursor: disabled ? "not-allowed" : "pointer",
          background: disabled ? "var(--muted)" : "var(--card)",
          opacity: disabled ? 0.6 : 1,
          transition: "border-color 0.15s",
          ...(open ? { borderColor: "hsl(var(--primary))" } : {}),
        }}
      >
        <PenLine size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />

        {active ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {/* Signature thumbnail */}
            <img
              src={active.SignatureData}
              alt={active.Name}
              style={{
                height: 32,
                maxWidth: 120,
                objectFit: "contain",
                borderRadius: 4,
                background: "#fff",
                border: "1px solid var(--border)",
                padding: "2px 4px",
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {active.Name}
              </div>
              {active.Owner && (
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{active.Owner}</div>
              )}
            </div>
            <CheckCircle2 size={14} style={{ color: "hsl(142 72% 38%)", flexShrink: 0, marginLeft: "auto" }} />
          </div>
        ) : (
          <span style={{ flex: 1, fontSize: 13, color: "var(--muted-foreground)" }}>
            {isLoading ? "Loading signatures…" : "Select a signature to stamp…"}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {value !== null && !disabled && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              style={{ display: "flex", cursor: "pointer", color: "var(--muted-foreground)", padding: 2 }}
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown
            size={13}
            style={{
              color: "var(--muted-foreground)",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          />
        </div>
      </div>

      {/* ── Dropdown panel ── */}
      {open && !disabled && (
        <div
          style={{
            marginTop: 4,
            border: "1.5px solid hsl(var(--primary))",
            borderRadius: 9,
            background: "var(--card)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            overflow: "hidden",
            zIndex: 100,
            position: "relative",
          }}
        >
          {signatures.length === 0 ? (
            <div
              style={{
                padding: "20px 16px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--muted-foreground)",
              }}
            >
              No signatures found.{" "}
              <span
                style={{ color: "hsl(var(--primary))", cursor: "pointer" }}
                onClick={() => window.open("/admin/signatures", "_blank")}
              >
                Add one in Admin → Signatures
              </span>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 0,
              }}
            >
              {signatures.map((sig, idx) => {
                const isSelected = sig.Id === value;
                const isLastRow =
                  idx >= signatures.length - (signatures.length % 3 || 3);
                return (
                  <button
                    key={sig.Id}
                    type="button"
                    onClick={() => {
                      onChange(isSelected ? null : sig.Id);
                      setOpen(false);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "14px 12px",
                      border: "none",
                      borderRight: "1px solid var(--border)",
                      borderBottom: isLastRow ? "none" : "1px solid var(--border)",
                      background: isSelected
                        ? "hsl(var(--primary) / 0.08)"
                        : "transparent",
                      cursor: "pointer",
                      transition: "background 0.12s",
                      position: "relative",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {/* Checkmark */}
                    {isSelected && (
                      <CheckCircle2
                        size={14}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          color: "hsl(142 72% 38%)",
                        }}
                      />
                    )}

                    {/* Signature image */}
                    <div
                      style={{
                        width: "100%",
                        height: 48,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#fff",
                        borderRadius: 6,
                        border: isSelected
                          ? "1.5px solid hsl(var(--primary))"
                          : "1px solid var(--border)",
                        padding: "4px 8px",
                      }}
                    >
                      <img
                        src={sig.SignatureData}
                        alt={sig.Name}
                        style={{
                          maxHeight: 40,
                          maxWidth: "100%",
                          objectFit: "contain",
                        }}
                      />
                    </div>

                    {/* Name */}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: isSelected ? 600 : 400,
                        color: isSelected ? "hsl(var(--primary))" : "var(--foreground)",
                        textAlign: "center",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sig.Name}
                    </span>
                    {sig.Owner && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--muted-foreground)",
                          textAlign: "center",
                        }}
                      >
                        {sig.Owner}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
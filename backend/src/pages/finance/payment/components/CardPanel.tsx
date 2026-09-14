import React, { useState, useEffect } from "react";
import { CreditCard, AlertTriangle, ChevronDown } from "lucide-react";
import { Field } from "./FormFields";
import { fetchCardsByBank } from "../api";
import { maskCardNumber } from "../formHelpers";
import type { PaymentRecord, CardOption } from "../types";

// Lets the user pick which specific card (from Card Master) was used for a
// "Card" mode payment, since one bank can have multiple cards on file.
// Mirrors ChequePanel's bank → lot lookup, but cards are an optional layer on
// top of the existing free-text cardReference (transaction/approval ID).

interface CardPanelProps {
  bankId: number | null;
  form: Omit<PaymentRecord, "id">;
  set: <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => void;
}

export function CardPanel({ bankId, form, set }: CardPanelProps) {
  const [cards, setCards] = useState<CardOption[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  // Fetch cards whenever bankId changes; auto-select if there's exactly one
  useEffect(() => {
    if (!bankId) {
      setCards([]);
      return;
    }
    setLoadingCards(true);
    fetchCardsByBank(bankId)
      .then((fetched) => {
        setCards(fetched);
        if (fetched.length === 1 && !form.cardId) {
          set("cardId", fetched[0].id);
        }
      })
      .catch(() => setCards([]))
      .finally(() => setLoadingCards(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  if (!bankId) return null;

  if (loadingCards) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        Loading cards…
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
        <AlertTriangle size={12} />
        No cards on file for this bank. You can still enter the transaction ID
        below, or add a card in Card Master.
      </div>
    );
  }

  const selected = cards.find((c) => c.id === form.cardId) ?? null;

  return (
    <Field
      label="Card Used"
      hint="Select which card on file was used for this transaction."
    >
      <div className="relative">
        <CreditCard
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <select
          value={form.cardId ? String(form.cardId) : ""}
          onChange={(e) =>
            set("cardId", e.target.value ? Number(e.target.value) : null)
          }
          className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— Select card —</option>
          {cards.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {[
                c.card_network,
                maskCardNumber(c.card_number),
                c.card_holder_name,
              ]
                .filter(Boolean)
                .join(" · ")}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
      {selected && (
        <p className="text-[11px] text-muted-foreground/70 mt-1 pl-1">
          {[selected.card_type, selected.card_holder_name]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </Field>
  );
}

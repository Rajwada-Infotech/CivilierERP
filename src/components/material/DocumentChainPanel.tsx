import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, FileText, FileSignature, ShoppingCart, Truck, Car, Receipt } from "lucide-react";
import {
  getDocumentChain,
  CHAIN_ROUTES,
  type ChainDocType,
  type ChainNode,
} from "@/api/materialChainApi";

const DOC_ICON: Record<ChainDocType, React.ElementType> = {
  wo: ClipboardList,
  qt: FileSignature,
  mr: FileText,
  po: ShoppingCart,
  vio: Car,
  grn: Truck,
  expense: Receipt,
};

const SHEET_CHIP = "bg-card border-foreground/40 text-foreground hover:border-foreground hover:bg-primary/5";
const DOC_COLOR: Record<ChainDocType, string> = {
  // On the sheet every document is an ink-ruled chip (docs/DESIGN.md: no per-type colours); the chip's own label
  // and icon say which document it is.
  wo: SHEET_CHIP,
  qt: SHEET_CHIP,
  mr: SHEET_CHIP,
  po: SHEET_CHIP,
  vio: SHEET_CHIP,
  grn: SHEET_CHIP,
  expense: SHEET_CHIP,
};

/**
 * Clickable Linked Documents panel — every document in the procurement
 * chain (Work Order → Material Request → Quotation → Purchase Order → GRN → Invoice) is shown as a
 * hyperlink. Clicking one navigates to that document's page with
 * ?view=<id>, which each page's deep-link effect picks up and opens.
 */
export const DocumentChainPanel: React.FC<{
  docType: ChainDocType;
  id: number | null | undefined;
}> = ({ docType, id }) => {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["document-chain", docType, id],
    queryFn: () => getDocumentChain(docType, id as number),
    enabled: !!id,
    staleTime: 30_000,
  });

  if (!id) return null;

  const goTo = (node: ChainNode) => {
    navigate(`${CHAIN_ROUTES[node.docType]}?view=${node.id}`);
  };

  const Badge = ({ node, current }: { node: ChainNode; current?: boolean }) => {
    const Icon = DOC_ICON[node.docType];
    return (
      <button
        type="button"
        onClick={() => !current && goTo(node)}
        disabled={current}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 border text-[0.6875rem] font-semibold transition-opacity ${DOC_COLOR[node.docType]} ${
          current ? "opacity-100 cursor-default" : "hover:opacity-75 cursor-pointer"
        }`}
        title={current ? undefined : `Open ${node.label} ${node.docNo ?? ""}`}
      >
        <Icon size={11} />
        {node.docNo || `#${node.id}`}
      </button>
    );
  };

  return (
    <div className="border-t border-foreground/30 pt-4">
      <p className="text-[0.625rem] font-heading font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3 flex items-center gap-1.5">
        <ArrowRight size={10} className="text-foreground" /> Linked Documents
      </p>
      {isLoading ? (
        <p className="text-[0.6875rem] text-muted-foreground">Loading chain...</p>
      ) : !data ? (
        <p className="text-[0.6875rem] text-muted-foreground italic">No chain data yet</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {data.upstream.map((node, i) => (
            <React.Fragment key={`${node.docType}-${node.id}`}>
              <Badge node={node} />
              <ArrowRight size={10} className="text-muted-foreground shrink-0" />
            </React.Fragment>
          ))}
          <Badge node={data.current} current />
          {data.downstream.map((node) => (
            <React.Fragment key={`${node.docType}-${node.id}`}>
              <ArrowRight size={10} className="text-muted-foreground shrink-0" />
              <Badge node={node} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

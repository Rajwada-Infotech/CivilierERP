import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, ShoppingCart, Truck, Car, Receipt } from "lucide-react";
import {
  getDocumentChain,
  CHAIN_ROUTES,
  type ChainDocType,
  type ChainNode,
} from "@/api/materialChainApi";

const DOC_ICON: Record<ChainDocType, React.ElementType> = {
  mr: FileText,
  po: ShoppingCart,
  vio: Car,
  grn: Truck,
  expense: Receipt,
};

const DOC_COLOR: Record<ChainDocType, string> = {
  mr: "bg-indigo-500/10 border-indigo-500/20 text-indigo-700 dark:text-indigo-400",
  po: "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400",
  vio: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400",
  grn: "bg-teal-500/10 border-teal-500/20 text-teal-700 dark:text-teal-400",
  expense: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
};

/**
 * Clickable Linked Documents panel — every document in the procurement
 * chain (Material Request → Purchase Order → GRN → Invoice) is shown as a
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
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-opacity ${DOC_COLOR[node.docType]} ${
          current ? "opacity-100 cursor-default ring-1 ring-inset ring-current" : "hover:opacity-75 cursor-pointer"
        }`}
        title={current ? undefined : `Open ${node.label} ${node.docNo ?? ""}`}
      >
        <Icon size={11} />
        {node.docNo || `#${node.id}`}
      </button>
    );
  };

  return (
    <div className="border-t border-border/60 pt-4">
      <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
        <ArrowRight size={10} className="text-emerald-600 dark:text-emerald-400" /> Linked Documents
      </p>
      {isLoading ? (
        <p className="text-[11px] text-muted-foreground">Loading chain...</p>
      ) : !data ? (
        <p className="text-[11px] text-muted-foreground italic">No chain data yet</p>
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

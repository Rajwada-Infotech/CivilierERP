import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Eye, Download, AlertCircle, Clock, X } from "lucide-react";
import { API, authHeaders, fetchAllotmentLetter, fmtDate } from "./portalApi";
import {
  PageHeader, Card, CardHeader, GOLD, TEXT, TEXT_MUTED, TEXT_FAINT, INK, HAIRLINE, SURFACE,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number };

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  Draft:  { bg: "#fef9c3", color: "#854d0e", label: "Draft" },
  Issued: { bg: "#dcfce7", color: "#166534", label: "Issued" },
};

// Fetches the PDF using portal Bearer-token auth, converts to a blob object URL.
// Plain <a href> and <iframe src> cannot carry the Authorization header, so we
// fetch the bytes first and hand the component a local blob URL it can use freely.
function usePdfBlobUrl(applicationId: number, enabled: boolean) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    setLoading(true);
    setFetchError(null);
    fetch(`${API}/allotment-letter/pdf?applicationId=${applicationId}`, { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error("PDF not available");
        return r.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((e) => setFetchError(e.message || "Failed to load PDF"))
      .finally(() => setLoading(false));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [applicationId, enabled]);

  return { blobUrl, loading, fetchError };
}

function PdfModal({
  applicationId,
  alNo,
  onClose,
}: {
  applicationId: number;
  alNo: string;
  onClose: () => void;
}) {
  const { blobUrl, loading, fetchError } = usePdfBlobUrl(applicationId, true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl h-[90vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ background: INK }}>
          <div className="flex items-center gap-2">
            <FileText size={15} style={{ color: GOLD }} />
            <span className="text-sm font-semibold text-white">{alNo} — Allotment Letter</span>
          </div>
          <div className="flex items-center gap-3">
            {blobUrl && (
              <a
                href={blobUrl}
                download={`${alNo}.pdf`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: GOLD, color: "#000" }}
              >
                <Download size={12} /> Download
              </a>
            )}
            <button onClick={onClose} className="text-white/60 hover:text-white p-1" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {loading && (
            <p className="text-sm" style={{ color: TEXT_FAINT }}>Loading PDF…</p>
          )}
          {fetchError && (
            <p className="text-sm text-red-600">{fetchError}</p>
          )}
          {blobUrl && (
            <iframe
              src={blobUrl}
              title="Allotment Letter"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

const PortalDocuments: React.FC = () => {
  const { applicationId } = useOutletContext<Ctx>();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: al, isLoading, error } = useQuery({
    queryKey: ["portal-allotment-letter", applicationId],
    queryFn: () => fetchAllotmentLetter(applicationId),
    staleTime: 60_000,
  });

  const statusStyle = al ? (STATUS_STYLE[al.Status] ?? STATUS_STYLE.Draft) : null;
  const canView = al?.Status === "Issued";

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="My Property"
          title="Documents"
          subtitle="Official documents related to your property booking."
        />

        <Card>
          <CardHeader icon={FileText} title="Allotment Letter" />

          <div className="p-5">
            {isLoading ? (
              <div className="py-8 text-center text-sm" style={{ color: TEXT_FAINT }}>
                Loading document details…
              </div>
            ) : error || !al ? (
              <div className="flex items-start gap-3 rounded-xl px-4 py-4" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                <AlertCircle size={16} style={{ color: "#c2410c", marginTop: 2, flexShrink: 0 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#c2410c" }}>Not yet available</p>
                  <p className="text-xs mt-0.5" style={{ color: "#9a3412" }}>
                    Your Allotment Letter has not been issued yet. It will appear here once it is ready.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl px-4 py-4"
                  style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold tracking-wide" style={{ color: GOLD, fontFamily: "monospace" }}>
                        {al.AlNo}
                      </span>
                      {statusStyle && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: statusStyle.bg, color: statusStyle.color }}>
                          {statusStyle.label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold" style={{ color: TEXT }}>Allotment Letter</p>
                    <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: TEXT_MUTED }}>
                      {al.DraftedOn && (
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> Drafted {fmtDate(al.DraftedOn)}
                        </span>
                      )}
                      {al.IssuedOn && (
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> Issued {fmtDate(al.IssuedOn)}
                        </span>
                      )}
                    </div>
                    {al.Remarks && (
                      <p className="text-xs mt-1.5" style={{ color: TEXT_MUTED }}>{al.Remarks}</p>
                    )}
                  </div>

                  {canView && (
                    <button
                      onClick={() => setModalOpen(true)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
                      style={{ background: INK, color: "#fff" }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      <Eye size={13} /> Preview & Download
                    </button>
                  )}
                </div>

                {al.Status === "Draft" && (
                  <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#fef9c3", color: "#713f12" }}>
                    Your Allotment Letter is being prepared. You will be able to preview and download it once it has been officially issued.
                  </div>
                )}

                <div className="rounded-xl px-4 py-4" style={{ border: `1px dashed ${HAIRLINE}` }}>
                  <p className="text-xs font-semibold mb-1.5" style={{ color: TEXT }}>About this document</p>
                  <p className="text-xs leading-relaxed" style={{ color: TEXT_MUTED }}>
                    The Allotment Letter is an official RERA-mandated document issued by the developer confirming
                    the allotment of your unit. It includes unit details, project information, booking amount, and
                    key terms. Retain this document — it serves as proof of allotment before the Agreement to Sell
                    is executed.
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {modalOpen && al && (
        <PdfModal applicationId={applicationId} alNo={al.AlNo} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
};

export default PortalDocuments;

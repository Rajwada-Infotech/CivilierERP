import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SearchStatus, DocumentUpload } from "iconsax-react";
import {
  ExternalLink,
  Calendar,
  Search,
  CheckCircle2,
  Clock,
  FilePlus,
  AlertCircle,
  ArrowRight,
  Globe,
  Check,
  XCircle,
  Building2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalPortalPane } from "@/components/legal/LegalPortalPane";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getLegalSearches,
  createLegalSearch,
  recordSearchOutcome,
  createLegalDeed,
  type LegalSearchItem,
  type LegalCandidateItem,
} from "@/api/legalOperationsApi";
import { getLegalLookup } from "@/api/legalMastersApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LegalRegistrationSearchPage() {
  const rights = usePageRights("legal-registration-search");
  const deedRights = usePageRights("legal-deed-registrations");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Split Portal Pane State ──
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalUrl, setPortalUrl] = useState("https://igr.wb.gov.in/");
  const [portalOfficeTitle, setPortalOfficeTitle] = useState("West Bengal Registration Portal");
  const [portalExpanded, setPortalExpanded] = useState(false);

  // ── Step 1: Search Form Inputs ──
  const [searchDate, setSearchDate] = useState(new Date().toISOString().slice(0, 10));
  const [officeId, setOfficeId] = useState("");
  const [mouzaId, setMouzaId] = useState("");
  const [rsDag, setRsDag] = useState("");
  const [lrDag, setLrDag] = useState("");
  const [rsKhatian, setRsKhatian] = useState("");
  const [lrKhatian, setLrKhatian] = useState("");
  const [partyName, setPartyName] = useState("");
  const [deedNoCriteria, setDeedNoCriteria] = useState("");
  const [deedYearCriteria, setDeedYearCriteria] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [searchNotes, setSearchNotes] = useState("");

  // ── Step 2: Active Working Search & Candidates ──
  const [activeSearch, setActiveSearch] = useState<LegalSearchItem | null>(null);
  const [candidates, setCandidates] = useState<LegalCandidateItem[]>([]);
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [candidateDeedNo, setCandidateDeedNo] = useState("");
  const [candidateDeedYear, setCandidateDeedYear] = useState(new Date().getFullYear().toString());
  const [candidatePartySummary, setCandidatePartySummary] = useState("");
  const [candidatePropertySummary, setCandidatePropertySummary] = useState("");

  // ── Outcome Options ──
  const [outcomeDate, setOutcomeDate] = useState(new Date().toISOString().slice(0, 10));
  const [searchOutcome, setSearchOutcome] = useState("Deed Found");
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");

  // ── Step 3: Fast Deed Fill / Upload Form ──
  const [showDeedUploadForm, setShowDeedUploadForm] = useState(false);
  const [deedNo, setDeedNo] = useState("");
  const [deedYear, setDeedYear] = useState(new Date().getFullYear().toString());
  const [deedTypeId, setDeedTypeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [deedRsDag, setDeedRsDag] = useState("");
  const [deedLrDag, setDeedLrDag] = useState("");
  const [deedRsKhatian, setDeedRsKhatian] = useState("");
  const [deedLrKhatian, setDeedLrKhatian] = useState("");
  const [area, setArea] = useState("");
  const [areaUnitId, setAreaUnitId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [consideration, setConsideration] = useState("");
  const [marketValue, setMarketValue] = useState("");
  const [stampDuty, setStampDuty] = useState("");

  // Master Queries
  const { data: offices = [] } = useQuery({ queryKey: ["legal-lookup", "registration-office"], queryFn: () => getLegalLookup("registration-office") });
  const { data: portalLinks = [] } = useQuery({ queryKey: ["legal-lookup", "portal-link"], queryFn: () => getLegalLookup("portal-link") });
  const { data: mouzas = [] } = useQuery({ queryKey: ["legal-lookup", "mouza"], queryFn: () => getLegalLookup("mouza") });
  const { data: users = [] } = useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user") });
  const { data: deedTypes = [] } = useQuery({ queryKey: ["legal-lookup", "deed-type"], queryFn: () => getLegalLookup("deed-type") });
  const { data: projects = [] } = useQuery({ queryKey: ["legal-lookup", "project"], queryFn: () => getLegalLookup("project") });
  const { data: areaUnits = [] } = useQuery({ queryKey: ["legal-lookup", "area-unit"], queryFn: () => getLegalLookup("area-unit") });
  const { data: parties = [] } = useQuery({ queryKey: ["legal-lookup", "person"], queryFn: () => getLegalLookup("person") });

  const { data: searches = [], isLoading } = useQuery({
    queryKey: ["legal-searches"],
    queryFn: getLegalSearches,
  });

  // Portal link mapped for chosen office
  const selectedOfficeObj = offices.find((o) => String(o.value) === String(officeId));
  const mappedPortalLink = portalLinks.find(
    (l) => l.OfficeId === Number(officeId) || (l as any).OfficeId == null
  ) as any;
  const verifiedUrl = mappedPortalLink?.Url || (selectedOfficeObj as any)?.Url || "https://igr.wb.gov.in/";

  // Open the portal in right split workspace
  const handleOpenSidePortal = (urlToOpen?: string, titleToDisplay?: string) => {
    const targetUrl = urlToOpen || verifiedUrl;
    setPortalUrl(targetUrl);
    setPortalOfficeTitle(titleToDisplay || selectedOfficeObj?.label || "West Bengal Registration Portal");
    setPortalOpen(true);
  };

  // Mutations
  const startSearchMutation = useMutation({
    mutationFn: createLegalSearch,
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-searches"] });

      const createdItem: LegalSearchItem = {
        SearchId: res.searchId,
        SearchNumber: res.searchNumber,
        PlannedSearchDate: searchDate,
        ActualSearchDate: null,
        OfficeId: Number(officeId),
        OfficeName: selectedOfficeObj?.label || "Office",
        OfficeCode: "",
        PortalLinkId: mappedPortalLink?.LinkId || null,
        PortalUrl: verifiedUrl,
        LinkLabel: mappedPortalLink?.label || "West Bengal Registration Portal",
        AssignedUserId: assignedUserId ? Number(assignedUserId) : null,
        AssignedUserName: users.find((u) => String(u.value) === String(assignedUserId))?.label || null,
        MouzaId: mouzaId ? Number(mouzaId) : null,
        MouzaName: mouzas.find((m) => String(m.value) === String(mouzaId))?.label || null,
        JLNo: null,
        PlotNo: rsDag || null,
        KhatianNo: rsKhatian || null,
        RsDag: rsDag || null,
        LrDag: lrDag || null,
        RsKhatian: rsKhatian || null,
        LrKhatian: lrKhatian || null,
        PartyName: partyName || null,
        DeedNo: deedNoCriteria || null,
        DeedYear: deedYearCriteria ? Number(deedYearCriteria) : null,
        SearchOutcome: "Pending",
        OfficialReceiptRef: null,
        ReceiptAmount: null,
        SearchNotes: searchNotes || null,
        Status: "Search Pending",
        Candidates: [],
      };

      setActiveSearch(createdItem);
      setCandidates([]);

      // Pre-fill Step 3 form values from search criteria
      setDeedRsDag(rsDag);
      setDeedLrDag(lrDag);
      setDeedRsKhatian(rsKhatian);
      setDeedLrKhatian(lrKhatian);
      if (deedNoCriteria) setDeedNo(deedNoCriteria);
      if (deedYearCriteria) setDeedYear(deedYearCriteria);

      // Open sidecar portal embedded on the right (NO new tab!)
      handleOpenSidePortal(verifiedUrl, selectedOfficeObj?.label);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveOutcomeMutation = useMutation({
    mutationFn: (payload: { searchId: number; data: any }) => recordSearchOutcome(payload.searchId, payload.data),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-searches"] });
      if (searchOutcome === "Deed Found" || searchOutcome === "Multiple Matches") {
        setShowDeedUploadForm(true);
      } else {
        setActiveSearch(null);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createDeedMutation = useMutation({
    mutationFn: createLegalDeed,
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-deeds"] });
      navigate(`/legal/deeds/${res.deedRecordId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleStartSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!officeId) return toast.error("Please select a Deed Registration Office");
    startSearchMutation.mutate({
      PlannedSearchDate: searchDate,
      OfficeId: Number(officeId),
      PortalLinkId: mappedPortalLink?.LinkId || null,
      AssignedUserId: assignedUserId ? Number(assignedUserId) : null,
      MouzaId: mouzaId ? Number(mouzaId) : null,
      PlotNo: rsDag || null,
      KhatianNo: rsKhatian || null,
      RsDag: rsDag || null,
      LrDag: lrDag || null,
      RsKhatian: rsKhatian || null,
      LrKhatian: lrKhatian || null,
      PartyName: partyName || null,
      DeedNo: deedNoCriteria || null,
      DeedYear: deedYearCriteria ? Number(deedYearCriteria) : null,
      SearchNotes: searchNotes || null,
    });
  };

  const handleRecordOutcome = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSearch) return;
    saveOutcomeMutation.mutate({
      searchId: activeSearch.SearchId,
      data: {
        ActualSearchDate: outcomeDate,
        SearchOutcome: searchOutcome,
        OfficialReceiptRef: receiptRef || null,
        ReceiptAmount: receiptAmount ? Number(receiptAmount) : null,
        SearchNotes: outcomeNotes || null,
      },
    });
  };

  const handleAddCandidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateDeedNo) return toast.error("Please enter candidate deed number");
    const newCand: LegalCandidateItem = {
      CandidateId: candidates.length + 1,
      CandidateRef: `CAND-${String(candidates.length + 1).padStart(3, "0")}`,
      DeedNo: candidateDeedNo,
      DeedYear: Number(candidateDeedYear),
      OfficeId: activeSearch?.OfficeId,
      PartySummary: candidatePartySummary || null,
      PropertySummary: candidatePropertySummary || `RS Dag: ${rsDag || "-"}, LR Dag: ${lrDag || "-"}, RS Khatian: ${rsKhatian || "-"}, LR Khatian: ${lrKhatian || "-"}`,
      VerificationStatus: "Unverified",
      VerificationNotes: null,
    };
    setCandidates([...candidates, newCand]);
    setCandidateDeedNo("");
    setShowAddCandidate(false);
    toast.success("Candidate match added. Please review and verify.");
  };

  const handleVerifyCandidate = (candId: number, status: "Verified" | "Rejected") => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.CandidateId === candId
          ? {
              ...c,
              VerificationStatus: status,
              VerifiedByName: "Sumit Achar",
              VerifiedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
            }
          : c
      )
    );
    toast.success(`Candidate marked as ${status}`);
  };

  const handleSelectCandidateForDossier = (cand: LegalCandidateItem) => {
    setDeedNo(cand.DeedNo);
    setDeedYear(String(cand.DeedYear));
    setShowDeedUploadForm(true);
    toast.info(`Pre-filled deed form with candidate ${cand.DeedNo}`);
  };

  const handleCreateDeedFromSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deedTypeId) return toast.error("Please choose a Deed Type");
    createDeedMutation.mutate({
      DeedNo: deedNo || null,
      DeedYear: deedYear ? Number(deedYear) : null,
      DeedTypeId: Number(deedTypeId),
      OfficeId: activeSearch?.OfficeId,
      SearchId: activeSearch?.SearchId,
      ProjectId: projectId ? Number(projectId) : null,
      MouzaId: activeSearch?.MouzaId,
      RsDag: deedRsDag || null,
      LrDag: deedLrDag || null,
      RsKhatian: deedRsKhatian || null,
      LrKhatian: deedLrKhatian || null,
      RsPlotNo: deedRsDag || null,
      RsKhatianNo: deedRsKhatian || null,
      PurchasedArea: area ? Number(area) : null,
      AreaUnitId: areaUnitId ? Number(areaUnitId) : null,
      SellerPartyId: sellerId ? Number(sellerId) : null,
      BuyerPartyId: buyerId ? Number(buyerId) : null,
      ConsiderationAmount: consideration ? Number(consideration) : null,
      MarketValue: marketValue ? Number(marketValue) : null,
      StampDutyAmount: stampDuty ? Number(stampDuty) : null,
      PlotDescription: `RS Dag: ${deedRsDag || "-"}, LR Dag: ${deedLrDag || "-"}, RS Khatian: ${deedRsKhatian || "-"}, LR Khatian: ${deedLrKhatian || "-"}`,
    });
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Registration Search" }]} />
      <LegalShell
        title="Official Registration Search & Deed Capture"
        subtitle="1. Select date & office → 2. Open official portal on right side → 3. If deed is found, fill up & upload details directly."
        icon={SearchStatus}
        action={
          portalOpen ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPortalOpen(false)}
              className="gap-1.5 text-xs font-semibold"
            >
              Close Portal Pane
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenSidePortal()}
              className="gap-1.5 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/5"
            >
              <Globe size={14} /> Open IGR Portal Workspace
            </Button>
          )
        }
      >
        {/* Split Screen Container: Left (ERP Forms) & Right (Embedded Portal) */}
        <div className="flex flex-col lg:flex-row items-start gap-6 w-full">
          {/* LEFT COLUMN: Operations, Candidates, Outcome, and Fast Deed Creation */}
          <div
            className={`space-y-6 transition-all duration-200 ${
              portalOpen
                ? portalExpanded
                  ? "hidden"
                  : "w-full lg:w-1/2 xl:w-7/12"
                : "w-full"
            }`}
          >
            {/* STEP 1: Main Search & Open Portal Panel */}
            <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-sm space-y-5">
              <div className="border-b border-border/60 pb-3 flex items-center justify-between">
                <div>
                  <span className="text-[0.6875rem] font-heading uppercase text-primary font-bold tracking-wider">
                    Step 1 — Search Planning & Workspace
                  </span>
                  <h2 className="text-base font-heading font-semibold text-foreground mt-0.5">
                    Select Registration Date & Office
                  </h2>
                </div>
                {portalOpen && (
                  <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold uppercase tracking-wide">
                    Sidecar Active
                  </span>
                )}
              </div>

              <form onSubmit={handleStartSearch} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs font-semibold">Registration / Search Date *</Label>
                    <Input
                      type="date"
                      value={searchDate}
                      onChange={(e) => setSearchDate(e.target.value)}
                      required
                      className="mt-1 h-9 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-semibold">Deed Registration Office *</Label>
                    <select
                      className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                      value={officeId}
                      onChange={(e) => {
                        setOfficeId(e.target.value);
                        const sel = offices.find((o) => String(o.value) === String(e.target.value));
                        if (sel && portalOpen) {
                          setPortalOfficeTitle(sel.label);
                        }
                      }}
                      required
                    >
                      <option value="">Select Registration Office</option>
                      {offices.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold">Assigned Executive / Staff</Label>
                    <select
                      className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                      value={assignedUserId}
                      onChange={(e) => setAssignedUserId(e.target.value)}
                    >
                      <option value="">Select Staff</option>
                      {users.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Portal Preview Link Banner */}
                {officeId && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[0.625rem] font-heading uppercase tracking-wider text-primary font-semibold block">
                        Government Portal for Selected Office
                      </span>
                      <span className="text-xs font-semibold text-foreground truncate block">
                        {selectedOfficeObj?.label}
                      </span>
                      <span className="text-[0.6875rem] text-muted-foreground font-mono truncate block">
                        {verifiedUrl}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleOpenSidePortal(verifiedUrl, selectedOfficeObj?.label)}
                      className="h-8 text-xs font-semibold gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Globe size={13} /> {portalOpen ? "Switch Portal Workspace" : "Open Portal Side-by-Side"}
                    </Button>
                  </div>
                )}

                {/* Optional Search Target Identifiers with Distinct RS & LR Fields */}
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Search Parameters (West Bengal Land Identifiers)
                    </span>
                    <span className="text-[0.6875rem] text-muted-foreground">
                      Distinct RS & LR Fields
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-[0.6875rem]">Mouza (Village)</Label>
                      <select
                        className="w-full mt-1 h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs"
                        value={mouzaId}
                        onChange={(e) => setMouzaId(e.target.value)}
                      >
                        <option value="">Select Mouza</option>
                        {mouzas.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <Label className="text-[0.6875rem] font-semibold text-primary">RS Dag (Plot) No.</Label>
                      <Input
                        value={rsDag}
                        onChange={(e) => setRsDag(e.target.value)}
                        placeholder="e.g. 412 or 415/782"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                        LR Dag (Plot) No.
                      </Label>
                      <Input
                        value={lrDag}
                        onChange={(e) => setLrDag(e.target.value)}
                        placeholder="e.g. 412"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.6875rem]">Party / Vendor Name</Label>
                      <Input
                        value={partyName}
                        onChange={(e) => setPartyName(e.target.value)}
                        placeholder="e.g. Bimal Mondal"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                    <div>
                      <Label className="text-[0.6875rem] font-semibold text-primary">RS Khatian No.</Label>
                      <Input
                        value={rsKhatian}
                        onChange={(e) => setRsKhatian(e.target.value)}
                        placeholder="e.g. 245"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                        LR Khatian No.
                      </Label>
                      <Input
                        value={lrKhatian}
                        onChange={(e) => setLrKhatian(e.target.value)}
                        placeholder="e.g. 520"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.6875rem]">Deed No. (if known)</Label>
                      <Input
                        value={deedNoCriteria}
                        onChange={(e) => setDeedNoCriteria(e.target.value)}
                        placeholder="e.g. I-04128"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.6875rem]">Deed Year</Label>
                      <Input
                        type="number"
                        value={deedYearCriteria}
                        onChange={(e) => setDeedYearCriteria(e.target.value)}
                        placeholder="e.g. 2026"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <p className="text-[0.6875rem] text-muted-foreground max-w-sm">
                    Opens official government portal directly in the right workspace without leaving this page.
                  </p>
                  <Button
                    type="submit"
                    size="default"
                    disabled={startSearchMutation.isPending}
                    className="gap-2 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    <Globe size={15} /> Launch Portal Workspace & Begin Search
                  </Button>
                </div>
              </form>
            </div>

            {/* STEP 2: Active Search Outcome & Candidate Matches */}
            {activeSearch && !showDeedUploadForm && (
              <div className="rounded-2xl border-2 border-primary/40 bg-card p-5 sm:p-6 shadow-md space-y-5 animate-in fade-in duration-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div>
                    <span className="text-[0.6875rem] font-heading uppercase text-primary font-bold tracking-wider">
                      Step 2 — Search In Progress & Outcome
                    </span>
                    <h3 className="text-base font-heading font-semibold text-foreground">
                      Session: {activeSearch.SearchNumber} ({activeSearch.OfficeName})
                    </h3>
                  </div>
                  {!portalOpen && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenSidePortal(activeSearch.PortalUrl || verifiedUrl, activeSearch.OfficeName)}
                      className="gap-1.5 text-xs font-semibold text-primary"
                    >
                      <Globe size={13} /> Re-Open Portal Sidecar
                    </Button>
                  )}
                </div>

                {/* Candidate Matches Section */}
                <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-foreground">
                        Candidate Deed Matches ({candidates.length})
                      </h4>
                      <p className="text-[0.6875rem] text-muted-foreground">
                        Found deeds on portal? Add them here for human match verification before creating the dossier.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddCandidate(!showAddCandidate)}
                      className="h-7 text-xs gap-1"
                    >
                      + Add Match Candidate
                    </Button>
                  </div>

                  {/* Add Candidate Sub-Form */}
                  {showAddCandidate && (
                    <form onSubmit={handleAddCandidate} className="rounded-lg border border-primary/20 bg-background p-3 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-[0.6875rem]">Deed Number *</Label>
                          <Input
                            value={candidateDeedNo}
                            onChange={(e) => setCandidateDeedNo(e.target.value)}
                            placeholder="e.g. I-05891/2026"
                            className="mt-1 h-8 text-xs font-medium"
                            required
                          />
                        </div>
                        <div>
                          <Label className="text-[0.6875rem]">Registration Year</Label>
                          <Input
                            type="number"
                            value={candidateDeedYear}
                            onChange={(e) => setCandidateDeedYear(e.target.value)}
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-[0.6875rem]">Parties Summary</Label>
                          <Input
                            value={candidatePartySummary}
                            onChange={(e) => setCandidatePartySummary(e.target.value)}
                            placeholder="Seller: Bimal Mondal, Buyer: Rajwada"
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-[0.6875rem]">Property Summary</Label>
                          <Input
                            value={candidatePropertySummary}
                            onChange={(e) => setCandidatePropertySummary(e.target.value)}
                            placeholder="RS Dag 412, LR Dag 412, Mouza Jagaddal"
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddCandidate(false)} className="h-7 text-xs">
                          Cancel
                        </Button>
                        <Button type="submit" size="sm" className="h-7 text-xs">
                          Save Candidate
                        </Button>
                      </div>
                    </form>
                  )}

                  {/* Candidates List */}
                  {candidates.length > 0 ? (
                    <div className="space-y-2">
                      {candidates.map((cand) => (
                        <div
                          key={cand.CandidateId}
                          className="rounded-lg border border-border/80 bg-background p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground text-sm">{cand.DeedNo}</span>
                              <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                Year: {cand.DeedYear}
                              </span>
                              <span
                                className={`text-[0.625rem] px-2 py-0.5 rounded-full font-medium ${
                                  cand.VerificationStatus === "Verified"
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : cand.VerificationStatus === "Rejected"
                                    ? "bg-red-500/10 text-red-600"
                                    : "bg-amber-500/10 text-amber-600"
                                }`}
                              >
                                {cand.VerificationStatus}
                              </span>
                            </div>
                            <div className="text-muted-foreground mt-1">
                              {cand.PartySummary && <div>{cand.PartySummary}</div>}
                              {cand.PropertySummary && <div className="text-[0.6875rem]">{cand.PropertySummary}</div>}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {cand.VerificationStatus === "Unverified" && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleVerifyCandidate(cand.CandidateId, "Verified")}
                                  className="h-7 px-2.5 text-xs text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                                >
                                  <Check size={12} className="mr-1" /> Verify Match
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleVerifyCandidate(cand.CandidateId, "Rejected")}
                                  className="h-7 px-2 text-xs text-red-600 border-red-500/30 hover:bg-red-500/10"
                                >
                                  <XCircle size={12} />
                                </Button>
                              </>
                            )}

                            {cand.VerificationStatus === "Verified" && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleSelectCandidateForDossier(cand)}
                                className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                              >
                                Create Deed Dossier <ArrowRight size={12} className="ml-1" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-3 text-xs text-muted-foreground">
                      No candidates recorded yet. If the deed is found on the portal, click "+ Add Match Candidate" or record the outcome below.
                    </div>
                  )}
                </div>

                {/* Outcome Form */}
                <form onSubmit={handleRecordOutcome} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs font-semibold">Actual Date of Search *</Label>
                      <Input
                        type="date"
                        value={outcomeDate}
                        onChange={(e) => setOutcomeDate(e.target.value)}
                        required
                        className="mt-1 h-9 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Search Status / Outcome *</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold text-primary"
                        value={searchOutcome}
                        onChange={(e) => setSearchOutcome(e.target.value)}
                        required
                      >
                        <option value="Deed Found">✅ Yes — Deed Found / Available</option>
                        <option value="Multiple Matches">📋 Multiple Candidate Matches</option>
                        <option value="Completed - Clean">✅ Completed — Clean (No Encumbrance)</option>
                        <option value="Encumbrance Found">⚠️ Encumbrance Found (Mortgage / Lien)</option>
                        <option value="Defect Found">❌ Defect in Title Chain</option>
                        <option value="Record Not Found">❌ Deed / Record Not Found</option>
                        <option value="Pending">⏳ Still Pending at Sub-Registrar</option>
                      </select>
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Official Receipt / Query Ref</Label>
                      <Input
                        value={receiptRef}
                        onChange={(e) => setReceiptRef(e.target.value)}
                        placeholder="e.g. 1902000045/2026"
                        className="mt-1 h-9 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Govt Search Fee Paid (₹)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={receiptAmount}
                        onChange={(e) => setReceiptAmount(e.target.value)}
                        placeholder="e.g. 350.00"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Search Notes / Volume & Page Info</Label>
                      <Input
                        value={outcomeNotes}
                        onChange={(e) => setOutcomeNotes(e.target.value)}
                        placeholder="e.g. Book I, Volume 14, Pages 10-25"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setActiveSearch(null)}>
                      Dismiss
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={saveOutcomeMutation.isPending}
                      className="gap-2 font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {searchOutcome === "Deed Found" || searchOutcome === "Multiple Matches" ? (
                        <>Continue to Deed Entry & Upload <ArrowRight size={14} /></>
                      ) : (
                        "Save Outcome"
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 3: If Deed is Found -> Immediate Deed Fill & Upload Form */}
            {showDeedUploadForm && activeSearch && (
              <div className="rounded-2xl border-2 border-emerald-500/40 bg-card p-5 sm:p-6 shadow-md space-y-5 animate-in fade-in duration-200">
                <div className="border-b border-border/60 pb-3 flex items-center justify-between">
                  <div>
                    <span className="text-[0.6875rem] font-heading uppercase text-emerald-600 font-bold tracking-wider">
                      Step 3 — Deed Found: Fill & Upload Deed Details
                    </span>
                    <h3 className="text-base font-heading font-semibold text-foreground">
                      Create Deed Dossier (Linked to Search: {activeSearch.SearchNumber})
                    </h3>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                    {activeSearch.OfficeName}
                  </span>
                </div>

                <form onSubmit={handleCreateDeedFromSearch} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs font-semibold">Registered Deed No. *</Label>
                      <Input
                        value={deedNo}
                        onChange={(e) => setDeedNo(e.target.value)}
                        placeholder="e.g. I-04128/2026"
                        required
                        className="mt-1 h-9 text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Registration Year *</Label>
                      <Input
                        type="number"
                        value={deedYear}
                        onChange={(e) => setDeedYear(e.target.value)}
                        required
                        className="mt-1 h-9 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Deed Classification / Type *</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                        value={deedTypeId}
                        onChange={(e) => setDeedTypeId(e.target.value)}
                        required
                      >
                        <option value="">Select Deed Type</option>
                        {deedTypes.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs font-semibold">Link to Project</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                      >
                        <option value="">Select Project</option>
                        {projects.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Seller (Vendor)</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                        value={sellerId}
                        onChange={(e) => setSellerId(e.target.value)}
                      >
                        <option value="">Select Seller</option>
                        {parties.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Buyer (Company / Entity)</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                        value={buyerId}
                        onChange={(e) => setBuyerId(e.target.value)}
                      >
                        <option value="">Select Buyer</option>
                        {parties.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Distinct RS & LR Land Identifiers */}
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                    <span className="text-xs font-semibold text-foreground block">
                      Land Parcel Identifiers (West Bengal RS & LR Hierarchy)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-[0.6875rem] font-semibold text-primary">RS Dag (Plot)</Label>
                        <Input
                          value={deedRsDag}
                          onChange={(e) => setDeedRsDag(e.target.value)}
                          placeholder="e.g. 412"
                          className="mt-1 h-8 text-xs bg-background"
                        />
                      </div>
                      <div>
                        <Label className="text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                          LR Dag (Plot)
                        </Label>
                        <Input
                          value={deedLrDag}
                          onChange={(e) => setDeedLrDag(e.target.value)}
                          placeholder="e.g. 412"
                          className="mt-1 h-8 text-xs bg-background"
                        />
                      </div>
                      <div>
                        <Label className="text-[0.6875rem] font-semibold text-primary">RS Khatian</Label>
                        <Input
                          value={deedRsKhatian}
                          onChange={(e) => setDeedRsKhatian(e.target.value)}
                          placeholder="e.g. 245"
                          className="mt-1 h-8 text-xs bg-background"
                        />
                      </div>
                      <div>
                        <Label className="text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                          LR Khatian
                        </Label>
                        <Input
                          value={deedLrKhatian}
                          onChange={(e) => setDeedLrKhatian(e.target.value)}
                          placeholder="e.g. 520"
                          className="mt-1 h-8 text-xs bg-background"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs font-semibold">Purchased Area</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        placeholder="e.g. 18.5"
                        className="mt-1 h-9 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Area Unit</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                        value={areaUnitId}
                        onChange={(e) => setAreaUnitId(e.target.value)}
                      >
                        <option value="">Select Unit</option>
                        {areaUnits.map((u) => (
                          <option key={u.value} value={u.value}>{u.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Consideration Amount (₹)</Label>
                      <Input
                        type="number"
                        value={consideration}
                        onChange={(e) => setConsideration(e.target.value)}
                        placeholder="Total deed consideration"
                        className="mt-1 h-9 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Assessed Market Value (₹)</Label>
                      <Input
                        type="number"
                        value={marketValue}
                        onChange={(e) => setMarketValue(e.target.value)}
                        placeholder="IGR WB Market Value"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Stamp Duty Amount Paid (₹)</Label>
                      <Input
                        type="number"
                        value={stampDuty}
                        onChange={(e) => setStampDuty(e.target.value)}
                        placeholder="e.g. 480000"
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/60">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowDeedUploadForm(false);
                        setActiveSearch(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={createDeedMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-semibold"
                    >
                      <FilePlus size={15} /> Save Deed & Open Document Upload Dossier
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* Search History Records */}
            <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
              <div className="p-4 border-b border-border/60 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground">Recent Portal Search History</h3>
                  <p className="text-[0.6875rem] text-muted-foreground">Log of employee government registration searches</p>
                </div>
                <span className="text-xs text-muted-foreground">{searches.length} recorded</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3.5 py-2.5">Search Ref</th>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Office</th>
                      <th className="px-3.5 py-2.5">RS & LR Dag / Khatian</th>
                      <th className="px-3.5 py-2.5">Outcome</th>
                      <th className="px-3.5 py-2.5 text-right">Portal Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 text-xs">
                    {searches.map((s) => (
                      <tr key={s.SearchId} className="hover:bg-muted/30">
                        <td className="px-3.5 py-2.5 font-semibold text-foreground">{s.SearchNumber}</td>
                        <td className="px-3.5 py-2.5">
                          {new Date(s.PlannedSearchDate).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="px-3.5 py-2.5 font-medium text-foreground">{s.OfficeName}</td>
                        <td className="px-3.5 py-2.5 text-muted-foreground">
                          {s.MouzaName ? `${s.MouzaName} | ` : ""}
                          <span className="text-primary font-medium">RS Dag: {s.RsDag || s.PlotNo || "—"}</span>
                          {s.LrDag && <span className="text-blue-600 dark:text-blue-400 font-medium"> | LR Dag: {s.LrDag}</span>}
                          {s.PartyName ? ` | ${s.PartyName}` : ""}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-medium ${
                              s.SearchOutcome.includes("Found") || s.SearchOutcome.includes("Clean")
                                ? "bg-emerald-500/10 text-emerald-600"
                                : s.SearchOutcome.includes("Pending")
                                ? "bg-amber-500/10 text-amber-600"
                                : "bg-red-500/10 text-red-600"
                            }`}
                          >
                            {s.SearchOutcome}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenSidePortal(s.PortalUrl || verifiedUrl, s.OfficeName)}
                            className="h-7 px-2 text-xs text-primary hover:text-primary/90 font-semibold gap-1"
                          >
                            <Globe size={12} /> Open in Side Panel
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Official Government Registration Portal Sidecar */}
          {portalOpen && (
            <div
              className={`transition-all duration-200 sticky top-4 ${
                portalExpanded ? "w-full" : "w-full lg:w-1/2 xl:w-5/12"
              }`}
            >
              <LegalPortalPane
                url={portalUrl}
                officeName={portalOfficeTitle}
                onClose={() => setPortalOpen(false)}
                isExpanded={portalExpanded}
                onToggleExpand={() => setPortalExpanded(!portalExpanded)}
              />
            </div>
          )}
        </div>
      </LegalShell>
    </>
  );
}

// RN client for the Customer Portal (backend/routes/crmPortal.js) — the same routes and shapes the web portal
// uses (src/pages/CrmCustomerPortal/portalApi.ts). The token is the customer's own portal token; every route
// after /applications takes ?applicationId= and the server checks it belongs to this customer.
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { fileBase64, fileForm, type PickedFile } from "@/utils/documents";

const API = "/api/crm-portal";
/** This customer's phone, for their notifications (notifications/pushNotifications.ts). */
export const CUSTOMER_PUSH = `${API}/push-devices`;

/** An API refusal, with its HTTP status (queryClient.ts never retries a 429: asking again only makes it worse). */
export class PortalError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(`${API}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PortalError((body as { error?: string }).error || "Could not load", res.status);
  return body as T;
}

async function send<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetchWithAuth(`${API}${path}`, { method, body: form ? (body as FormData) : JSON.stringify(body ?? {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new PortalError((out as { error?: string }).error || "Could not save", res.status);
  return out as T;
}

const withApp = (path: string, appId: number) => `${path}${path.includes("?") ? "&" : "?"}applicationId=${appId}`;

export interface PortalMe { Id: number; CustomerNo: string | null; Name: string; Mobile: string | null; Email: string | null; Address: string | null; City: string | null; State: string | null }

export interface PortalApplication {
  ApplicationId: number; ApplicationNo: string; ApplicantName: string; ApplicationStatus: string; IsCoApplicant: 0 | 1;
  InterestedProject: string | null; BookingId: number | null; BookingNo: string | null; UnitNo: string | null; ProjectName: string | null;
  BookingStatus: string | null; GrandTotal: number | null; BookingDate: string | null;
  AgreementStatus: string | null; CustomerApprovalStatus: string | null; SalesDeedStatus: string | null; HandoverStatus: string | null;
  CoApplicantNames: string | null;
  /** Home = live booking · InProgress = application still with the sales team · Past = ended (server: crmPortal.js propertyState). */
  Lifecycle: "Home" | "InProgress" | "Past";
  /** How it ended / where it stands, in the customer's words ("Cancelled", "Sold", "Being prepared"); null for a Home. */
  StateLabel: string | null;
}

/** One property's whole money picture (server: crmPortal.js GET /money) — every figure from the staff side's own sources. */
export interface MoneyStatement {
  booking: { BookingNo: string; Status: string; IsPlotSale: boolean; Closed: boolean } | null;
  price: {
    /** Add up to `total` exactly. key: home | homeGst | parking | extra | creditNotes | other. */
    lines: { key: "home" | "homeGst" | "parking" | "extra" | "creditNotes" | "other"; label?: string | null; quantity?: number; amount: number; gst?: number | null;
      /** The line in the customer's words (server-built, same as the web portal). */
      title: string; note: string | null;
      /** A multi-plot sale: each plot's share of the price (adds up to the line). */
      parts?: { title: string; note: string | null; amount: number }[] }[];
    total: number;
    gstIncluded: number;
  };
  plan: {
    instalments: { no: number; name: string; due: number; dueDate: string | null; demanded: boolean; waived: boolean;
      settled: number; held: number; verifying: number; stage: "Adjusted" | "Verified" | "InVerification" | "Recorded" | "Waived" | null }[];
    total: number;
    waived: number;
  };
  payments: { date: string | null; mode: string | null; ref: string | null; amount: number;
    stage: "settled" | "held" | "split" | "finance" | "recorded" | "returned" | "bounced" | "out" | "unitChange" | "adjustment";
    receiptNo: string | null; receiptId: number | null; settled: number; held: number; refunded: number; movedOut: number; note: string | null;
    /** How they paid, from their Money Receipt, and the instalment it was paid against. */
    chequeNo: string | null; chequeDate: string | null; bankName: string | null; txnRef: string | null; milestone: string | null;
    /** Those details, ready to show (server-built, same as the web portal). */
    details: { label: string; value: string }[];
    /** Its state in the customer's words (server-built, same as the web portal). */
    status: { label: string; sub: string | null } }[];
  totals: { paid: number; received: number; settled: number; held: number; verifying: number; refunded: number; movedOut: number; balance: number; extra: number;
    /** Paid beyond the total price (e.g. a credit note lowered it after the plan was paid). */
    overPrice: number };
}

/** One thing waiting on the customer — the server's single rule set (crmPortal.js needsYou), shared with the web portal. */
export interface NeedsYouItem {
  applicationId: number | null;
  kind: string;
  label: string;
  sub: string;
  target: "documents" | "payments" | "construction" | "transferDeed";
  urgent: boolean;
}

export interface Milestone { MilestoneNo: number; MilestoneName: string; DueDate: string | null; AmountDue: number; AmountPaid: number | null; Status: string;
  /** Paid (settled, or covered by verified money held On Account) — Status stays 'Pending' while money is held, so judge by this. */
  Covered: boolean;
  /** Paid, being verified by accounts. */
  Verifying: boolean;
  /** Genuinely still to pay on it. */
  Outstanding: number }

export interface Timeline {
  stage?: string;
  booking?: { Id: number; BookingNo: string; UnitNo: string | null; ProjectName: string | null; TotalValue: number; BookingAmount: number | null;
    BookingStatus: string; BookingDate: string | null; TokenType: string | null; TokenValue: number | null; ParkingTotal: number | null; ExtraChargesTotal: number | null; GrandTotal: number | null; IsPlotSale: boolean;
    /** The home as Unit Master records it. */
    UnitType: string | null; UnitKind: string | null; FloorNo: number | string | null; AreaSqFt: number | null; CarpetAreaSqFt: number | null;
    BuiltUpAreaSqFt: number | null; SuperBuiltUpAreaSqFt: number | null; OpenTerraceAreaSqFt: number | null; Facing: string | null; BlockName: string | null;
    /** The staff member looking after the booking (name only). */
    LookedAfterBy: string | null };
  /** The purchase, step by step (server-built: crmPortal.js customerJourney — the CRM's own rules), same as the web. */
  journey?: { key: string; label: string; hint: string; done: boolean; at: string | null; state: "done" | "current" | "upcoming" }[];
  /** The project, ready to show (server-built: crmPortal.js projectView) — same as the web portal. */
  project?: { name: string; facts: { label: string; value: string }[]; description: string | null;
    location: { lat: number; lng: number } | null; mapQuery: string | null } | null;
  /** What the home is, ready to show (server-built: crmPortal.js homeFacts). */
  homeFacts?: { label: string; value: string }[];
  /** Every plot on a plot sale, with its ready-to-show facts. */
  plots?: { PlotNo: string | null; PlotName: string | null; AreaSqFt: number | null; IsPrimary: boolean; facts: { label: string; value: string }[] }[];
  /** Snags found at the handover inspection. */
  snags?: { Id: number; Category: string | null; Description: string; Status: string; ResolvedAt: string | null; CreatedAt: string; IsOpen: boolean }[];
  /** Site photos of their own unit and shared work on their tower / project, newest first (file: pdfPath.sitePhoto). */
  sitePhotos?: { id: number; at: string; day: string | null; work: string; activity: string; room: string | null; note: string | null; ownUnit: boolean }[];
  /** Notes the site team writes for buyers of this project, newest first. */
  siteNotes?: { Id: number; UpdateDate: string; PercentComplete: number | null; Stage: string | null; Summary: string }[];
  welcomeCall?: { Outcome: string | null; CallDate: string | null } | null;
  customerDetails?: { IsComplete: boolean } | null;
  agreement?: { Id: number; AgreementNo: string | null; Status: string; CustomerApprovalStatus: string | null; SentToCustomerAt: string | null;
    AgreementDate: string | null; ProposedDate: string | null; DocumentsNeedingAction: number; LastRecheckRemarks: string | null;
    AfsRegistrationNo: string | null; AfsRegistrationDate: string | null } | null;
  paymentMilestones?: Milestone[];
  onAccountTotalReceived?: number;
  salesDeed?: { DeedNo: string | null; Status: string; DeedValue: number | null; DeedDate: string | null; SubRegistrarOffice: string | null;
    CustomerApprovalStatus: string | null; SentToCustomerAt: string | null; RegistrationNo: string | null; RegistrationDate: string | null } | null;
  handover?: { Status: string; ScheduledDate: string | null; ActualHandoverDate: string | null } | null;
  possessionNotice?: { Id: number; NoticeNo: string; Status: string; OfferedDate: string | null; ResponseDeadline: string | null;
    AcknowledgedAt: string | null; DisputedAt: string | null; DisputeReason: string | null } | null;
  // The booked unit's own DPR progress (crmConstructionUpdates.js unitProgress); until the site records the unit,
  // its tower's, then the whole project's. Null when the project has no DPR.
  constructionProgress?: {
    scope: "unit" | "tower" | "project";
    towerName: string | null;
    unit: { pct: number; works: { name: string; pct: number }[]; now: { name: string; pct: number }[]; next: string | null; allDone: boolean } | null;
    feed: { work: string; activity: string; room: string | null; from: number | null; to: number | null; completed: boolean; at: string }[];
  } | null;
  legalDocumentation?: { status: string } | null;
  prePossession?: { status: string; scheduledDate: string | null; completedDate: string | null;
    checks: { duesCleared: boolean; documentation: boolean; quality: boolean; utilities: boolean } } | null;
  holds?: { Id: number; EntityType: string; HoldUntil: string; Reason: string | null; UnitName: string | null; SlotNo: string | null }[];
  queryPayment?: { QPNo: string; Status: string; StampDuty: number | null; RegistrationFee: number | null; RequiredAmount: number | null; ConfirmedAt: string | null } | null;
  registry?: { RegNo: string | null; Status: string; ScheduledDate: string | null; CompletedDate: string | null } | null;
  nocStatus?: { total: number; issued: number; items: { type: string; status: string; nocNo: string | null }[] };
}

/** Money stages that mean an instalment needs nothing more from the customer: paid, covered, or being verified. */
const NOTHING_TO_PAY = ["Adjusted", "Verified", "InVerification", "Recorded"];

/** The headline money figures every screen shows (Home, Payments, Profile, My bookings), from one money statement —
 *  so no two screens can disagree. A closed booking (cancelled, sold…) owes nothing: "paid" is all that was received.
 *  Same rule as the web portal's moneyFigures (portalApi.ts). */
export function moneyView(m: MoneyStatement | null | undefined) {
  const t = m?.totals;
  const closed = !!m?.booking?.Closed;
  const total = m?.plan.total ?? 0;
  const paid = t ? (closed ? t.received : t.paid) : 0;
  const owedOn = (i: MoneyStatement["plan"]["instalments"][number]) => Math.max(0, Math.round((i.due - i.settled - i.held) * 100) / 100);
  // The next instalment genuinely still to pay — not waived, covered, or being verified.
  const next = closed ? undefined : m?.plan.instalments.find((i) => !i.waived && !NOTHING_TO_PAY.includes(i.stage || "") && owedOn(i) > 0);
  return {
    closed, total, paid,
    balance: closed ? 0 : t?.balance ?? 0,
    verifying: t?.verifying ?? 0,
    overPrice: closed ? 0 : t?.overPrice ?? 0,
    pct: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
    next, nextAmount: next ? owedOn(next) : 0,
  };
}

/** The sale deed sent to the customer, with the papers on it (GET /sales-deed). */
export interface SalesDeedView {
  deed: { Id: number; DeedNo: string | null; DeedValue: number | null; StampDuty: number | null; RegistrationFee: number | null; StampDutyCredit: number | null;
    SubRegistrarOffice: string | null; DeedDate: string | null; Status: string; CustomerApprovalStatus: string | null; CustomerApprovedAt: string | null;
    CustomerRecheckRemarks: string | null } | null;
  documents: { Id: number; DocumentType: string; Label: string | null; FileName: string | null; FileSize: number | null; UploadedAt: string | null; VersionNo: number | null }[];
}

export interface Invoice { Id: number; InvoiceNo: string; InvoiceType: string; Amount: number; InvoiceDate: string | null; Description: string | null; Status: string }
export interface Receipt { Id: number; ReceiptNo: string; Amount: number; PaymentMode: string | null; ChequeNo: string | null; TransactionRef: string | null; ReceivedDate: string | null }
export interface Ticket { Id: number; TicketNo: string; Category: string; Priority: string; Subject: string; Description: string | null; Status: string; ResolvedAt: string | null; ResolutionNotes: string | null; CreatedAt: string;
  SlaDueDate: string | null; CustomerRating: number | null; CustomerFeedback: string | null }
export interface CreditNote { Id: number; DocNo: string; DocType: string; Status: string; DocDate: string | null; TotalAmount: number; BookingNo: string | null; Property: string | null; AgainstRef: string | null }

export interface Agreement {
  Id: number; AgreementNo: string | null; Status: string; AgreementDate: string | null; LegalName: string | null; LegalAddress: string | null;
  PanNo: string | null; AadhaarNo: string | null; VersionNo: number | null; SeniorApprovalStatus: string | null;
  CustomerApprovalStatus: string | null; CustomerApprovedAt: string | null; RecheckCount: number | null;
  ProposedDate: string | null; ProposedDateStatus: string | null; DateApprovalStatus: string | null; SentToCustomerAt: string | null;
  LastRecheckRemarks: string | null; BookingNo: string; UnitNo: string | null; ProjectName: string | null; TotalValue: number;
  /** Set once the agreement is registered (Status 'Registered'); signed = Status 'Executed' or 'Registered'. */
  AfsRegistrationNo: string | null; AfsRegistrationDate: string | null; AfsStampDuty: number | null; AfsRegistrationFee: number | null;
}
export interface AgreementDoc {
  Id: number; DocumentType: string; Label: string | null; IsMandatory: boolean; UploadedByType: string | null; FileName: string | null;
  FileSize: number | null; MimeType: string | null; Status: string; Remarks: string | null; VersionNo: number | null;
}
export interface QpAttachment { AttachmentId: number; DocType: "Info" | "Proof" | string; FileName: string; MimeType: string | null; FileSize: number | null; UploadedAt: string | null }
export interface ActivityItem { type: string; title: string; detail: string | null; at: string }

export interface DeedStep { key: string; label: string; ok: boolean; state: string }
export interface DeedView {
  role: "Seller" | "Buyer"; todo: number;
  /** What is waiting on this customer, in plain words (server-side, same rules as `todo`). */
  asks?: string[];
  deed: { Id: number; DeedNo: string; DeedType: string; Property: string; BookingNo: string; Status: string; StatusLabel: string; SellerName: string;
    BuyerName: string | null; VersionNo: number; MyApproval: string | null; MyDateAccepted: boolean; ProposedDate: string | null; ProposedBy: string | null;
    DateApprovalStatus: string | null; DeedDate: string | null; ExecutedAt: string | null };
  documents: { Id: number; DocumentType: string; Label: string; Party: string; Status: string; HasFile: boolean; Remarks: string | null }[];
  payment: { StampDuty: number; RegistrationFee: number; PayableBy: string; Status: string; PaidRef: string | null; ConfirmRemarks: string | null; IAmPayer: boolean } | null;
  registry: { Office: string; ScheduledAt: string; RegNo: string | null; Attendees: string | null } | null;
  steps: DeedStep[];
}

export interface MaintenanceBill {
  Id: number; BillNo: string; BillDate: string | null; DueDate: string | null; PeriodFrom: string | null; PeriodTo: string | null; Notes: string | null;
  Subtotal: number; TotalTax: number; GrandTotal: number; Status: string; UnitNo: string | null; BlockName: string | null; BookingNo: string | null;
  CompanyName: string | null; CompanyGstNo: string | null;
  items?: { Id: number; ChargeHeadName: string; HsnCode: string | null; Rate: number; TaxPct: number; TaxAmount: number; TotalAmount: number }[];
}
export interface ElectricityBill {
  Id: number; MeterNumber: string; ProviderName: string; BillingPeriodFrom: string | null; BillingPeriodTo: string | null; TotalUnits: number | null;
  PostHandoverUnits: number | null; EnergyCharge: number | null; FixedCharge: number | null; OtherCharge: number | null; TotalAmount: number;
  BillStatus: string; UnitNo: string | null; BookingNo: string | null;
}

// The categories a customer may raise — the server's list (crmPortal.js CUSTOMER_TICKET_CATEGORIES), as the web portal shows them.
export const TICKET_CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];

export const portal = {
  me: () => get<PortalMe>("/me"),
  applications: () => get<PortalApplication[]>("/applications"),
  timeline: (appId: number) => get<Timeline>(withApp("/timeline", appId)),
  invoices: (appId: number) => get<Invoice[]>(withApp("/invoices", appId)),
  receipts: (appId: number) => get<Receipt[]>(withApp("/receipts", appId)),
  tickets: (appId: number) => get<Ticket[]>(withApp("/tickets", appId)),
  reopenTicket: (appId: number, ticketId: number, reason: string) =>
    send<{ success: boolean }>(withApp(`/tickets/${ticketId}/reopen`, appId), { reason }, "PUT"),
  rateTicket: (appId: number, ticketId: number, rating: number, feedback: string) =>
    send<{ success: boolean }>(withApp(`/tickets/${ticketId}/feedback`, appId), { rating, feedback }, "PUT"),
  salesDeed: (appId: number) => get<SalesDeedView>(withApp("/sales-deed", appId)),
  raiseTicket: (appId: number, b: { category: string; subject: string; description?: string }) => send<{ success: boolean; id: number; TicketNo: string }>(withApp("/tickets", appId), b),
  creditNotes: () => get<CreditNote[]>("/gst-notes"),
  maintenanceBills: (appId: number) => get<MaintenanceBill[]>(withApp("/maintenance-bills", appId)),
  maintenanceBill: (appId: number, id: number) => get<MaintenanceBill>(withApp(`/maintenance-bills/${id}`, appId)),
  electricityBills: (appId: number) => get<ElectricityBill[]>(withApp("/electricity-bills", appId)),
  changePassword: (newPassword: string) => send<{ success: boolean }>("/change-password", { newPassword }),
  // Approve, or ask for a recheck (remarks required) — the agreement and the sale deed draft.
  respondAgreement: (appId: number, decision: "Approve" | "Recheck", remarks: string) =>
    send(withApp("/agreement/respond", appId), { decision, remarks }),
  respondSalesDeed: (appId: number, decision: "Approve" | "Recheck", remarks: string) =>
    send(withApp("/sales-deed/respond", appId), { decision, remarks }),
  agreement: (appId: number) => get<Agreement | null>(withApp("/agreement", appId)),
  agreementDocuments: (appId: number) => get<AgreementDoc[]>(withApp("/agreement/documents", appId)),
  uploadAgreementDoc: (appId: number, docId: number, f: PickedFile) => send(withApp(`/agreement/documents/${docId}/upload`, appId), fileForm(f)),
  proposeAgreementDate: (appId: number, proposedDate: string) => send(withApp("/agreement/propose-date", appId), { proposedDate }),
  acceptAgreementDate: (appId: number) => send(withApp("/agreement/date/accept", appId), {}),
  queryPaymentAttachments: (appId: number) => get<QpAttachment[]>(withApp("/query-payment/attachments", appId)),
  uploadQueryPaymentProof: async (appId: number, f: PickedFile) =>
    send(withApp("/query-payment/proof", appId), { fileName: f.name, mimeType: f.mimeType, base64: await fileBase64(f) }),
  activity: (appId: number) => get<ActivityItem[]>(withApp("/activity", appId)),
  /** Everything waiting on the customer across all their homes, or — with an id — on that one property. */
  money: (appId: number) => get<MoneyStatement>(withApp("/money", appId)),
  needsYou: (appId?: number) => get<{ items: NeedsYouItem[] }>(appId == null ? "/needs-you" : withApp("/needs-you", appId)).then((r) => r.items),
  transferDeeds: () => get<DeedView[]>("/transfer-deeds"),
  /** A step of a transfer deed the customer is party to (respond, date/propose, date/accept); returns the deed again. */
  deedAction: (deedId: number, path: string, body: unknown) => send<DeedView>(`/transfer-deeds/${deedId}/${path}`, body, "PUT"),
  /** Their paper for a transfer deed, or the stamp-duty challan (with its reference, amount and date). */
  deedUpload: (deedId: number, path: string, f: PickedFile, fields: Record<string, string> = {}) =>
    send<DeedView>(`/transfer-deeds/${deedId}/${path}`, fileForm(f, fields)),
  respondPossession: (appId: number, decision: "Acknowledge" | "Dispute", reason?: string) =>
    send(withApp("/possession-notice/respond", appId), { decision, reason }),
};

/** Server paths of the customer's PDFs (opened with utils/documents openDocument). */
export const pdfPath = {
  invoice: (appId: number, id: number) => withApp(`${API}/invoices/${id}/pdf`, appId),
  receipt: (appId: number, id: number) => withApp(`${API}/receipts/${id}/pdf`, appId),
  creditNote: (id: number) => `${API}/gst-notes/${id}/pdf`,
  possessionLetter: (appId: number, id: number) => withApp(`${API}/possession-notice/${id}/pdf`, appId),
  agreementDoc: (appId: number, id: number) => withApp(`${API}/agreement/documents/file/${id}`, appId),
  qpAttachment: (appId: number, id: number) => withApp(`${API}/query-payment/attachment/${id}/file`, appId),
  sitePhoto: (appId: number, id: number) => withApp(`${API}/site-photos/${id}`, appId),
  salesDeedDoc: (appId: number, id: number) => withApp(`${API}/sales-deed/documents/${id}/download`, appId),
  deedDoc: (deedId: number, docId: number) => `${API}/transfer-deeds/${deedId}/documents/${docId}/file`,
};

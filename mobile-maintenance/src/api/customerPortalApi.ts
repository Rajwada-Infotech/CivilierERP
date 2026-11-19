// RN client for the Customer Portal (backend/routes/crmPortal.js) — the same routes and shapes the web portal
// uses (src/pages/CrmCustomerPortal/portalApi.ts). The token is the customer's own portal token; every route
// after /applications takes ?applicationId= and the server checks it belongs to this customer.
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { fileBase64, fileForm, type PickedFile } from "@/utils/documents";

const API = "/api/crm-portal";
/** This customer's phone, for their notifications (notifications/pushNotifications.ts). */
export const CUSTOMER_PUSH = `${API}/push-devices`;

async function get<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(`${API}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Could not load");
  return body as T;
}

async function send<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetchWithAuth(`${API}${path}`, { method, body: form ? (body as FormData) : JSON.stringify(body ?? {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error || "Could not save");
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
    lines: { key: "home" | "homeGst" | "parking" | "extra" | "creditNotes" | "other"; label?: string | null; quantity?: number; amount: number; gst?: number | null }[];
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
    receiptNo: string | null; receiptId: number | null; settled: number; held: number; refunded: number; movedOut: number; note: string | null }[];
  totals: { paid: number; received: number; settled: number; held: number; verifying: number; refunded: number; movedOut: number; balance: number; extra: number };
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
    BookingStatus: string; BookingDate: string | null; TokenType: string | null; TokenValue: number | null; ParkingTotal: number | null; ExtraChargesTotal: number | null; GrandTotal: number | null; IsPlotSale: boolean };
  welcomeCall?: { Outcome: string | null; CallDate: string | null } | null;
  customerDetails?: { IsComplete: boolean } | null;
  agreement?: { Id: number; AgreementNo: string | null; Status: string; CustomerApprovalStatus: string | null; SentToCustomerAt: string | null;
    AgreementDate: string | null; ProposedDate: string | null; DocumentsNeedingAction: number; LastRecheckRemarks: string | null } | null;
  paymentMilestones?: Milestone[];
  onAccountTotalReceived?: number;
  salesDeed?: { DeedNo: string | null; Status: string; DeedValue: number | null; DeedDate: string | null; SubRegistrarOffice: string | null;
    CustomerApprovalStatus: string | null; SentToCustomerAt: string | null; RegistrationNo: string | null; RegistrationDate: string | null } | null;
  handover?: { Status: string; ScheduledDate: string | null; ActualHandoverDate: string | null } | null;
  possessionNotice?: { Id: number; NoticeNo: string; Status: string; OfferedDate: string | null; ResponseDeadline: string | null;
    AcknowledgedAt: string | null; DisputedAt: string | null; DisputeReason: string | null } | null;
  // Only the booked unit's own DPR progress (crmConstructionUpdates.js unitProgress); null when it has none.
  constructionProgress?: {
    scope: "unit";
    unit: { pct: number; works: { name: string; pct: number }[]; now: { name: string; pct: number }[]; next: string | null; allDone: boolean } | null;
    feed: { work: string; activity: string; room: string | null; from: number | null; to: number | null; completed: boolean; at: string }[];
  } | null;
  legalDocumentation?: { status: string } | null;
  prePossession?: { status: string; scheduledDate: string | null } | null;
  queryPayment?: { QPNo: string; Status: string; StampDuty: number | null; RegistrationFee: number | null; RequiredAmount: number | null; ConfirmedAt: string | null } | null;
  registry?: { RegNo: string | null; Status: string; ScheduledDate: string | null; CompletedDate: string | null } | null;
  nocStatus?: { total: number; issued: number; items: { type: string; status: string; nocNo: string | null }[] };
}

export interface Invoice { Id: number; InvoiceNo: string; InvoiceType: string; Amount: number; InvoiceDate: string | null; Description: string | null; Status: string }
export interface Receipt { Id: number; ReceiptNo: string; Amount: number; PaymentMode: string | null; ChequeNo: string | null; TransactionRef: string | null; ReceivedDate: string | null }
export interface Ticket { Id: number; TicketNo: string; Category: string; Priority: string; Subject: string; Description: string | null; Status: string; ResolvedAt: string | null; ResolutionNotes: string | null; CreatedAt: string }
export interface CreditNote { Id: number; DocNo: string; DocType: string; Status: string; DocDate: string | null; TotalAmount: number; BookingNo: string | null; Property: string | null; AgainstRef: string | null }

export interface Agreement {
  Id: number; AgreementNo: string | null; Status: string; AgreementDate: string | null; LegalName: string | null; LegalAddress: string | null;
  PanNo: string | null; AadhaarNo: string | null; VersionNo: number | null; SeniorApprovalStatus: string | null;
  CustomerApprovalStatus: string | null; CustomerApprovedAt: string | null; RecheckCount: number | null;
  ProposedDate: string | null; ProposedDateStatus: string | null; DateApprovalStatus: string | null; SentToCustomerAt: string | null;
  LastRecheckRemarks: string | null; BookingNo: string; UnitNo: string | null; ProjectName: string | null; TotalValue: number;
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
  deedDoc: (deedId: number, docId: number) => `${API}/transfer-deeds/${deedId}/documents/${docId}/file`,
};

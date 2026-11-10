import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import FinanceDashboardScreen from "@/screens/finance/FinanceDashboardScreen";
import PaymentListScreen from "@/screens/finance/PaymentListScreen";
import PaymentFormScreen from "@/screens/finance/PaymentFormScreen";
import type { PaymentRecord } from "@/api/newPaymentApi";
import type { ReissueContext } from "@/screens/finance/payment/PaymentFormModal";
import OnAccountAdjustmentScreen from "@/screens/finance/OnAccountAdjustmentScreen";
import ReceivedPaymentListScreen from "@/screens/finance/ReceivedPaymentListScreen";
import ReceivedPaymentFormScreen from "@/screens/finance/ReceivedPaymentFormScreen";
import type { ReceivedPayment } from "@/api/receivedPaymentApi";
import BrsScreen from "@/screens/finance/BrsScreen";
import InvoiceScreen from "@/screens/finance/InvoiceScreen";
import InvoicePreviewScreen from "@/screens/finance/InvoicePreviewScreen";
import MaterialDashboardScreen from "@/screens/material/MaterialDashboardScreen";
import VehicleInOutListScreen from "@/screens/material/VehicleInOutListScreen";
import PurchaseOrderListScreen from "@/screens/material/PurchaseOrderListScreen";
import GRNListScreen from "@/screens/material/GRNListScreen";
import MaterialRequestListScreen from "@/screens/material/MaterialRequestListScreen";
import MaterialIssuesListScreen from "@/screens/material/MaterialIssuesListScreen";
import MaterialIssueReturnListScreen from "@/screens/material/MaterialIssueReturnListScreen";
import ShortCloseScreen from "@/screens/material/ShortCloseScreen";
import L1ChartScreen from "@/screens/material/L1ChartScreen";
import StockScreen from "@/screens/material/StockScreen";
import StockLedgerScreen from "@/screens/material/StockLedgerScreen";
import StockTransferListScreen from "@/screens/material/StockTransferListScreen";
import DebitNoteListScreen from "@/screens/material/DebitNoteListScreen";
import type { QTPOPrefill } from "@/api/purchaseOrdersApi";
import ContractListScreen from "@/screens/finance/ContractListScreen";
import ContractDetailScreen from "@/screens/finance/ContractDetailScreen";
import NewContractScreen from "@/screens/finance/NewContractScreen";
import JournalVoucherScreen from "@/screens/finance/JournalVoucherScreen";
import JournalVoucherFormScreen from "@/screens/finance/JournalVoucherFormScreen";
import TrialBalanceScreen from "@/screens/finance/TrialBalanceScreen";
import MaterialRequestFormScreen from "@/screens/material/MaterialRequestFormScreen";
import PurchaseOrderFormScreen from "@/screens/material/PurchaseOrderFormScreen";
import VehicleInOutFormScreen from "@/screens/material/VehicleInOutFormScreen";
import GRNFormScreen from "@/screens/material/GRNFormScreen";
import MaterialIssueFormScreen from "@/screens/material/MaterialIssueFormScreen";
import IssueReturnFormScreen from "@/screens/material/IssueReturnFormScreen";
import StockTransferFormScreen from "@/screens/material/StockTransferFormScreen";
import DebitNoteFormScreen from "@/screens/material/DebitNoteFormScreen";
import QuotationListScreen from "@/screens/material/QuotationListScreen";
import QuotationFormScreen from "@/screens/material/QuotationFormScreen";
import BalanceSheetScreen from "@/screens/finance/BalanceSheetScreen";
import ProfitLossScreen from "@/screens/finance/ProfitLossScreen";
import BalanceEnquiryScreen from "@/screens/finance/BalanceEnquiryScreen";
import NewInvoiceScreen from "@/screens/finance/NewInvoiceScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
  FinanceDashboard: undefined;
  // openForm: true jumps straight into the New Payment form on mount —
  // used by FinanceDashboardScreen's "New Payment" quick action. reissue
  // is set by BrsScreen's "Re-issue" action on a bounced entry, mirroring
  // web's navigate("/payments", { state: { reissue } }).
  Payment: {
    openForm?: boolean;
    reissue?: {
      replacesPaymentId: number;
      replacesDocNo: string;
      amount: number;
      paymentName: string;
      companyName: string;
      bounceReason?: string | null;
    };
  } | undefined;
  /** The payment form as its own page: nothing for a new payment, `record` to edit one, `reissue` to re-issue a bounced one. */
  PaymentForm: { record?: PaymentRecord; reissue?: ReissueContext } | undefined;
  OnAccountAdjustment: undefined;
  ReceivedPayment: { openForm?: boolean } | undefined;
  /** The received-payment form as its own page: nothing for a new receipt, `record` to edit one. */
  ReceivedPaymentForm: { record?: ReceivedPayment } | undefined;
  Brs: undefined;
  Invoice: undefined;
  InvoicePreview: { id: string };
  MaterialDashboard: undefined;
  VehicleInOut: undefined;
  // qtPrefill is set by L1ChartScreen's "Create Purchase Order" award action
  // (mirrors web's navigate("/material/purchase-order", { state: { qtPrefill } }))
  // — PurchaseOrderListScreen auto-opens the create form with it prefilled.
  PurchaseOrder: { qtPrefill?: QTPOPrefill } | undefined;
  GRN: undefined;
  MaterialRequest: undefined;
  MaterialIssues: undefined;
  MaterialIssueReturn: undefined;
  ShortClose: undefined;
  L1Chart: undefined;
  Stock: undefined;
  // Mobile-only ledger drill-down (web never wired up its own ledger API) —
  // reached from StockScreen either scoped to one item or a whole godown.
  StockLedger: {
    itemId?: string;
    itemName?: string;
    godownId?: number;
    godownName?: string;
    dateFrom?: string;
    dateTo?: string;
  } | undefined;
  StockTransfer: undefined;
  DebitNote: undefined;
  Contract: undefined;
  ContractDetail: { id: number };
  NewContract: { id?: number } | undefined;
  JournalVoucher: undefined;
  /** The journal voucher form as its own page: nothing for a new voucher, `id` to edit one. */
  JournalVoucherForm: { id?: number } | undefined;
  TrialBalance: undefined;
  BalanceSheet: undefined;
  Quotation: undefined;
  /** The quotation (RFQ) form as its own page: nothing for a new one, `id` to edit a draft. */
  QuotationForm: { id?: number } | undefined;
  /** The debit note form as its own page: nothing for a new note, `id` to edit one. */
  DebitNoteForm: { id?: number } | undefined;
  /** The stock transfer form as its own page (create only: a transfer executes at once). */
  StockTransferForm: undefined;
  /** The issue return form as its own page: nothing for a new return, `id` to edit one. */
  IssueReturnForm: { id?: number } | undefined;
  /** The material issue form as its own page: nothing for a new issue, `id` to edit one. */
  MaterialIssueForm: { id?: number } | undefined;
  /** The GRN form as its own page: nothing for a new GRN, `id` to edit one. */
  GRNForm: { id?: number } | undefined;
  /** The vehicle in / out form as its own page: nothing for a new entry, `id` to edit one. */
  VehicleInOutForm: { id?: number } | undefined;
  /** The purchase order form as its own page: nothing for a new order, `id` to edit one, `qtPrefill` for an L1 Chart award. */
  PurchaseOrderForm: { id?: number; qtPrefill?: QTPOPrefill } | undefined;
  /** The material request form as its own page: nothing for a new request, `id` to edit one. */
  MaterialRequestForm: { id?: number } | undefined;
  ProfitLoss: undefined;
  BalanceEnquiry: undefined;
  NewInvoice: { id?: string } | undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Stack, not tabs — navigation now happens through the FAB + bottom sheet
// (NavSheet.tsx), matching the web app's MobileNav.tsx pattern (a floating
// trigger that opens a full nav panel) instead of a persistent tab bar.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="FinanceDashboard" component={FinanceDashboardScreen} options={{ title: "Finance" }} />
      <Stack.Screen name="Payment" component={PaymentListScreen} options={{ title: "Payments" }} />
      <Stack.Screen name="PaymentForm" component={PaymentFormScreen} options={{ title: "Payment" }} />
      <Stack.Screen name="OnAccountAdjustment" component={OnAccountAdjustmentScreen} options={{ title: "On A/C Adjustment" }} />
      <Stack.Screen name="ReceivedPayment" component={ReceivedPaymentListScreen} options={{ title: "Received Payments" }} />
      <Stack.Screen name="ReceivedPaymentForm" component={ReceivedPaymentFormScreen} options={{ title: "Receipt" }} />
      <Stack.Screen name="Brs" component={BrsScreen} options={{ title: "BRS" }} />
      <Stack.Screen name="Invoice" component={InvoiceScreen} options={{ title: "Invoice" }} />
      <Stack.Screen name="InvoicePreview" component={InvoicePreviewScreen} options={{ title: "Invoice Preview" }} />
      <Stack.Screen name="MaterialDashboard" component={MaterialDashboardScreen} options={{ title: "Material" }} />
      <Stack.Screen name="VehicleInOut" component={VehicleInOutListScreen} options={{ title: "Vehicle In/Out" }} />
      <Stack.Screen name="PurchaseOrder" component={PurchaseOrderListScreen} options={{ title: "Purchase Orders" }} />
      <Stack.Screen name="GRN" component={GRNListScreen} options={{ title: "GRN" }} />
      <Stack.Screen name="MaterialRequest" component={MaterialRequestListScreen} options={{ title: "Material Requests" }} />
      <Stack.Screen name="MaterialIssues" component={MaterialIssuesListScreen} options={{ title: "Material Issues" }} />
      <Stack.Screen name="MaterialIssueReturn" component={MaterialIssueReturnListScreen} options={{ title: "Issue Return" }} />
      <Stack.Screen name="ShortClose" component={ShortCloseScreen} options={{ title: "Short Close" }} />
      <Stack.Screen name="L1Chart" component={L1ChartScreen} options={{ title: "L1 Chart" }} />
      <Stack.Screen name="Stock" component={StockScreen} options={{ title: "Stock" }} />
      <Stack.Screen name="StockLedger" component={StockLedgerScreen} options={{ title: "Ledger" }} />
      <Stack.Screen name="StockTransfer" component={StockTransferListScreen} options={{ title: "Stock Transfer" }} />
      <Stack.Screen name="DebitNote" component={DebitNoteListScreen} options={{ title: "Debit Note" }} />
      <Stack.Screen name="Contract" component={ContractListScreen} options={{ title: "Contracts" }} />
      <Stack.Screen name="ContractDetail" component={ContractDetailScreen} options={{ title: "Contract" }} />
      <Stack.Screen name="NewContract" component={NewContractScreen} options={{ title: "New Contract" }} />
      <Stack.Screen name="JournalVoucher" component={JournalVoucherScreen} options={{ title: "Journal Voucher" }} />
      <Stack.Screen name="JournalVoucherForm" component={JournalVoucherFormScreen} options={{ title: "Journal Voucher" }} />
      <Stack.Screen name="TrialBalance" component={TrialBalanceScreen} options={{ title: "Trial Balance" }} />
      <Stack.Screen name="MaterialRequestForm" component={MaterialRequestFormScreen} options={{ title: "Material Request" }} />
      <Stack.Screen name="PurchaseOrderForm" component={PurchaseOrderFormScreen} options={{ title: "Purchase Order" }} />
      <Stack.Screen name="VehicleInOutForm" component={VehicleInOutFormScreen} options={{ title: "Vehicle In/Out" }} />
      <Stack.Screen name="GRNForm" component={GRNFormScreen} options={{ title: "GRN" }} />
      <Stack.Screen name="MaterialIssueForm" component={MaterialIssueFormScreen} options={{ title: "Material Issue" }} />
      <Stack.Screen name="IssueReturnForm" component={IssueReturnFormScreen} options={{ title: "Issue Return" }} />
      <Stack.Screen name="StockTransferForm" component={StockTransferFormScreen} options={{ title: "Stock Transfer" }} />
      <Stack.Screen name="DebitNoteForm" component={DebitNoteFormScreen} options={{ title: "Debit Note" }} />
      <Stack.Screen name="Quotation" component={QuotationListScreen} options={{ title: "Quotation" }} />
      <Stack.Screen name="QuotationForm" component={QuotationFormScreen} options={{ title: "Quotation" }} />
      <Stack.Screen name="BalanceSheet" component={BalanceSheetScreen} options={{ title: "Balance Sheet" }} />
      <Stack.Screen name="ProfitLoss" component={ProfitLossScreen} options={{ title: "Profit & Loss" }} />
      <Stack.Screen name="BalanceEnquiry" component={BalanceEnquiryScreen} options={{ title: "Balance Enquiry" }} />
      <Stack.Screen name="NewInvoice" component={NewInvoiceScreen} options={{ title: "New Invoice" }} />
    </Stack.Navigator>
  );
}

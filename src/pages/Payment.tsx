import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRecords } from "@/contexts/RecordsContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Banknote,
  FileText,
  Paperclip,
  Plus,
  Receipt,
  Clock,
  CheckCircle2,
} from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

// ====================== SCHEMA ======================
const paymentSchema = z
  .object({
    projectName: z.string().min(1, "Project name is required"),
    docDate: z.date({ required_error: "Date is required" }),
    mode: z.enum(["Cash", "Cheque", "UPI", "Card"], {
      required_error: "Mode of payment is required",
    }),
    amount: z.coerce.number().positive("Amount must be positive"),
    tagDOC: z.string().min(1, "Tag DOC is required"),
  })
  .refine((data) => data.docDate <= new Date(), {
    message: "Date cannot be in the future",
    path: ["docDate"],
  });

type PaymentFormData = z.infer<typeof paymentSchema>;

type PaymentDetails = {
  checkNumber?: string;
  bankName?: string;
  checkDate?: Date;
  transactionId?: string;
  upiId?: string;
  cardNumber?: string;
  expiry?: string;
  cardBank?: string;
};

type Payment = PaymentFormData &
  PaymentDetails & {
    id: string;
    status: "pending" | "cleared";
    createdAt: Date;
  };

// ====================== CONSTANTS ======================
const MOCK_PROJECTS = [
  "Project Alpha",
  "Site Beta",
  "Commercial Tower",
  "Residential Complex",
  "Infrastructure Project",
  "Road Construction",
  "Bridge Project",
];

const PAYMENT_MODES = ["Cash", "Cheque", "UPI", "Card"] as const;

// ====================== MAIN COMPONENT ======================
export default function Payment() {
  const { canDoAction } = useAuth();
  const { attachFile } = useRecords();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>({});

  const [showChequeDetails, setShowChequeDetails] = useState(false);
  const [showUpiDetails, setShowUpiDetails] = useState(false);
  const [showCardDetails, setShowCardDetails] = useState(false);

  const fileInputRefs = React.useRef<Record<string, HTMLInputElement | null>>(
    {},
  );

  // ====================== FILE HANDLING ======================
  const handleFileUpload = (paymentId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      attachFile(paymentId, {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result as string,
        uploadedAt: new Date().toISOString(),
      });
    };
    reader.readAsDataURL(file);
  };

  // ====================== LOCAL STORAGE ======================
  useEffect(() => {
    const saved = localStorage.getItem("paymentData");
    if (saved) {
      setPayments(JSON.parse(saved));
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setDate(today);
  }, []);

  useEffect(() => {
    localStorage.setItem("paymentData", JSON.stringify(payments));
  }, [payments]);

  // ====================== FORM SETUP ======================
  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      projectName: "",
      tagDOC: "",
      amount: 0,
      mode: "Cheque",
    },
  });

  // ====================== MODE CHANGE HANDLER ======================
  const onModeChange = (mode: "Cash" | "Cheque" | "UPI" | "Card") => {
    form.setValue("mode", mode);

    setShowChequeDetails(mode === "Cheque");
    setShowUpiDetails(mode === "UPI");
    setShowCardDetails(mode === "Card");

    setPaymentDetails({});
  };

  // ====================== SUBMIT HANDLER ======================
  const onSubmit = (data: PaymentFormData) => {
    const newPayment: Payment = {
      ...data,
      ...paymentDetails,
      id: `PAY${String(payments.length + 1).padStart(4, "0")}`,
      status: "pending",
      docDate: data.docDate!,
      createdAt: new Date(),
    };

    setPayments((prev) => [newPayment, ...prev]);
    toast.success(`Payment ${newPayment.id} created successfully!`);

    // Reset form and states
    form.reset();
    setDate(undefined);
    setPaymentDetails({});
    setShowChequeDetails(false);
    setShowUpiDetails(false);
    setShowCardDetails(false);
    setIsDialogOpen(false);
  };

  // ====================== COMPUTED STATS ======================
  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
  const pendingPayments = payments.filter((p) => p.status === "pending").length;
  const clearedPayments = payments.filter((p) => p.status === "cleared").length;

  return (
    <>
      <Breadcrumbs items={["Finance", "Payments"]} />

      <div className="px-4 sm:px-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Payment Management
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage outgoing vendor payments and transactions
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => setIsDialogOpen(true)}
            disabled={!canDoAction("payments", "create")}
          >
            <Plus size={15} className="mr-1" />
            New Payment
          </Button>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Banknote size={18} className="text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Payments</p>
                <p className="text-base font-bold">
                  ₹{totalPayments.toLocaleString("en-IN")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Clock size={18} className="text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-base font-bold text-amber-600">
                  {pendingPayments}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Cleared</p>
                <p className="text-base font-bold text-green-600">
                  {clearedPayments}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Payments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Payments</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {payments.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No payments recorded yet
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {payments.slice(0, 5).map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            {payment.id}
                          </span>
                          <Badge
                            variant={
                              payment.status === "cleared"
                                ? "default"
                                : "secondary"
                            }
                            className="text-xs px-2 py-0.5"
                          >
                            {payment.status.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="font-medium text-sm truncate">
                          {payment.projectName}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(payment.docDate!, "dd/MM/yyyy")}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-emerald-600 text-base">
                          ₹{payment.amount.toLocaleString("en-IN")}
                        </p>
                        <button
                          onClick={() =>
                            fileInputRefs.current[payment.id]?.click()
                          }
                          className="mt-1 p-1.5 text-muted-foreground hover:text-primary transition-colors"
                          title="Attach file"
                        >
                          <Paperclip size={15} />
                        </button>
                      </div>

                      <input
                        type="file"
                        className="hidden"
                        placeholder="Upload payment document"
                        ref={(el) => (fileInputRefs.current[payment.id] = el)}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(payment.id, file);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-10"
                onClick={() => setIsDialogOpen(true)}
                disabled={!canDoAction("payments", "create")}
              >
                <Plus size={15} className="mr-2" />
                New Vendor Payment
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-10"
              >
                <Receipt size={15} className="mr-2" />
                Receipt Entry
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-10"
              >
                <FileText size={15} className="mr-2" />
                Bank Reconciliation
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ====================== NEW PAYMENT DIALOG ====================== */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Banknote size={18} className="text-emerald-500" />
              New Outgoing Payment
            </DialogTitle>
            <DialogDescription>
              Record a vendor or project payment
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5 py-2"
            >
              {/* Project Name */}
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Project Name *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MOCK_PROJECTS.map((project) => (
                          <SelectItem key={project} value={project}>
                            {project}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Date */}
              <FormField
                control={form.control}
                name="docDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Date *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full h-9 justify-between text-sm font-normal",
                              !date && "text-muted-foreground",
                            )}
                          >
                            {date ? format(date, "dd/MM/yyyy") : "Pick date"}
                            <CalendarIcon size={14} className="opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={date}
                          onSelect={(selectedDate) => {
                            setDate(selectedDate);
                            field.onChange(selectedDate);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Mode */}
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Mode of Payment *</FormLabel>
                    <Select
                      onValueChange={(val) =>
                        onModeChange(val as "Cash" | "Cheque" | "UPI" | "Card")
                      }
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_MODES.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {mode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Amount (₹) *</FormLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                        ₹
                      </span>
                      <Input
                        className="pl-7 h-9 font-mono text-sm"
                        placeholder="0"
                        {...field}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, "");
                          field.onChange(val === "" ? 0 : parseFloat(val));
                        }}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Conditional Details */}
              {showChequeDetails && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-medium">Cheque Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      placeholder="Cheque Number"
                      className="h-9"
                      onChange={(e) =>
                        setPaymentDetails((prev) => ({
                          ...prev,
                          checkNumber: e.target.value,
                        }))
                      }
                    />
                    <Input
                      placeholder="Bank Name"
                      className="h-9"
                      onChange={(e) =>
                        setPaymentDetails((prev) => ({
                          ...prev,
                          bankName: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {showUpiDetails && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-medium">UPI Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      placeholder="Transaction ID"
                      className="h-9"
                      onChange={(e) =>
                        setPaymentDetails((prev) => ({
                          ...prev,
                          transactionId: e.target.value,
                        }))
                      }
                    />
                    <Input
                      placeholder="UPI ID"
                      className="h-9"
                      onChange={(e) =>
                        setPaymentDetails((prev) => ({
                          ...prev,
                          upiId: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {showCardDetails && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-medium">Card Details</p>
                  <div className="grid grid-cols-1 gap-3">
                    <Input
                      placeholder="Card Number"
                      className="h-9"
                      onChange={(e) =>
                        setPaymentDetails((prev) => ({
                          ...prev,
                          cardNumber: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {/* Tag DOC */}
              <FormField
                control={form.control}
                name="tagDOC"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      Tag DOC / Remarks *
                    </FormLabel>
                    <Textarea
                      placeholder="Payment reference, invoice no, or notes..."
                      className="min-h-[80px] text-sm resize-y"
                      {...field}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-4 gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  size="sm"
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="gap-1.5">
                  <Banknote size={15} />
                  Create Payment
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

import React, { useState, useCallback, useEffect } from "react";
import { useFinYear } from "@/contexts/FinYearContext";
import { useAuth } from "@/contexts/AuthContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Receipt, FileText, CheckCircle, CreditCardIcon, Banknote } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Label } from "@/components/ui/label";

// Schema
const paymentSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  docDate: z.date({ required_error: "Date is required" }),
  mode: z.enum(["Cash", "Check", "UPI", "Card"] as const, { required_error: "Mode of payment is required" }),
  amount: z.coerce.number().positive("Amount must be positive"),
  tagDOC: z.string().min(1, "Tag DOC is required"),
}).refine(data => data.docDate <= new Date(), {
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
type Payment = PaymentFormData & PaymentDetails & { id: string; status: "pending" | "cleared"; createdAt: Date };

const MOCK_PROJECTS = ["Project Alpha", "Site Beta", "Commercial Tower", "Residential Complex", "Infrastructure Project", "Road Construction", "Bridge Project"];
const PAYMENT_MODES = ["Cash", "Check", "UPI", "Card"] as const;

export default function Payment() {
  const { finYears } = useFinYear();
  const { canDoAction } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [date, setDate] = useState<Date>();
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>({});
  const [showCheckDetails, setShowCheckDetails] = useState(false);
  const [showUpiDetails, setShowUpiDetails] = useState(false);
  const [showCardDetails, setShowCardDetails] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('paymentData');
    if (saved) {
      setPayments(JSON.parse(saved));
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setDate(today);
  }, []);

  useEffect(() => {
    localStorage.setItem('paymentData', JSON.stringify(payments));
  }, [payments]);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      projectName: "",
      tagDOC: "",
      amount: 0,
      mode: "Check",
    },
  });

  const onModeChange = (mode: "Cash" | "Check" | "UPI" | "Card") => {
    form.setValue("mode", mode);
    setShowCheckDetails(mode === "Check");
    setShowUpiDetails(mode === "UPI");
    setShowCardDetails(mode === "Card");
    setPaymentDetails({});
  };

  const onSubmit = (data: PaymentFormData) => {
    const newPayment: Payment = {
      ...data,
      ...paymentDetails,
      id: `PAY${String(payments.length + 1).padStart(4, "0")}`,
      status: "pending" as const,
      docDate: data.docDate!,
      createdAt: new Date(),
    };
    
    setPayments(prev => [newPayment, ...prev]);
    toast.success(`Payment ${newPayment.id} created successfully!`);
    form.reset();
    setDate(undefined);
    setPaymentDetails({});
    setShowCheckDetails(false);
    setShowUpiDetails(false);
    setShowCardDetails(false);
    setIsDialogOpen(false);
  };

  const deletePayment = (id: string) => {
    setPayments(prev => prev.filter(p => p.id !== id));
    toast.success("Payment deleted");
  };

  // Compute stats
  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
  const pendingPayments = payments.filter(p => p.status === "pending").length;
  const clearedPayments = payments.filter(p => p.status === "cleared").length;

  return (
    <AppLayout>
      <Breadcrumbs items={["Payments"]} />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Payment Management</h1>
            <p className="text-muted-foreground mt-2">Manage payments, receipts, and transactions</p>
          </div>
          <Button size="lg" onClick={() => setIsDialogOpen(true)} disabled={!canDoAction("payments", "create")}>
            <Plus className="mr-2 h-4 w-4" />
            New Payment
          </Button>
        </div>

        {/* Summary Cards - Original */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Summary</CardTitle>
            <CardDescription>Key metrics and totals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 p-4 sm:p-6">
              <div className="p-4 sm:p-6 rounded-xl border bg-card/50 hover:bg-card">
                <div className="text-xl sm:text-2xl font-bold mb-2">₹{totalPayments.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Payments</div>
              </div>
              <div className="p-4 sm:p-6 rounded-xl border bg-card/50 hover:bg-card">
                <div className="text-xl sm:text-2xl font-bold text-destructive mb-2">{pendingPayments}</div>
                <div className="text-sm text-muted-foreground">Pending</div>
              </div>
              <div className="p-4 sm:p-6 rounded-xl border bg-card/50 hover:bg-card">
                <div className="text-xl sm:text-2xl font-bold text-green-600 mb-2">{clearedPayments}</div>
                <div className="text-sm text-muted-foreground">Cleared</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content Grid - Original */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Payments */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Payments</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {payments.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No payments yet. Create your first payment!</p>
              ) : (
                <div className="space-y-3 sm:space-y-4 max-h-80 sm:max-h-96 overflow-auto overscroll-contain [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-muted/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/60">
                  {payments.slice(0, 5).map((payment) => (
                    <div key={payment.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg hover:bg-muted gap-3 sm:gap-0">
                      <div className="truncate">
                        <div className="font-mono text-sm text-muted-foreground">{payment.id}</div>
                        <div className="font-medium truncate max-w-[200px] sm:max-w-none">{payment.projectName}</div>
                        <div className="text-sm text-muted-foreground">{format(payment.docDate!, "PPP")}</div>
                      </div>
                      <div className="flex sm:text-right gap-2 sm:gap-0 items-end sm:items-center">
                        <div className="font-mono font-bold text-lg sm:text-base">₹{payment.amount.toLocaleString()}</div>
                        <Badge variant={payment.status === "cleared" ? "default" : "secondary"} className="mt-1 whitespace-nowrap">
                          {payment.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions - Original */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" onClick={() => setIsDialogOpen(true)} disabled={!canDoAction("payments", "create")}>
                <Plus className="mr-2 h-4 w-4" />
                Vendor Payment
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Receipt className="mr-2 h-4 w-4" />
                Receipt Entry
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <FileText className="mr-2 h-4 w-4" />
                Bank Reconciliation
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* New Payment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Payment</DialogTitle>
            <DialogDescription>
              Create payment with mode-specific details and document tagging.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-6">
                {/* Project Name */}
                <FormField
                  control={form.control}
                  name="projectName"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                      <FormLabel className="text-sm font-medium w-full sm:w-[130px] sm:shrink-0 sm:text-right">Project Name</FormLabel>
                      <div className="flex-1 min-w-0">
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Select project" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {MOCK_PROJECTS.map((project) => (
                              <SelectItem key={project} value={project}>{project}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                /> 
                
                {/* Date */}
                <FormField
                  control={form.control}
                  name="docDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-3 sm:flex-row sm:items-end gap-3 sm:gap-4">
                      <FormLabel className="text-sm font-medium w-full sm:w-[130px] sm:shrink-0 sm:text-right">Date</FormLabel>
                      <div className="flex-1 min-w-0">
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full pl-3 text-left font-normal h-11 justify-between",
                                  !date && "text-muted-foreground"
                                )}
                              >
                                {date ? format(date, "PPP") : <span>Pick a date…</span>}
                                <CalendarIcon className="ml-2 h-4 w-4 opacity-50 shrink-0" />
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
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
                
                {/* Mode of Payment */}
                <FormField
                  control={form.control}
                  name="mode"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-3 sm:flex-row sm:items-end gap-3 sm:gap-4">
                      <FormLabel className="text-sm font-medium w-full sm:w-[130px] sm:shrink-0 sm:text-right">Mode of Payment</FormLabel>
                      <div className="flex-1 min-w-0">
                        <Select onValueChange={(val) => onModeChange(val as "Cash" | "Check" | "UPI" | "Card")} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Select mode" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PAYMENT_MODES.map((mode) => (
                              <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
                
                {/* Amount */}
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-3 sm:flex-row sm:items-end gap-3 sm:gap-4">
                      <FormLabel className="text-sm font-medium w-full sm:w-[130px] sm:shrink-0 sm:text-right">Amount (₹)</FormLabel>
                      <div className="flex-1 min-w-0">
                        <FormControl>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <span className="text-muted-foreground font-mono">₹</span>
                            </div>
                            <Input
                              type="text"
                              placeholder="0"
                              className="pl-10 font-mono h-11 text-lg"
                              {...field}
                              onChange={(e) => {
                                const inputValue = e.target.value.replace(/[^0-9.]/g, '');
                                if (inputValue === '' || /^\d*\.?\d{0,2}$/.test(inputValue)) {
                                  const numValue = inputValue === '' ? 0 : parseFloat(inputValue);
                                  field.onChange(numValue);
                                }
                              }}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              {/* Conditional Details - abbreviated for dialog */}
              {showCheckDetails && (
                <div className="border p-4 rounded-lg bg-muted/30">
                  <h4 className="font-semibold mb-3">Check Details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input placeholder="Check Number" onChange={(e) => setPaymentDetails(p => ({...p, checkNumber: e.target.value}))} />
                    <Input placeholder="Bank Name" onChange={(e) => setPaymentDetails(p => ({...p, bankName: e.target.value}))} />
                      <Popover>
                        <PopoverTrigger asChild><Button variant="outline" className="h-10 w-full sm:w-auto">Check Date</Button></PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start"><CalendarComponent mode="single" onSelect={(d) => setPaymentDetails(p => ({...p, checkDate: d!}))} /></PopoverContent>
                      </Popover>
                  </div>
                </div>
              )}
              {showUpiDetails && (
                <div className="border p-4 rounded-lg bg-muted/30">
                  <h4 className="font-semibold mb-3">UPI Details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input placeholder="Transaction ID" onChange={(e) => setPaymentDetails(p => ({...p, transactionId: e.target.value}))} />
                    <Input placeholder="UPI ID" onChange={(e) => setPaymentDetails(p => ({...p, upiId: e.target.value}))} />
                  </div>
                </div>
              )}
              {showCardDetails && (
                <div className="border p-4 rounded-lg bg-muted/30">
                  <h4 className="font-semibold mb-3">Card Details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input placeholder="**** **** **** 1234" onChange={(e) => setPaymentDetails(p => ({...p, cardNumber: e.target.value}))} />
                    <Input placeholder="MM/YY" onChange={(e) => setPaymentDetails(p => ({...p, expiry: e.target.value}))} />
                    <Input placeholder="Bank" onChange={(e) => setPaymentDetails(p => ({...p, cardBank: e.target.value}))} />
                  </div>
                </div>
              )}

              {/* Tag DOC */}
              <FormField
                control={form.control}
                name="tagDOC"
                render={({ field }) => (
                  <FormItem className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                    <FormLabel className="text-sm font-medium whitespace-nowrap flex-shrink-0 w-[140px] sm:w-[120px]">Tag DOC</FormLabel>
                    <div className="flex-1 min-w-0">
                      <FormControl>
                        <Textarea placeholder="Document details..." {...field} rows={3} className="min-h-[80px] resize-vertical" />
                      </FormControl>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-2 sm:pt-4">
                <Button type="submit" className="w-full h-12 gap-2 text-lg font-medium shadow-lg hover:shadow-xl transition-all duration-200 bg-gradient-to-r from-primary/90 to-primary/100">
                  <Banknote className="h-5 w-5" />
                  Create Payment
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}


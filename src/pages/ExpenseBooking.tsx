import React, { useState, useCallback, useEffect } from "react";
import { useFinYear } from "@/contexts/FinYearContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Check, FileText, Calendar, MessageSquare, 
         CheckCircle, Percent, Clock, Table as TableIcon } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, 
         SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarDays, Edit3 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Schema
const expenseSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  docType: z.string().min(1, "Document type is required"),
  docDate: z.date({ required_error: "DOC date is required" }),
  remarks: z.string().optional(),
  amount: z.coerce.number().positive("Amount must be positive"),
  isEMI: z.boolean().default(false),
  emiMonths: z.coerce.number().min(1).optional(),
  reminderDays: z.coerce.number().min(1).max(365).optional(),
  taxRate: z.coerce.number().min(0).max(0.28).default(0.18),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;
type Expense = ExpenseFormData & { id: string; status: "pending" | "approved"; emiBreakdown?: Array<{month: number; principal: number; interest: number; tax: number; total: number}> };

const MOCK_PROJECTS = ["Project Alpha", "Site Beta", "Commercial Tower", "Residential Complex", "Infrastructure Project"];
const MOCK_DOC_TYPES = ["Invoice", "Bill", "Receipt", "Petty Cash Voucher", "Payment Voucher"];
const INTEREST_RATE_ANNUAL = 0.12; // 12%
const GST_RATE = 0.18; // 18%

export default function ExpenseBooking() {
  const { finYears } = useFinYear();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [emiBreakdown, setEmiBreakdown] = useState<Array<{month: number; principal: number; interest: number; tax: number; total: number}>>([]);
  const [date, setDate] = useState<Date>();
  const [showEMI, setShowEMI] = useState(false);
  const [showCustomMonthsDialog, setShowCustomMonthsDialog] = useState(false);
  const [customMonths, setCustomMonths] = useState(12);

  useEffect(() => {
    // Load from localStorage
    const saved = localStorage.getItem('expenseBookingData');
    if (saved) {
      setExpenses(JSON.parse(saved));
    }

    // Set current date as default for new entries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setDate(today);
  }, []);

  useEffect(() => {
    // Save to localStorage
    localStorage.setItem('expenseBookingData', JSON.stringify(expenses));
  }, [expenses]);

  const form = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      projectName: "",
      docType: "",
      remarks: "",
      amount: 0,
      isEMI: false,
      emiMonths: 12,
      reminderDays: 30,
      taxRate: 0.18,
    },
  });

// EMI Calculation - Proper Amortization
const calculateEMI = useCallback((principal: number, months: number, taxRate: number = GST_RATE) => {
  const monthlyRate = INTEREST_RATE_ANNUAL / 12 / 100;
  
  // EMI Formula
  const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1);
  
  const breakdown: Array<{month: number; principal: number; interest: number; tax: number; total: number}> = [];
  let remainingPrincipal = principal;
  
  for (let m = 1; m <= months; m++) {
    // Interest on remaining principal
    const interest = remainingPrincipal * monthlyRate;
    const tax = interest * taxRate;
    
    // Principal paid = EMI - interest - tax
    const principalPaid = emi - interest - tax;
    
    breakdown.push({
      month: m,
      principal: Math.round(principalPaid * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round(emi * 100) / 100,
    });
    
    remainingPrincipal -= principalPaid;
    if (remainingPrincipal < 0) remainingPrincipal = 0;
  }
  
  return { emi: Math.round(emi * 100) / 100, breakdown };
}, []);

  const onAmountChange = useCallback((value: number) => {
    const months = form.watch("emiMonths") || 12;
    const taxRate = form.watch("taxRate") || GST_RATE;
    if (showEMI && value > 0 && months > 0) {
      const { breakdown } = calculateEMI(value, months, taxRate);
      setEmiBreakdown(breakdown);
    }
  }, [showEMI, form, calculateEMI]);

  const onMonthsChange = useCallback((months: number) => {
    const amount = form.watch("amount") || 0;
    const taxRate = form.watch("taxRate") || GST_RATE;
    if (showEMI && amount > 0 && months > 0) {
      const { breakdown } = calculateEMI(amount, months, taxRate);
      setEmiBreakdown(breakdown);
    }
  }, [showEMI, form, calculateEMI]);

  const handleCustomMonthsConfirm = () => {
    form.setValue("emiMonths", customMonths);
    onMonthsChange(customMonths);
    setShowCustomMonthsDialog(false);
  };

  const onSubmit = (data: ExpenseFormData) => {
    const newExpense: Expense = {
      ...data,
      id: `EXP${String(expenses.length + 1).padStart(4, "0")}`,
      status: "pending" as const,
      docDate: data.docDate!,
    };
    
    if (data.isEMI && data.emiMonths && emiBreakdown.length > 0) {
      newExpense.emiBreakdown = emiBreakdown;
    }
    
    setExpenses(prev => [newExpense, ...prev]);
    toast.success(`Expense EXP${newExpense.id.slice(3)} booked successfully!`);
    form.reset();
    setDate(undefined);
    setEmiBreakdown([]);
    setShowEMI(false);
  };

  return (
    <>
      <div className="space-y-6 p-6">
    <Breadcrumbs items={["Transactions", "Expense Booking"]} />
        
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-heading">Expense Booking</CardTitle>
            <CardDescription>
              Record expenses with optional EMI breakdown and automated reminders.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
          
      <CardContent className="space-y-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
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
                  </FormItem>
                )}
              />
                  
              <FormField
                control={form.control}
                name="docType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Document Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MOCK_DOC_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
                  
              <FormField
                control={form.control}
                name="docDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>DOC Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !date && "text-muted-foreground"
                            )}
                          >
                            {date ? format(date, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
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
                          disabled={(date: Date) => date > new Date()}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
                  
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (₹)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="0.00"
                        {...field}
                        className="font-mono"
                        onChange={(e) => {
                          const inputValue = e.target.value;
                              
                          // Only allow numbers, decimal point, and empty
                          if (inputValue === '' || /^\d*\.?\d*$/.test(inputValue)) {
                            const numValue = inputValue === '' ? 0 : parseFloat(inputValue);
                            field.onChange(numValue);
                            onAmountChange(numValue);
                          } else {
                            toast.error('Only numeric values allowed (positive numbers only)');
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
                  
              <FormField
                control={form.control}
                name="isEMI"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          setShowEMI(Boolean(checked));
                          if (!checked) setEmiBreakdown([]);
                        }}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <Label className="text-base">EMI Payment</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable monthly installments
                      </p>
                    </div>
                  </FormItem>
                )}
              />
                  
              <FormField
                control={form.control}
                name="reminderDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reminder (Days before due)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="30"
                        {...field}
                        min={1}
                        max={365}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes about this expense..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* EMI Section - Conditional */}
            {showEMI && (
              <div className="border rounded-xl p-6 bg-muted/30">
                <div className="flex items-center gap-3 mb-6">
                  <CheckCircle className="h-5 w-5" />
                  <div>
                    <h3 className="text-lg font-heading font-semibold">EMI Breakdown</h3>
                    <p className="text-sm text-muted-foreground">
                      Interest Rate: <Badge>12% annual (1% monthly)</Badge> | 
                      GST: <Badge variant="secondary">18%</Badge>
                    </p>
                  </div>
                </div>
                    
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                    <FormLabel>EMI Tenure (Months)</FormLabel>
                    <FormField
                      control={form.control}
                      name="emiMonths"
                      render={({ field }) => (
                        <FormItem>
                          <Select 
                            onValueChange={(val) => {
                              if (val === 'custom') {
                                setShowCustomMonthsDialog(true);
                              } else {
                                const months = parseInt(val);
                                field.onChange(months);
                                onMonthsChange(months);
                              }
                            }} 
                            value={field.value?.toString() || ''}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <FormLabel>Enter months</FormLabel>
                                <SelectValue placeholder="Enter months" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {[3,6,12,24,36,48,60].map((m) => (
                                <SelectItem key={m} value={m.toString()}>{m} months</SelectItem>
                              ))}
                              <SelectItem value="custom">Custom...</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Dialog open={showCustomMonthsDialog} onOpenChange={setShowCustomMonthsDialog}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Custom EMI Tenure</DialogTitle>
                          <DialogDescription>
                            Enter the number of months for EMI calculation
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <Input
                            type="number"
                            min="1"
                            max="120"
                            value={customMonths}
                            onChange={(e) => setCustomMonths(parseInt(e.target.value) || 12)}
                            placeholder="Enter months"
                            className="w-full"
                          />
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setShowCustomMonthsDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleCustomMonthsConfirm}>
                              Confirm
                            </Button>
                          </DialogFooter>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

{emiBreakdown.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <TableIcon className="h-4 w-4" />
                      <span className="font-heading text-sm font-medium">Monthly Breakdown</span>
                    </div>
                    <div className="max-h-64 overflow-auto rounded-lg border scrollbar-thin scrollbar-thumb-muted scrollbar-track-background">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                            <TableHead className="text-muted-foreground font-semibold">Month</TableHead>
                            <TableHead className="text-muted-foreground font-semibold">Principal</TableHead>
                            <TableHead className="text-muted-foreground font-semibold">Interest</TableHead>
                            <TableHead className="text-muted-foreground font-semibold">GST</TableHead>
                            <TableHead className="text-muted-foreground font-semibold">Total EMI</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {emiBreakdown.map((row) => (
                            <TableRow key={row.month} className="hover:bg-muted/50 border-b">
                              <TableCell className="font-medium">Month {row.month}</TableCell>
                              <TableCell className="font-mono">₹{row.principal.toLocaleString()}</TableCell>
                              <TableCell className="font-mono">₹{row.interest.toFixed(0)}</TableCell>
                              <TableCell className="font-mono">₹{row.tax.toFixed(0)}</TableCell>
                              <TableCell className="font-mono font-semibold">₹{row.total.toFixed(0)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button type="submit" className="w-full lg:w-auto gradient-accent text-lg h-12">
              <Plus className="mr-2 h-5 w-5" />
              Book Expense
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>

    {/* Recent Expenses Table */}
    {expenses.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Recent Expenses ({expenses.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="font-mono text-sm">{expense.id}</TableCell>
                  <TableCell className="font-medium">{expense.projectName}</TableCell>
                  <TableCell>{format(expense.docDate!, "PPP")}</TableCell>
                  <TableCell className="font-mono text-lg">₹{expense.amount.toLocaleString("en-IN")}</TableCell>
                  <TableCell>
                    <Badge variant={expense.isEMI ? "secondary" : "default"}>
                      {expense.isEMI ? "EMI" : "Lump Sum"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={expense.status === "approved" ? "default" : "secondary"}>
                      {expense.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )}
  </div>
    </>
  );
}


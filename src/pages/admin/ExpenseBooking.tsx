import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

// Mock data
const MOCK_EXPENSES = [
  {
    id: "EXP001",
    date: "2024-10-15",
    category: "Travel",
    amount: 2500.00,
    vendor: "Ola Cabs",
    description: "Office travel for meeting",
    status: "Approved" as const,
  },
  {
    id: "EXP002",
    date: "2024-10-14",
    category: "Office Supplies",
    amount: 450.50,
    vendor: "Local Stationery",
    description: "Printer ink and paper",
    status: "Pending" as const,
  },
  {
    id: "EXP003",
    date: "2024-10-10",
    category: "Meals",
    amount: 1200.00,
    vendor: "Hotel Grand",
    description: "Client dinner meeting",
    status: "Rejected" as const,
  },
];

type ExpenseStatus = "Pending" | "Approved" | "Rejected";

interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  vendor: string;
  description: string;
  status: ExpenseStatus;
}

interface ExpenseFormData {
  date: string;
  category: string;
  amount: number;
  vendor: string;
  description: string;
}

export default function ExpenseBooking() {
  const [expenses, setExpenses] = useState<Expense[]>(MOCK_EXPENSES);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const form = useForm<ExpenseFormData>({
    defaultValues: {
      date: "",
      category: "",
      amount: 0,
      vendor: "",
      description: "",
    },
  });

  const onSubmit = (data: ExpenseFormData) => {
    if (editingExpense) {
      // Update
      setExpenses(prev =>
        prev.map(exp => 
          exp.id === editingExpense.id 
            ? { ...exp, ...data, status: "Pending" as ExpenseStatus }
            : exp
        )
      );
      toast.success("Expense updated successfully");
    } else {
      // Create new
      const newExpense: Expense = {
        id: `EXP${String(expenses.length + 1).padStart(3, "0")}`,
        ...data,
        status: "Pending" as ExpenseStatus,
      };
      setExpenses(prev => [newExpense, ...prev]);
      toast.success("Expense booked successfully");
    }
    setIsDialogOpen(false);
    form.reset();
    setEditingExpense(null);
  };

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense);
    form.reset({
      date: expense.date,
      category: expense.category,
      amount: expense.amount,
      vendor: expense.vendor,
      description: expense.description,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setExpenses(prev => prev.filter(exp => exp.id !== id));
    toast.success("Expense deleted");
  };

  const getStatusBadge = (status: ExpenseStatus) => {
    const variants: Record<ExpenseStatus, "default" | "destructive" | "outline" | "secondary"> = {
      Pending: "default",
      Approved: "default",
      Rejected: "destructive",
    };
    const colors = {
      Pending: "bg-yellow-100 text-yellow-800",
      Approved: "bg-green-100 text-green-800",
      Rejected: "bg-red-100 text-red-800",
    };
    return (
      <Badge variant={variants[status]} className={colors[status]}>
        {status}
      </Badge>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <Breadcrumbs items={["Admin", "Transactions", "Expense Booking"]} />
        
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-heading">Expense Booking</CardTitle>
                <CardDescription>
                  Record and manage employee expenses. Pending expenses await approval.
                </CardDescription>
              </div>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-accent">
                    <Plus className="mr-2 h-4 w-4" />
                    New Expense
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingExpense ? "Edit Expense" : "Book New Expense"}</DialogTitle>
                    <DialogDescription>
                      Fill in the expense details below.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name="date"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Date</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Travel, Meals" {...field} />
                              </FormControl>
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
                                <Input type="number" step="0.01" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="vendor"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Vendor/Party</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Ola Cabs, Local Store" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Brief description of expense..." {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="submit" className="gradient-accent">
                          {editingExpense ? "Update Expense" : "Book Expense"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell className="font-mono text-sm">EXP{expense.id.slice(3)}</TableCell>
                      <TableCell>{new Date(expense.date).toLocaleDateString()}</TableCell>
                      <TableCell>{expense.category}</TableCell>
                      <TableCell className="font-mono">₹{expense.amount.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{expense.vendor}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                      <TableCell>{getStatusBadge(expense.status)}</TableCell>
                      <TableCell className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(expense)}
                          className="h-7"
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(expense.id)}
                          className="h-7"
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {expenses.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No expenses recorded yet. Click "New Expense" to book your first one.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}


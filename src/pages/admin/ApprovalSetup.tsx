import React, { useState, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  CheckCircle,
  Shield,
  Users,
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  Search,
} from "lucide-react";
import { PageKey } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Workflow {
  id: number;
  name: string;
  module?: string;
  levels: number;
  approvers: string[];
  status: "Active" | "Inactive";
  description?: string;
  createdAt: string;
}

// ── API helpers — all use fetchWithAuth so the JWT is always sent ──────────────
const API = "/api/approval-workflows";

async function fetchWorkflows(): Promise<Workflow[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json();
}

async function apiCreate(body: object) {
  const res = await fetchWithAuth(API, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to create");
}

async function apiUpdate(id: number, body: object) {
  const res = await fetchWithAuth(`${API}/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to update");
}

async function apiToggle(id: number) {
  const res = await fetchWithAuth(`${API}/${id}/toggle`, { method: "PATCH" });
  if (!res.ok) throw new Error("Failed to toggle");
}

async function apiDelete(id: number) {
  const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
}

// ── Form schema ────────────────────────────────────────────────────────────────
const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  module: z.string().min(1, "Module is required"),
  levels: z.number().min(1).max(5),
  approvers: z.string().min(1, "At least one approver is required"),
  status: z.enum(["Active", "Inactive"]),
  description: z.string().optional(),
});

type FormInput = z.infer<typeof formSchema>;
// Keep FormData as an alias for submit handlers that need approvers as string[]
type FormData = Omit<FormInput, "approvers"> & { approvers: string[] };

const defaultFormValues: FormInput = {
  name: "",
  module: "",
  levels: 1,
  approvers: "",
  status: "Active" as const,
  description: "",
};

const MODULE_OPTIONS = [
  "AccountHeadMaster",
  "PurchaseOrders",
  "WorkOrderHeader",
  "NewPayment",
  "ChequeMaster",
  "Expenses",
  "Accounts",
  "Purchases",
];

// ── Main component ─────────────────────────────────────────────────────────────
export default function ApprovalSetup() {
  const queryClient = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "Active" | "Inactive"
  >("all");
  const { canDoAction } = useAuth() as any;

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["approval-workflows"],
    queryFn: fetchWorkflows,
    staleTime: 30_000, // don't refetch for 30s after a successful load
    refetchOnWindowFocus: false, // stop refetching every tab switch
  });

  const createForm = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
  });

  const editForm = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
  });

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => {
      const matchSearch =
        w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (w.module || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === "all" || w.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [workflows, searchTerm, statusFilter]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const onCreateSubmit = useCallback(
    async (raw: FormInput) => {
      const data: FormData = {
        ...raw,
        approvers: raw.approvers.split(",").map((s) => s.trim()).filter(Boolean),
      };
      try {
        await apiCreate(data);
        toast.success("Workflow created successfully");
        queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
        createForm.reset(defaultFormValues);
        setOpenCreate(false);
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [createForm, queryClient],
  );

  const onEditSubmit = useCallback(
    async (raw: FormInput) => {
      if (!editingWorkflow) return;
      const data: FormData = {
        ...raw,
        approvers: raw.approvers.split(",").map((s) => s.trim()).filter(Boolean),
      };
      try {
        await apiUpdate(editingWorkflow.id, data);
        toast.success("Workflow updated successfully");
        queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
        editForm.reset(defaultFormValues);
        setOpenEdit(false);
        setEditingWorkflow(null);
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [editingWorkflow, editForm, queryClient],
  );

  const toggleStatus = useCallback(
    async (id: number) => {
      try {
        await apiToggle(id);
        toast.success("Workflow status updated");
        queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [queryClient],
  );

  const deleteWorkflow = useCallback(
    async (id: number) => {
      if (!confirm("Delete this workflow?")) return;
      try {
        await apiDelete(id);
        toast.success("Workflow deleted");
        queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [queryClient],
  );

  const openEditDialog = useCallback(
    (w: Workflow) => {
      setEditingWorkflow(w);
      editForm.reset({
        name: w.name,
        module: w.module || "",
        levels: w.levels,
        approvers: w.approvers.join(", "),
        status: w.status,
        description: w.description || "",
      });
      setOpenEdit(true);
    },
    [editForm],
  );

  // ── Shared form fields ─────────────────────────────────────────────────────────
  const renderFormFields = (form: UseFormReturn<FormInput>) => (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Workflow Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Purchase Approval" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="module"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Module</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select module" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {MODULE_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="levels"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Approval Levels</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                max={5}
                {...field}
                onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="approvers"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Approvers (comma-separated roles)</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Manager, Director, CFO" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="status"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Status</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea placeholder="Optional description..." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );

  if (isLoading)
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Admin", "Approval", "Approval Setup"]} />
      <div className="relative space-y-8 mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <CheckCircle className="text-primary" /> Approval Setup
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure approval workflows and levels
          </p>
        </div>
        {canDoAction("admin_approval_setup" as PageKey, "create") && (
          <Button
            className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            onClick={() => {
              createForm.reset(defaultFormValues);
              setOpenCreate(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Workflow
          </Button>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Workflow</DialogTitle>
            <DialogDescription>
              Create a new approval workflow.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit(onCreateSubmit)}
              className="space-y-4"
            >
              {renderFormFields(createForm)}
              <Button type="submit" className="w-full gradient-accent gap-2 font-semibold text-white text-sm h-auto py-2">
                <Plus className="h-4 w-4" /> Create Workflow
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={openEdit}
        onOpenChange={(open) => {
          setOpenEdit(open);
          if (!open) setEditingWorkflow(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Workflow</DialogTitle>
            <DialogDescription>
              Update the approval workflow details.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit(onEditSubmit)}
              className="space-y-4"
            >
              {renderFormFields(editForm)}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !canDoAction("admin_approval_setup" as PageKey, "edit")
                }
              >
                Save Changes
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 mb-8 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Workflows
            </CardTitle>
            <CheckCircle className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workflows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <Shield className="h-5 w-5 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {workflows.filter((w) => w.status === "Active").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Levels</CardTitle>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {workflows.length
                ? Math.round(
                    workflows.reduce((a, b) => a + b.levels, 0) /
                      workflows.length,
                  )
                : 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
            <AlertCircle className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Approval Workflows</CardTitle>
            <CardDescription>
              Define multi-level approval chains
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search workflows..."
                className="pl-10 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as any)}
            >
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredWorkflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No workflows found</h3>
              <p className="text-muted-foreground mb-6">
                Try adjusting your search or filter.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Levels</TableHead>
                  <TableHead>Approvers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWorkflows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
                        {item.module}
                      </span>
                    </TableCell>
                    <TableCell>{item.levels}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.approvers.join(" → ")}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={item.status === "Active"}
                        onCheckedChange={() => toggleStatus(item.id)}
                        disabled={
                          !canDoAction(
                            "admin_approval_setup" as PageKey,
                            "edit",
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={
                            !canDoAction(
                              "admin_approval_setup" as PageKey,
                              "edit",
                            )
                          }
                          onClick={() => openEditDialog(item)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          disabled={
                            !canDoAction(
                              "admin_approval_setup" as PageKey,
                              "delete",
                            )
                          }
                          onClick={() => deleteWorkflow(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </div>{/* end relative space-y-8 mt-6 */}
    </>
  );
}
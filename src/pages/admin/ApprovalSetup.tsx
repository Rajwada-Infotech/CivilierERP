import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CheckCircle, Shield, Users, AlertCircle, Settings, Plus, Edit, Trash2, ChevronDown, Search } from "lucide-react";
import { PageKey } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";


interface Workflow {
  id: number;
  name: string;
  module?: string;
  levels: number;
  approvers: string[];
  status: 'Active' | 'Inactive';
  description?: string;
  createdAt: string;
}

const initialWorkflows: Workflow[] = [
  { id: 1, name: "Purchase Order", module: "Purchases", levels: 2, approvers: ["Manager", "Director"], status: "Active", description: "PO approval chain", createdAt: new Date().toISOString() },
  { id: 2, name: "Expense Approval", module: "Expenses", levels: 1, approvers: ["Manager"], status: "Active", description: "Basic expense approval", createdAt: new Date().toISOString() },
  { id: 3, name: "Invoice Payment", module: "Accounts", levels: 3, approvers: ["Manager", "Director", "CFO"], status: "Inactive", description: "High value payments", createdAt: new Date().toISOString() },
];

export default function ApprovalSetup() {
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows);
  const [isLoading, setIsLoading] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [openEdit, setOpenEdit] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const { canDoAction } = useAuth() as any;
  const { toast } = useToast();

  const formSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    module: z.string().optional(),
    levels: z.number().min(1).max(5),
    approvers: z.string().transform(val => val.split(',').map(s => s.trim()).filter(s => s)),
    status: z.enum(['Active', 'Inactive']),
    description: z.string().optional(),
  });

  type FormData = z.infer<typeof formSchema>;

  const createForm = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      module: '',
      levels: 1,
      approvers: '',
      status: 'Active' as const,
      description: '',
    },
  });

  const editForm = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      module: '',
      levels: 1,
      approvers: '',
      status: 'Active' as const,
      description: '',
    },
  });

  const onCreateSubmit = (data: FormData) => {
    addWorkflow({
      name: data.name,
      module: data.module || undefined,
      levels: data.levels,
      approvers: data.approvers,
      status: data.status,
      description: data.description || undefined,
    });
    createForm.reset();
    setOpenCreate(false);
  };

  const onEditSubmit = (data: FormData) => {
    if (!editingWorkflow) return;
    updateWorkflow(editingWorkflow.id, {
      name: data.name,
      module: data.module || undefined,
      levels: data.levels,
      approvers: data.approvers,
      status: data.status,
      description: data.description || undefined,
    });
    editForm.reset();
    setOpenEdit(false);
    setEditingWorkflow(null);
  };

  useEffect(() => {
    const saved = localStorage.getItem('approvalWorkflows');
    if (saved) {
      setWorkflows(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('approvalWorkflows', JSON.stringify(workflows));
  }, [workflows]);

  const addWorkflow = (newWorkflow: Omit<Workflow, 'id' | 'createdAt'>) => {
    const workflow: Workflow = {
      ...newWorkflow,
      id: Date.now(),
      createdAt: new Date().toISOString(),
    };
    setWorkflows(prev => [workflow, ...prev]);
    toast({
      title: "Success",
      description: "Workflow created.",
    });
  };

  const updateWorkflow = (id: number, updated: Partial<Workflow>) => {
    setWorkflows(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    toast({
      title: "Success",
      description: "Workflow updated.",
    });
  };

  const deleteWorkflow = (id: number) => {
    setWorkflows(prev => prev.filter(w => w.id !== id));
    toast({
      title: "Success",
      description: "Workflow deleted.",
    });
  };

  const filteredWorkflows = useMemo(() => {
    return workflows.filter(w => {
      const matchesSearch = w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (w.module && w.module.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (w.description && w.description.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesStatus = statusFilter === 'all' || w.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [workflows, searchTerm, statusFilter]);

  const toggleStatus = (id: number) => {
    setWorkflows(prev => prev.map(w => w.id === id ? { ...w, status: w.status === 'Active' ? 'Inactive' : 'Active' } : w));
    toast({
      title: "Status Updated",
      description: "Workflow status toggled.",
    });
  };

  if (isLoading) {
    // Skeleton
    return <AppLayout><div>Loading...</div></AppLayout>;
  }

  const handleQuickEdit = (id: number) => {
    const workflow = workflows.find(w => w.id === id);
    if (!workflow) return;
    const newName = prompt('Enter new workflow name:', workflow.name);
    if (newName && newName !== workflow.name) {
      updateWorkflow(id, { name: newName });
    }
  };

  return (
    <AppLayout>
      <Breadcrumbs items={["Admin", "Approval", "Approval Setup"]} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-primary" />
            Approval Setup
          </h1>
          <p className="text-muted-foreground mt-1">Configure approval workflows and levels</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button disabled={!canDoAction('admin_approval_setup' as PageKey, 'create')} onClick={() => createForm.reset()}>
                <Plus className="w-4 h-4 mr-2" />
                New Workflow
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New Approval Workflow</DialogTitle>
              <DialogDescription>Create a new multi-level approval chain.</DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                <FormField
                  control={createForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workflow Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Purchase Order Approval" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="module"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Module (optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select module" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Purchases">Purchases</SelectItem>
                          <SelectItem value="Expenses">Expenses</SelectItem>
                          <SelectItem value="Accounts">Accounts</SelectItem>
                          <SelectItem value="General">General</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="levels"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Approval Levels</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={5} {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="approvers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Approvers (comma separated)</FormLabel>
                      <FormControl>
                        <Input placeholder="Manager, Director, CFO" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex items-center space-x-2">
                  <Switch
                    id="status"
                    checked={createForm.watch('status') === 'Active'}
                    onCheckedChange={(checked) => createForm.setValue('status', checked ? 'Active' : 'Inactive')}
                  />
                  <label htmlFor="status" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Active
                  </label>
                </div>
                <FormField
                  control={createForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Brief description of this workflow" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={!canDoAction('admin_approval_setup' as PageKey, 'create')}>
                  Create Workflow
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 mb-8 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Workflows</CardTitle>
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
            <div className="text-2xl font-bold">{workflows.filter(w => w.status === 'Active').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Levels</CardTitle>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(workflows.reduce((a, b) => a + b.levels, 0) / workflows.length) || 0}</div>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Approval Workflows</CardTitle>
            <CardDescription>Define multi-level approval chains</CardDescription>
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
              <p className="text-muted-foreground mb-6">Try adjusting your search or filter settings.</p>
              {canDoAction('admin_approval_setup' as PageKey, 'create') && (
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create first workflow
                  </Button>
                </DialogTrigger>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Workflow</TableHead>
                    <TableHead className="w-[120px]">Module</TableHead>
                    <TableHead className="w-[80px]">Levels</TableHead>
                    <TableHead className="min-w-[150px]">Approvers</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWorkflows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">{item.name}</TableCell>
                      <TableCell className="max-w-[120px] truncate">{item.module}</TableCell>
                      <TableCell className="w-[80px]">{item.levels}</TableCell>
                      <TableCell className="min-w-[150px] max-w-[200px] truncate">{item.approvers.join(" > ")}</TableCell>
                      <TableCell className="w-[100px]">
                        <Switch 
                          checked={item.status === 'Active'}
                          onCheckedChange={() => toggleStatus(item.id)}
                          disabled={!canDoAction('admin_approval_setup' as PageKey, 'edit')}
                        />
                      </TableCell>
                      <TableCell className="w-[120px]">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={!canDoAction('admin_approval_setup' as PageKey, 'edit')} onClick={() => handleQuickEdit(item.id)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={!canDoAction('admin_approval_setup' as PageKey, 'delete')} onClick={() => deleteWorkflow(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}


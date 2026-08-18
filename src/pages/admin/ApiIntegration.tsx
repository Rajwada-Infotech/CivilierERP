import { generateUUID } from '../../utils/cryptoPolyfill';  
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  getCommunicatorConfig,
  saveCommunicatorConfig,
} from "@/api/communicatorConfigApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Edit3, Loader2, Plus, RefreshCw, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  apiIntegrationSchema,
  type ApiIntegrationForm,
} from "@/schemas/apiIntegrationSchema";

interface ApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  status: "active" | "inactive";
}

interface IntegrationConfigPayload {
  apis?: ApiConfig[];
}

const QUERY_KEY = ["communicator-config", "integrations"];
const EMPTY_FORM: ApiIntegrationForm = { name: "", baseUrl: "", apiKey: "" };

const buildId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return generateUUID();
  }
  return `api-${Date.now()}`;
};

const maskApiKey = (apiKey: string) => {
  if (!apiKey) return "Not set";
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}••••`;
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
};

export default function ApiIntegration() {
  const rights = usePageRights("api-integration");
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const {
    register: registerNewApi,
    handleSubmit: handleNewApiSubmit,
    reset: resetNewApi,
    watch: watchNewApi,
    formState: { errors: newApiErrors },
  } = useForm<ApiIntegrationForm>({
    resolver: zodResolver(apiIntegrationSchema),
    defaultValues: EMPTY_FORM,
  });
  const {
    register: registerEditApi,
    handleSubmit: handleEditApiSubmit,
    reset: resetEditApi,
    formState: { errors: editApiErrors },
  } = useForm<ApiIntegrationForm>({
    resolver: zodResolver(apiIntegrationSchema),
    defaultValues: EMPTY_FORM,
  });
  const newApi = watchNewApi();

  const {
    data: apis = [],
    isLoading,
    isFetching,
    error,
  } = useQuery<ApiConfig[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const config =
        await getCommunicatorConfig<IntegrationConfigPayload>("integrations");
      return Array.isArray(config.apis) ? config.apis : [];
    },
    staleTime: 5 * 60_000,
  });

  const persistApis = useMutation({
    mutationFn: async (nextApis: ApiConfig[]) => {
      await saveCommunicatorConfig("integrations", { apis: nextApis });
      return nextApis;
    },
    onSuccess: (nextApis) => {
      queryClient.setQueryData(QUERY_KEY, nextApis);
    },
    onError: (mutationError: Error) => {
      toast.error(mutationError.message);
    },
  });

  const saveApis = React.useCallback(
    async (nextApis: ApiConfig[], successMessage: string) => {
      try {
        await persistApis.mutateAsync(nextApis);
        toast.success(successMessage);
        return true;
      } catch {
        return false;
      }
    },
    [persistApis],
  );

  const addApi = async (values: ApiIntegrationForm) => {
    const saved = await saveApis(
      [
        ...apis,
        {
          id: buildId(),
          name: values.name.trim(),
          baseUrl: values.baseUrl.trim(),
          apiKey: values.apiKey.trim(),
          status: "active" as const,
        },
      ],
      `API "${values.name.trim()}" saved`,
    );
    if (saved) {
      resetNewApi(EMPTY_FORM);
    }
  };

  const deleteApi = async (id: string) => {
    const target = apis.find((api) => api.id === id);
    await saveApis(
      apis.filter((api) => api.id !== id),
      target ? `API "${target.name}" removed` : "API removed",
    );
  };

  const toggleStatus = async (id: string) => {
    const nextApis = apis.map((api) =>
      api.id === id
        ? {
            ...api,
            status: (api.status === "active" ? "inactive" : "active") as
              | "active"
              | "inactive",
          }
        : api,
    );
    const target = nextApis.find((api) => api.id === id);
    await saveApis(
      nextApis,
      target
        ? `API "${target.name}" marked ${target.status}`
        : "API status updated",
    );
  };

  const startEdit = (api: ApiConfig) => {
    setEditingId(api.id);
    resetEditApi({
      name: api.name,
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    resetEditApi(EMPTY_FORM);
  };

  const saveEdit = async (values: ApiIntegrationForm) => {
    if (!editingId) return;
    const nextApis = apis.map((api) =>
      api.id === editingId
        ? {
            ...api,
            name: values.name.trim(),
            baseUrl: values.baseUrl.trim(),
            apiKey: values.apiKey.trim(),
          }
        : api,
    );
    const saved = await saveApis(
      nextApis,
      `API "${values.name.trim()}" updated`,
    );
    if (saved) {
      cancelEdit();
    }
  };

  const isSaving = persistApis.isPending;
  const activeCount = apis.filter((a) => a.status === "active").length;

  const headerAction = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
        <span className="px-2.5 py-1 rounded-full bg-muted border border-border">
          {apis.length} total
        </span>
        <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          {activeCount} active
        </span>
      </div>
      <button
        onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
        disabled={isFetching}
        className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50"
        title="Refresh"
      >
        <RefreshCw
          size={13}
          className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`}
        />
        Refresh
      </button>
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Admin", "API Integration"]} />
      <AdminShell
        title="API Integration"
        subtitle="Manage external API connections persisted via communicator config"
        icon={Link2}
        action={headerAction}
      >
        {/* ── Add New API card ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
            <Plus size={14} className="text-primary" />
            <span className="text-sm font-heading font-semibold text-foreground">
              Add New API
            </span>
          </div>
          <div className="p-6">
            <form className="space-y-4" onSubmit={handleNewApiSubmit(addApi)}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="name"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    API Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="Payment Gateway API"
                    className="font-body"
                    {...registerNewApi("name")}
                  />
                  {newApiErrors.name && (
                    <p className="text-xs text-destructive">{newApiErrors.name.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="baseUrl"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    Base URL <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="baseUrl"
                    placeholder="https://api.example.com"
                    className="font-body"
                    {...registerNewApi("baseUrl")}
                  />
                  {newApiErrors.baseUrl && (
                    <p className="text-xs text-destructive">{newApiErrors.baseUrl.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="apiKey"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    API Key <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="sk-..."
                    className="font-body"
                    {...registerNewApi("apiKey")}
                  />
                  {newApiErrors.apiKey && (
                    <p className="text-xs text-destructive">{newApiErrors.apiKey.message}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={isSaving || !newApi.name || !newApi.baseUrl || !newApi.apiKey}
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
                >
                  {isSaving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  Add API
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Configured APIs card ─────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-heading font-semibold text-foreground">
              Configured APIs
            </h2>
            <span className="text-xs font-body text-muted-foreground">
              ({apis.length})
            </span>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {(error as Error).message || "Failed to load API integrations."}
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : apis.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed border-border bg-muted/10">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Link2 size={24} className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-heading font-semibold text-muted-foreground">
                No API configurations found
              </p>
              <p className="text-xs font-body text-muted-foreground/60 mt-1">
                Use the form above to add your first API
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {apis.map((api) => (
                <div
                  key={api.id}
                  className={`rounded-2xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${
                    editingId === api.id
                      ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  {editingId === api.id ? (
                    <div>
                      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
                        <Edit3 size={14} className="text-primary" />
                        <span className="text-sm font-heading font-semibold text-foreground">
                          Edit API
                        </span>
                        <Badge className="ml-auto text-[10px] font-heading bg-primary/10 text-primary border border-primary/20 px-2">
                          Editing
                        </Badge>
                      </div>
                      <div className="p-6">
                        <form
                          className="space-y-4"
                          onSubmit={handleEditApiSubmit(saveEdit)}
                        >
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground">
                                API Name
                              </Label>
                              <Input className="font-body" {...registerEditApi("name")} />
                              {editApiErrors.name && (
                                <p className="text-xs text-destructive">{editApiErrors.name.message}</p>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <Label className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground">
                                Base URL
                              </Label>
                              <Input className="font-body" {...registerEditApi("baseUrl")} />
                              {editApiErrors.baseUrl && (
                                <p className="text-xs text-destructive">{editApiErrors.baseUrl.message}</p>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <Label className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground">
                                API Key
                              </Label>
                              <Input
                                type="password"
                                className="font-body"
                                {...registerEditApi("apiKey")}
                              />
                              {editApiErrors.apiKey && (
                                <p className="text-xs text-destructive">{editApiErrors.apiKey.message}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 pt-2">
                            <Button
                              type="submit"
                              disabled={isSaving}
                              className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
                            >
                              {isSaving && <Loader2 size={14} className="animate-spin" />}
                              Save Changes
                            </Button>
                            <Button
                              variant="outline"
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="font-heading text-sm"
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-heading font-semibold text-foreground truncate">
                            {api.name}
                          </p>
                          <p className="text-xs font-body text-muted-foreground mt-0.5 truncate">
                            {api.baseUrl}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <code className="rounded-lg bg-muted px-2.5 py-1 text-xs font-mono border border-border">
                            {maskApiKey(api.apiKey)}
                          </code>
                          <Badge
                            variant={api.status === "active" ? "default" : "secondary"}
                            className="text-[10px] font-heading uppercase tracking-wide px-2 py-0.5"
                          >
                            {api.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-border/50 pt-3 mt-0.5">
                        <button
                          onClick={() => toggleStatus(api.id)}
                          disabled={isSaving}
                          className="text-[11px] font-body text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          Toggle status
                        </button>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(api)}
                            disabled={isSaving}
                            className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                          >
                            <Edit3 size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteApi(api.id)}
                            disabled={isSaving}
                            className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminShell>
    </>
  );
}
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getCommunicatorConfig, saveCommunicatorConfig } from "@/api/communicatorConfigApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Edit3, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `api-${Date.now()}`;
};

const maskApiKey = (apiKey: string) => {
  if (!apiKey) return "Not set";
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}••••`;
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
};

export default function ApiIntegration() {
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
      const config = await getCommunicatorConfig<IntegrationConfigPayload>(
        "integrations",
      );
      return Array.isArray(config.apis) ? config.apis : [];
    },
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
          status: "active",
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
            status: api.status === "active" ? "inactive" : "active",
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

    const saved = await saveApis(nextApis, `API "${values.name.trim()}" updated`);
    if (saved) {
      cancelEdit();
    }
  };

  const isSaving = persistApis.isPending;

  return (
    <>
      <Breadcrumbs items={["Admin", "API Integration"]} />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              API Integration
            </h1>
            <p className="mt-2 text-muted-foreground">
              Manage external API connections persisted via communicator config
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Add New API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <form className="space-y-4" onSubmit={handleNewApiSubmit(addApi)}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div>
                <Label htmlFor="name">API Name</Label>
                <Input
                  id="name"
                  placeholder="Payment Gateway API"
                  {...registerNewApi("name")}
                />
                {newApiErrors.name && (
                  <p className="mt-1 text-xs text-destructive">
                    {newApiErrors.name.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  placeholder="https://api.example.com"
                  {...registerNewApi("baseUrl")}
                />
                {newApiErrors.baseUrl && (
                  <p className="mt-1 text-xs text-destructive">
                    {newApiErrors.baseUrl.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  {...registerNewApi("apiKey")}
                />
                {newApiErrors.apiKey && (
                  <p className="mt-1 text-xs text-destructive">
                    {newApiErrors.apiKey.message}
                  </p>
                )}
              </div>
            </div>
            <Button
              type="submit"
              disabled={
                isSaving || !newApi.name || !newApi.baseUrl || !newApi.apiKey
              }
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add API
            </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configured APIs ({apis.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {(error as Error).message || "Failed to load API integrations."}
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading API configurations...
              </div>
            ) : apis.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <p>No API configurations found.</p>
                <p className="mt-2 text-sm">Add your first API above.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {apis.map((api) => (
                  <div
                    key={api.id}
                    className="rounded-lg border p-6 transition-colors hover:bg-muted/50"
                  >
                    {editingId === api.id ? (
                      <div className="space-y-4">
                        <form
                          className="space-y-4"
                          onSubmit={handleEditApiSubmit(saveEdit)}
                        >
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                          <div>
                            <Label>Name</Label>
                            <Input
                              {...registerEditApi("name")}
                            />
                            {editApiErrors.name && (
                              <p className="mt-1 text-xs text-destructive">
                                {editApiErrors.name.message}
                              </p>
                            )}
                          </div>
                          <div>
                            <Label>Base URL</Label>
                            <Input
                              {...registerEditApi("baseUrl")}
                            />
                            {editApiErrors.baseUrl && (
                              <p className="mt-1 text-xs text-destructive">
                                {editApiErrors.baseUrl.message}
                              </p>
                            )}
                          </div>
                          <div>
                            <Label>API Key</Label>
                            <Input
                              type="password"
                              {...registerEditApi("apiKey")}
                            />
                            {editApiErrors.apiKey && (
                              <p className="mt-1 text-xs text-destructive">
                                {editApiErrors.apiKey.message}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" disabled={isSaving}>
                            {isSaving ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Save Changes
                          </Button>
                          <Button
                            variant="outline"
                            onClick={cancelEdit}
                            disabled={isSaving}
                          >
                            Cancel
                          </Button>
                        </div>
                        </form>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
                        <div>
                          <h3 className="text-xl font-bold">{api.name}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {api.baseUrl}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <code className="rounded bg-muted px-3 py-1 text-xs font-mono">
                            {maskApiKey(api.apiKey)}
                          </code>
                          <Badge
                            variant={
                              api.status === "active" ? "default" : "secondary"
                            }
                          >
                            {api.status.toUpperCase()}
                          </Badge>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEdit(api)}
                              disabled={isSaving}
                            >
                              <Edit3 className="mr-1 h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleStatus(api.id)}
                              disabled={isSaving}
                            >
                              Toggle Status
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteApi(api.id)}
                              disabled={isSaving}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

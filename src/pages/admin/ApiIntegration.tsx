import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getCommunicatorConfig, saveCommunicatorConfig } from "@/api/communicatorConfigApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Edit3, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  status: "active" | "inactive";
}

type ApiFormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
};

interface IntegrationConfigPayload {
  apis?: ApiConfig[];
}

const QUERY_KEY = ["communicator-config", "integrations"];
const EMPTY_FORM: ApiFormState = { name: "", baseUrl: "", apiKey: "" };

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
  const [newApi, setNewApi] = React.useState<ApiFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<ApiFormState>(EMPTY_FORM);

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

  const addApi = async () => {
    if (!newApi.name || !newApi.baseUrl || !newApi.apiKey) {
      toast.error("Please fill all API fields");
      return;
    }

    const saved = await saveApis(
      [
        ...apis,
        {
          id: buildId(),
          name: newApi.name.trim(),
          baseUrl: newApi.baseUrl.trim(),
          apiKey: newApi.apiKey.trim(),
          status: "active",
        },
      ],
      `API "${newApi.name.trim()}" saved`,
    );
    if (saved) {
      setNewApi(EMPTY_FORM);
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
    setEditForm({
      name: api.name,
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!editForm.name || !editForm.baseUrl || !editForm.apiKey) {
      toast.error("Please fill all API fields");
      return;
    }

    const nextApis = apis.map((api) =>
      api.id === editingId
        ? {
            ...api,
            name: editForm.name.trim(),
            baseUrl: editForm.baseUrl.trim(),
            apiKey: editForm.apiKey.trim(),
          }
        : api,
    );

    const saved = await saveApis(nextApis, `API "${editForm.name.trim()}" updated`);
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div>
                <Label htmlFor="name">API Name</Label>
                <Input
                  id="name"
                  placeholder="Payment Gateway API"
                  value={newApi.name}
                  onChange={(e) =>
                    setNewApi((current) => ({
                      ...current,
                      name: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  placeholder="https://api.example.com"
                  value={newApi.baseUrl}
                  onChange={(e) =>
                    setNewApi((current) => ({
                      ...current,
                      baseUrl: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={newApi.apiKey}
                  onChange={(e) =>
                    setNewApi((current) => ({
                      ...current,
                      apiKey: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <Button
              onClick={addApi}
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
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                          <div>
                            <Label>Name</Label>
                            <Input
                              value={editForm.name}
                              onChange={(e) =>
                                setEditForm((current) => ({
                                  ...current,
                                  name: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label>Base URL</Label>
                            <Input
                              value={editForm.baseUrl}
                              onChange={(e) =>
                                setEditForm((current) => ({
                                  ...current,
                                  baseUrl: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label>API Key</Label>
                            <Input
                              type="password"
                              value={editForm.apiKey}
                              onChange={(e) =>
                                setEditForm((current) => ({
                                  ...current,
                                  apiKey: e.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={saveEdit} disabled={isSaving}>
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

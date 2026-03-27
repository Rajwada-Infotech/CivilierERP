import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit3 } from "lucide-react";

interface ApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  status: "active" | "inactive";
}

const initialApis: ApiConfig[] = [
  {
    id: "1",
    name: "Payment Gateway",
    baseUrl: "https://api.paymentgateway.com",
    apiKey: "pg_1234567890abcdef",
    status: "active",
  },
  {
    id: "2",
    name: "SMS Service",
    baseUrl: "https://api.smsservice.com",
    apiKey: "sms_abcdef1234567890",
    status: "inactive",
  },
];

export default function ApiIntegration() {
  const [apis, setApis] = React.useState<ApiConfig[]>(initialApis);
  const [newApi, setNewApi] = React.useState({ name: "", baseUrl: "", apiKey: "" });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState({ name: "", baseUrl: "", apiKey: "" });

  const addApi = () => {
    if (newApi.name && newApi.baseUrl && newApi.apiKey) {
      const newId = Date.now().toString();
      setApis([
        ...apis,
        {
          id: newId,
          name: newApi.name,
          baseUrl: newApi.baseUrl,
          apiKey: newApi.apiKey,
          status: "active",
        },
      ]);
      setNewApi({ name: "", baseUrl: "", apiKey: "" });
    }
  };

  const deleteApi = (id: string) => {
    setApis(apis.filter((api) => api.id !== id));
  };

  const toggleStatus = (id: string) => {
    setApis(
      apis.map((api) =>
        api.id === id
          ? {
              ...api,
              status: api.status === "active" ? "inactive" : "active",
            }
          : api
      )
    );
  };

  const startEdit = (api: ApiConfig) => {
    setEditingId(api.id);
    setEditForm({ name: api.name, baseUrl: api.baseUrl, apiKey: api.apiKey });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = () => {
    if (editingId) {
      setApis(
        apis.map((api) =>
          api.id === editingId
            ? { ...api, ...editForm }
            : api
        )
      );
      setEditingId(null);
    }
  };

  const apiBeingEdited = editingId
    ? apis.find((api) => api.id === editingId)
    : null;

  return (
    <>
      <Breadcrumbs items={["Admin", "API Integration"]} />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">API Integration</h1>
            <p className="text-muted-foreground mt-2">Manage API connections and keys</p>
          </div>
        </div>

        {/* Add New API */}
        <Card>
          <CardHeader>
            <CardTitle>Add New API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="name">API Name</Label>
                <Input
                  id="name"
                  placeholder="Payment Gateway API"
                  value={newApi.name}
                  onChange={(e) => setNewApi({ ...newApi, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  placeholder="https://api.example.com"
                  value={newApi.baseUrl}
                  onChange={(e) => setNewApi({ ...newApi, baseUrl: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={newApi.apiKey}
                  onChange={(e) => setNewApi({ ...newApi, apiKey: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={addApi} disabled={!newApi.name || !newApi.baseUrl || !newApi.apiKey}>
              <Plus className="h-4 w-4 mr-2" />
              Add API
            </Button>
          </CardContent>
        </Card>

        {/* APIs List */}
        <Card>
          <CardHeader>
            <CardTitle>Configured APIs ({apis.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {apis.map((api) => (
                <div
                  key={api.id}
                  className="border rounded-lg p-6 hover:bg-muted/50 transition-colors"
                >
                  {editingId === api.id ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div>
                          <Label>Name</Label>
                          <Input
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm({ ...editForm, name: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label>Base URL</Label>
                          <Input
                            value={editForm.baseUrl}
                            onChange={(e) =>
                              setEditForm({ ...editForm, baseUrl: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label>API Key</Label>
                          <Input
                            type="password"
                            value={editForm.apiKey}
                            onChange={(e) =>
                              setEditForm({ ...editForm, apiKey: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={saveEdit}>Save Changes</Button>
                        <Button variant="outline" onClick={cancelEdit}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                      <div>
                        <h3 className="text-xl font-bold">{api.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {api.baseUrl}
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-end sm:items-center justify-between">
                        <code className="bg-muted px-3 py-1 rounded text-sm font-mono text-xs">
                          {api.apiKey.slice(0, 12)}...
                        </code>
                        <Badge variant={api.status === "active" ? "default" : "secondary"}>
                          {api.status.toUpperCase()}
                        </Badge>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(api)}
                          >
                            <Edit3 className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleStatus(api.id)}
                          >
                            Toggle Status
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteApi(api.id)}
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
            {apis.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No API configurations found.</p>
                <p className="text-sm mt-2">Add your first API above.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

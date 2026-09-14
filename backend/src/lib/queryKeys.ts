/**
 * Standardized React Query Keys
 * Ensures consistency across the ERP for caching and invalidation
 */
export const queryKeys = {
  transactions: {
    all: ['transactions'] as const,
    lists: () => [...queryKeys.transactions.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.transactions.lists(), { filters }] as const,
    details: () => [...queryKeys.transactions.all, 'detail'] as const,
    detail: (id: string | number) => [...queryKeys.transactions.details(), id] as const,
  },
  payments: {
    all: ['payments'] as const,
    lists: () => [...queryKeys.payments.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.payments.lists(), { filters }] as const,
    details: () => [...queryKeys.payments.all, 'detail'] as const,
    detail: (id: string | number) => [...queryKeys.payments.details(), id] as const,
  },
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string | number) => [...queryKeys.projects.details(), id] as const,
  },
  companies: {
    all: ['companies'] as const,
    options: () => [...queryKeys.companies.all, 'options'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: () => [...queryKeys.dashboard.all, 'summary'] as const,
    widgets: (scope: string) => [...queryKeys.dashboard.all, 'widgets', scope] as const,
  },
  workflow: {
    all: ['workflow'] as const,
    definitions: () => [...queryKeys.workflow.all, 'definitions'] as const,
    definition: (id: string | number) => [...queryKeys.workflow.definitions(), id] as const,
    transitions: (status: string) => [...queryKeys.workflow.all, 'transitions', status] as const,
  },
  audit: {
    all: ['audit'] as const,
    logs: () => [...queryKeys.audit.all, 'logs'] as const,
    log: (filters: Record<string, unknown>) => [...queryKeys.audit.logs(), { filters }] as const,
    trail: (recordId: string | number) => [...queryKeys.audit.all, 'trail', recordId] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    lists: () => [...queryKeys.notifications.all, 'list'] as const,
    list: (userId: string | number) => [...queryKeys.notifications.lists(), { userId }] as const,
    unreadCount: (userId: string | number) => [...queryKeys.notifications.all, 'unread', { userId }] as const,
  },
};
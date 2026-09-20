/**
 * Every React Query key in one place.
 *
 * Scattered inline keys are how a mutation ends up invalidating a cache entry
 * that no longer exists under that name. Keys are arrays with a stable prefix
 * so a whole domain can be invalidated at once: `qk.jobs.all` covers every
 * filtered job list.
 */

export type JobFilters = { status?: string; q?: string; clientId?: string };
export type SearchFilters = Record<string, string | number | boolean | undefined>;

export const qk = {
  me: ['me'] as const,

  categories: ['categories'] as const,
  featuredProviders: ['providers', 'featured'] as const,
  searchServices: (filters: SearchFilters) => ['search', 'services', filters] as const,
  providerProfile: (slug: string) => ['providers', 'profile', slug] as const,
  service: (id: string) => ['services', id] as const,

  customer: {
    home: ['customer', 'home'] as const,
    requests: ['customer', 'requests'] as const,
    request: (id: string) => ['customer', 'requests', id] as const,
  },

  provider: {
    dashboard: ['provider', 'dashboard'] as const,
    profile: ['provider', 'profile'] as const,
    services: ['provider', 'services'] as const,
    taxSettings: ['provider', 'tax-settings'] as const,
    calendar: (from: string, to: string) => ['provider', 'calendar', from, to] as const,
  },

  clients: {
    all: ['clients'] as const,
    list: (q?: string) => ['clients', 'list', q ?? ''] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
  },

  jobs: {
    all: ['jobs'] as const,
    list: (filters: JobFilters) => ['jobs', 'list', filters] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
  },

  quotes: {
    all: ['quotes'] as const,
    list: (status?: string) => ['quotes', 'list', status ?? ''] as const,
    detail: (id: string) => ['quotes', 'detail', id] as const,
  },

  invoices: {
    all: ['invoices'] as const,
    list: (status?: string) => ['invoices', 'list', status ?? ''] as const,
    detail: (id: string) => ['invoices', 'detail', id] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    list: ['notifications', 'list'] as const,
  },

  billing: {
    plans: ['billing', 'plans'] as const,
    subscription: ['billing', 'subscription'] as const,
  },

  account: {
    profile: ['account', 'profile'] as const,
    whatsapp: ['account', 'whatsapp-consent'] as const,
  },
} as const;

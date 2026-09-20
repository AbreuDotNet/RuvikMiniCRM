/**
 * The shapes the API actually returns.
 *
 * These are adapters over a contract owned by `apps/api`, not a second copy of
 * it: nothing here decides anything. Prices, taxes, statuses and permissions
 * arrive computed from the server and are rendered as given. Where a value
 * looks like a rule — `allowedNextStatuses`, `canReview`, `balanceCents` — it
 * is the server's answer, and the app must not recompute it.
 */

export type Role = 'admin' | 'provider' | 'customer';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  mfaEnabled: boolean;
  whatsappOptIn: boolean;
  providerId?: string | null;
  providerStatus?: string | null;
  subscriptionStatus?: string | null;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
  sessionAal?: 'aal1' | 'mfa';
  adminMfaRequired?: boolean;
}

export interface Paginated<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/* ------------------------------- discovery -------------------------------- */

export type PricingType = 'fixed' | 'starting_at' | 'request_quote';

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  description: string | null;
  serviceCount: number;
}

export interface ServiceCard {
  id: string;
  title: string;
  shortDescription: string | null;
  pricingType: PricingType;
  priceCents: number | null;
  currency: string;
  estimatedDurationMin: number | null;
  category: { slug: string; name: string };
  provider: {
    id: string;
    slug: string;
    businessName: string;
    city: string | null;
    ratingAvg: number;
    ratingCount: number;
    verificationStatus: string;
  };
}

export interface FeaturedProvider {
  id: string;
  slug: string;
  businessName: string;
  tagline: string | null;
  city: string | null;
  ratingAvg: number;
  ratingCount: number;
  verificationStatus: string;
  completedJobs: number;
  primaryCategory: string | null;
}

export interface PublicProvider {
  id: string;
  slug: string;
  businessName: string;
  tagline: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  serviceRadiusKm: number;
  workingHours: Record<string, { open: string; close: string; closed?: boolean }>;
  certifications: string[];
  yearsExperience: number | null;
  verificationStatus: string;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  memberSince: string;
  logoUrl: string | null;
  services: {
    id: string;
    title: string;
    shortDescription: string | null;
    pricingType: PricingType;
    priceCents: number | null;
    currency: string;
    estimatedDurationMin: number | null;
    category: { slug: string; name: string };
  }[];
  reviews: {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    customerName: string;
    providerReply: string | null;
  }[];
  portfolio: { id: string; caption: string | null; url: string }[];
}

export interface ServiceDetail {
  id: string;
  title: string;
  description: string | null;
  shortDescription: string | null;
  pricingType: PricingType;
  priceCents: number | null;
  currency: string;
  estimatedDurationMin: number | null;
  coverageArea: string | null;
  category: { slug: string; name: string };
  provider: {
    id: string;
    slug: string;
    businessName: string;
    city: string | null;
    ratingAvg: number;
    ratingCount: number;
    verificationStatus: string;
  };
}

/* -------------------------------- customer -------------------------------- */

export interface CustomerHome {
  recentRequests: {
    id: string;
    reference: string;
    title: string;
    status: string;
    createdAt: string;
    providerName: string;
    providerSlug: string;
  }[];
  unreadNotifications: number;
}

export interface CustomerRequestRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string;
  quoteCount: number;
  invoiceCount: number;
  canReview: boolean;
  provider: { id: string; slug: string; businessName: string; ratingAvg: number };
}

export interface CustomerRequestDetail {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  addressLine: string | null;
  city: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string;
  canReview: boolean;
  myReview: { id: string; rating: number; comment: string | null } | null;
  provider: { id: string; slug: string; businessName: string; phone: string | null; ratingAvg: number };
  quotes: {
    id: string; number: string; status: string; totalCents: number;
    currency: string; validUntil: string | null; sentAt: string | null; acceptedAt: string | null;
  }[];
  invoices: {
    id: string; number: string; status: string; totalCents: number;
    amountPaidCents: number; currency: string; dueDate: string | null;
  }[];
  comments: { id: string; body: string; authorName: string; createdAt: string }[];
}

/* -------------------------------- provider -------------------------------- */

export interface ProviderDashboard {
  newLeads: number;
  upcomingJobs: number;
  jobsByStatus: Record<string, number>;
  outstandingCents: number;
  overdueCents: number;
  monthlyActivity: { month: string; completed: number; revenueCents: number }[];
  upcomingSchedule: {
    id: string; reference: string; title: string;
    scheduledStart: string | null; status: string; clientName: string;
  }[];
  subscription: {
    status: string; planName: string; priceCents: number;
    currency: string; currentPeriodEnd: string | null;
  } | null;
}

export interface BusinessProfile {
  id: string;
  slug: string;
  businessName: string;
  tagline: string | null;
  bio: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string;
  postalCode: string | null;
  serviceRadiusKm: number;
  yearsExperience: number | null;
  certifications: string[];
  workingHours: Record<string, { open: string; close: string; closed?: boolean }>;
  isPublished: boolean;
  verificationStatus: string;
  ratingAvg: number;
  ratingCount: number;
  logoUrl: string | null;
}

export interface ProviderService {
  id: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  pricingType: PricingType;
  priceCents: number | null;
  currency: string;
  estimatedDurationMin: number | null;
  coverageArea: string | null;
  status: 'draft' | 'active' | 'paused';
  category: { id: string; slug: string; name: string } | null;
  createdAt: string;
}

export interface TaxSettings {
  taxState: string | null;
  defaultTaxRateBp: number;
  jurisdictionNote: string | null;
}

/* ----------------------------------- CRM ---------------------------------- */

export interface ClientRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  isPlatformCustomer: boolean;
  jobCount: number;
  lastJobAt: string | null;
  createdAt: string;
}

export interface ClientDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  addressLine: string | null;
  city: string | null;
  region?: string | null;
  postalCode?: string | null;
  isPlatformCustomer: boolean;
  createdAt: string;
  jobs: {
    id: string; reference: string; title: string; status: string;
    scheduledStart: string | null; completedAt: string | null; createdAt: string;
  }[];
}

export interface JobRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledStart: string | null;
  completedAt: string | null;
  city: string | null;
  createdAt: string;
  client: { id: string; fullName: string; phone: string | null };
  quoteCount: number;
  invoiceCount: number;
}

export interface JobDetail {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  /** The server's list of legal next steps. Never inferred here. */
  allowedNextStatuses: string[];
  source: string;
  addressLine: string | null;
  city: string | null;
  region?: string | null;
  postalCode?: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string;
  serviceTitle: string | null;
  client: {
    id: string; fullName: string; email: string | null;
    phone: string | null; whatsappPhone: string | null;
  };
  notes: {
    id: string; body: string; visibility: 'internal' | 'customer';
    authorName: string; createdAt: string;
  }[];
  quotes: {
    id: string; number: string; status: string; totalCents: number;
    currency: string; validUntil: string | null;
  }[];
  invoices: {
    id: string; number: string; status: string; totalCents: number;
    amountPaidCents: number; currency: string;
  }[];
  timeline: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
}

export interface CalendarJob {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string | null;
  city: string | null;
  clientName: string;
}

/* ------------------------------ billing docs ------------------------------ */

export type TaxTreatment = 'taxable' | 'exempt' | 'not_subject' | 'manual_adjustment';
export type LineKind =
  | 'materials' | 'labour' | 'equipment' | 'fee' | 'reimbursement' | 'deposit' | 'other';

export interface DocumentLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  lineTotalCents: number;
  taxTreatment?: TaxTreatment;
  lineKind?: LineKind;
  taxReason?: string | null;
  taxExemptionCertificate?: string | null;
}

/** What a quote or invoice line looks like on the way in. */
export interface LineInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  taxTreatment: TaxTreatment;
  lineKind: LineKind;
  taxReason?: string | null;
  taxExemptionCertificate?: string | null;
}

export interface QuoteRow {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  currency: string;
  validUntil: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  job: { id: string; title: string };
  clientName: string;
  invoice: { id: string; number: string; status: string } | null;
}

export interface QuoteDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  taxableBaseCents: number;
  untaxedBaseCents: number;
  taxJurisdiction: string | null;
  invoice: { id: string; number: string; status: string } | null;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  pdfUrl: string | null;
  pdfSha256: string | null;
  job: { id: string; title: string };
  provider: { businessName: string; tagline: string | null; city: string | null; phone: string | null };
  client: { fullName: string; email?: string; phone?: string; city: string | null };
  lines: DocumentLine[];
}

export interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  clientName: string;
  job: { id: string; title: string } | null;
}

export interface InvoiceList extends Paginated<InvoiceRow> {
  summary: { outstandingCents: number; paidCents: number };
}

export interface InvoiceDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  taxableBaseCents: number;
  untaxedBaseCents: number;
  taxJurisdiction: string | null;
  amountPaidCents: number;
  balanceCents: number;
  notes: string | null;
  sentAt: string | null;
  paidAt: string | null;
  firstViewedAt?: string | null;
  pdfUrl: string | null;
  pdfSha256: string | null;
  serviceAddress?: {
    addressLine: string | null; city: string | null;
    region: string | null; postalCode: string | null;
  } | null;
  job: { id: string; title: string } | null;
  provider: { businessName: string; tagline: string | null; city: string | null; phone: string | null };
  client: { fullName: string; email?: string; phone?: string; city: string | null };
  lines: DocumentLine[];
  payments: {
    id?: string;
    receiptNumber?: string | null;
    receiptPrintedAt?: string | null;
    amountCents: number;
    status: string;
    method: string | null;
    paidAt: string | null;
  }[];
}

export interface PaymentResult {
  status: string;
  balanceCents: number;
  payment: {
    id: string; receiptNumber: string; amountCents: number; method: string; paidAt: string;
  };
}

/* ------------------------------ notifications ----------------------------- */

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList extends Paginated<NotificationRow> {
  unreadCount: number;
}

/* --------------------------------- billing -------------------------------- */

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  maxServices: number | null;
  features: string[];
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  plan: {
    code: string; name: string; priceCents: number; currency: string; interval: string;
    maxServices?: number | null;
    features?: string[];
  };
  payments: {
    amountCents: number; currency: string; status: string;
    method: string | null; paidAt: string | null; createdAt: string;
  }[];
}

export interface CheckoutIntent {
  subscriptionId: string;
  status: string;
  /**
   * Null on a free plan: there is nothing to pay, so it is already live.
   * When a hosted gateway is wired in, the URL to open arrives here too —
   * activation stays the webhook's job, never the client's.
   */
  checkout: {
    reference: string;
    amountCents: number;
    currency: string;
    url?: string | null;
  } | null;
}

/* --------------------------------- account -------------------------------- */

export interface AccountProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  locale: string;
  city: string | null;
  region: string | null;
  addressLine: string | null;
  role: Role;
  createdAt: string;
}

export interface WhatsAppConsent {
  optedIn: boolean;
  phone: string | null;
  /** Note the names: `optInAt` / `optOutAt`, not `optedInAt`. */
  optInAt: string | null;
  optOutAt: string | null;
}

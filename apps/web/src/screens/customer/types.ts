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
  pricingType: 'fixed' | 'starting_at' | 'request_quote';
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
  services: Array<{
    id: string;
    title: string;
    shortDescription: string | null;
    pricingType: 'fixed' | 'starting_at' | 'request_quote';
    priceCents: number | null;
    currency: string;
    estimatedDurationMin: number | null;
    category: { slug: string; name: string };
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    customerName: string;
    providerReply: string | null;
  }>;
  portfolio: Array<{ id: string; caption: string | null; url: string }>;
}

export interface CustomerRequest {
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

export interface Paginated<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export function priceLabel(
  pricingType: ServiceCard['pricingType'],
  priceCents: number | null,
  currency: string,
  format: (c: number | null | undefined, cur?: string) => string,
): string {
  if (pricingType === 'request_quote') return 'On request';
  return format(priceCents, currency);
}

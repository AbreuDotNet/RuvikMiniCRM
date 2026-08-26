import type { TabItem } from './Shell';

/**
 * Bottom-tab sets per role. Five items is the practical maximum on a phone
 * before the labels stop being readable.
 */
export const CUSTOMER_TABS: TabItem[] = [
  { to: '/home', label: 'Home', icon: 'home' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/requests', label: 'Requests', icon: 'clipboard' },
  { to: '/notifications', label: 'Messages', icon: 'chat' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

export const PROVIDER_TABS: TabItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/clients', label: 'Clients', icon: 'users' },
  { to: '/jobs', label: 'Jobs', icon: 'briefcase' },
  { to: '/invoices', label: 'Invoices', icon: 'receipt' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

export const ADMIN_TABS: TabItem[] = [
  { to: '/admin', label: 'Overview', icon: 'grid' },
  { to: '/admin/providers', label: 'Providers', icon: 'briefcase' },
  { to: '/admin/users', label: 'Users', icon: 'users' },
  { to: '/admin/reviews', label: 'Reviews', icon: 'star' },
  { to: '/admin/audit', label: 'Audit', icon: 'shield' },
];

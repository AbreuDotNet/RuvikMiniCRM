import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth, type Role } from './state/auth';
import { ToastProvider, ThemeProvider, useToast } from './state/ui';
import { Spinner } from './components/ui';
import { registerServiceWorker } from './lib/serviceWorker';

import { AuthScreen } from './screens/auth/AuthScreen';

import { CustomerHomeScreen } from './screens/customer/HomeScreen';
import { SearchScreen } from './screens/customer/SearchScreen';
import { ProviderProfileScreen } from './screens/customer/ProviderProfileScreen';
import { ServiceDetailScreen } from './screens/customer/ServiceDetailScreen';
import { RequestQuoteScreen } from './screens/customer/RequestQuoteScreen';
import { RequestsScreen } from './screens/customer/RequestsScreen';
import { RequestDetailScreen } from './screens/customer/RequestDetailScreen';

import { ProviderDashboardScreen } from './screens/provider/DashboardScreen';
import { JobsScreen } from './screens/provider/JobsScreen';
import { JobDetailScreen } from './screens/provider/JobDetailScreen';
import { JobCreateScreen } from './screens/provider/JobCreateScreen';
import { QuoteBuilderScreen } from './screens/provider/QuoteBuilderScreen';
import { ClientsScreen, ClientDetailScreen } from './screens/provider/ClientsScreen';
import { InvoicesScreen, InvoiceBuilderScreen } from './screens/provider/InvoicesScreen';
import { CalendarScreen } from './screens/provider/CalendarScreen';
import { SubscriptionScreen } from './screens/provider/SubscriptionScreen';
import { BusinessProfileScreen, ServicesScreen } from './screens/provider/BusinessProfileScreen';

import { QuoteViewScreen } from './screens/shared/QuoteViewScreen';
import { InvoiceViewScreen } from './screens/shared/InvoiceViewScreen';
import { NotificationsScreen } from './screens/shared/NotificationsScreen';
import { SettingsScreen } from './screens/shared/SettingsScreen';
import { ChangePasswordScreen, MfaScreen } from './screens/shared/SecurityScreens';

import {
  AdminDashboardScreen, AdminProvidersScreen, AdminUsersScreen,
  AdminReviewsScreen, AdminAuditScreen,
} from './screens/admin/AdminScreens';

import './styles/theme.css';
import './styles/app.css';

function FullScreenLoader() {
  return (
    <div
      style={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center',
        background: 'var(--bg)', color: 'var(--brand)',
      }}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading Ruvik…</span>
      <Spinner size={32} />
    </div>
  );
}

/** Blocks a route until the session is known, then enforces the role. */
function Protected({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous' || !user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;

  return <>{children}</>;
}

function homeFor(role: Role): string {
  if (role === 'provider') return '/dashboard';
  if (role === 'admin') return '/admin';
  return '/home';
}

function RootRedirect() {
  const { user, status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (!user) return <Navigate to="/signin" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

function SignInRoute() {
  const { user, status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return <AuthScreen />;
}

/**
 * A client-side navigation replaces the page without any of the things a real
 * one does: focus stays wherever it was, the scroll position carries over, and
 * assistive tech is told nothing. This restores all three.
 *
 * Rendered after the routes so the new screen's Shell has already set the
 * title by the time this effect reads it.
 */
function RouteFocus() {
  const { pathname } = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const firstRender = useRef(true);

  useEffect(() => {
    // The initial load is a real page load; the browser handles it.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // preventScroll is load-bearing. <main> starts below the sticky header, so
    // a plain focus() makes the browser scroll it up to the top of the
    // scrollport — landing the page at exactly the header's height and undoing
    // the reset on the line below. Reset after focusing, for good measure.
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    setAnnouncement(document.title);
  }, [pathname]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}

/**
 * Installs the service worker and reports a pending update. The new build is
 * not forced in: it takes over on the next cold start, so nobody loses a quote
 * they were part way through writing.
 */
function ServiceWorkerUpdates() {
  const { notify } = useToast();

  useEffect(
    () => registerServiceWorker(() => {
      notify('Ruvik has been updated. Close and reopen the app to get the new version.');
    }),
    [notify],
  );

  return null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/signin" element={<SignInRoute />} />

      {/* -------------------------------------------------------- customer */}
      <Route path="/home" element={<Protected roles={['customer']}><CustomerHomeScreen /></Protected>} />
      <Route path="/search" element={<Protected roles={['customer']}><SearchScreen /></Protected>} />
      <Route path="/providers/:slug" element={<Protected roles={['customer']}><ProviderProfileScreen /></Protected>} />
      <Route path="/services/:id" element={<Protected roles={['customer']}><ServiceDetailScreen /></Protected>} />
      <Route path="/request" element={<Protected roles={['customer']}><RequestQuoteScreen /></Protected>} />
      <Route path="/requests" element={<Protected roles={['customer']}><RequestsScreen /></Protected>} />
      <Route path="/requests/:id" element={<Protected roles={['customer']}><RequestDetailScreen /></Protected>} />

      {/* -------------------------------------------------------- provider */}
      <Route path="/dashboard" element={<Protected roles={['provider']}><ProviderDashboardScreen /></Protected>} />
      <Route path="/jobs" element={<Protected roles={['provider']}><JobsScreen /></Protected>} />
      <Route path="/jobs/new" element={<Protected roles={['provider']}><JobCreateScreen /></Protected>} />
      <Route path="/jobs/:id" element={<Protected roles={['provider']}><JobDetailScreen /></Protected>} />
      <Route path="/clients" element={<Protected roles={['provider']}><ClientsScreen /></Protected>} />
      <Route path="/clients/:id" element={<Protected roles={['provider']}><ClientDetailScreen /></Protected>} />
      <Route path="/quotes/new" element={<Protected roles={['provider']}><QuoteBuilderScreen /></Protected>} />
      <Route path="/invoices" element={<Protected roles={['provider']}><InvoicesScreen /></Protected>} />
      <Route path="/invoices/new" element={<Protected roles={['provider']}><InvoiceBuilderScreen /></Protected>} />
      <Route path="/calendar" element={<Protected roles={['provider']}><CalendarScreen /></Protected>} />
      <Route path="/subscription" element={<Protected roles={['provider']}><SubscriptionScreen /></Protected>} />
      <Route path="/profile/business" element={<Protected roles={['provider']}><BusinessProfileScreen /></Protected>} />
      <Route path="/services" element={<Protected roles={['provider']}><ServicesScreen /></Protected>} />

      {/* ---------------------------------------------------------- shared */}
      <Route
        path="/quotes/:id"
        element={<Protected roles={['customer', 'provider']}><QuoteViewScreen /></Protected>}
      />
      <Route
        path="/invoices/:id"
        element={<Protected roles={['customer', 'provider']}><InvoiceViewScreen /></Protected>}
      />
      <Route
        path="/notifications"
        element={<Protected roles={['customer', 'provider', 'admin']}><NotificationsScreen /></Protected>}
      />
      <Route
        path="/profile"
        element={<Protected roles={['customer', 'provider', 'admin']}><SettingsScreen /></Protected>}
      />
      <Route
        path="/security/password"
        element={<Protected roles={['customer', 'provider', 'admin']}><ChangePasswordScreen /></Protected>}
      />
      <Route
        path="/security/mfa"
        element={<Protected roles={['customer', 'provider', 'admin']}><MfaScreen /></Protected>}
      />

      {/* ----------------------------------------------------------- admin */}
      <Route path="/admin" element={<Protected roles={['admin']}><AdminDashboardScreen /></Protected>} />
      <Route path="/admin/providers" element={<Protected roles={['admin']}><AdminProvidersScreen /></Protected>} />
      <Route path="/admin/users" element={<Protected roles={['admin']}><AdminUsersScreen /></Protected>} />
      <Route path="/admin/reviews" element={<Protected roles={['admin']}><AdminReviewsScreen /></Protected>} />
      <Route path="/admin/audit" element={<Protected roles={['admin']}><AdminAuditScreen /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
            <RouteFocus />
            <ServiceWorkerUpdates />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

import { type ReactNode, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useToast } from '../state/ui';

export interface TabItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
}

interface ShellProps {
  title: string;
  tabs: TabItem[];
  children: ReactNode;
  back?: boolean | string;
  action?: ReactNode;
  flush?: boolean;
}

/**
 * Names the browser tab and history entry after the current screen. Without
 * it every route shares the index title, so history and tab strips are
 * unreadable and a screen reader announces nothing on navigation.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Ruvik`;
  }, [title]);
}

export function Shell({ title, tabs, children, back, action, flush }: ShellProps) {
  const navigate = useNavigate();
  useDocumentTitle(title);

  return (
    <div className="app-shell app-shell--railed">
      <a href="#main" className="skip-link">Skip to main content</a>

      <TabBar tabs={tabs} />

      <div className="railed-body">
        <header className="app-header">
          <div className="app-header__inner">
            {/* No spacer when there is no back button: the title is
                left-aligned, so it should start at the content margin. */}
            {back && (
              <button
                type="button"
                className="app-header__action app-header__action--back"
                onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
                aria-label="Go back"
              >
                <Icon name="back" size={20} />
              </button>
            )}

            <h1 className="app-header__title">{title}</h1>

            {action}
          </div>
        </header>

        {/* tabIndex lets RouteFocus move focus here after a navigation; the
            router swaps the DOM without the browser resetting focus itself. */}
        <main className={flush ? 'app-main app-main--flush' : 'app-main'} id="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <ToastRegion />
    </div>
  );
}

function TabBar({ tabs }: { tabs: TabItem[] }) {
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to.split('/').length <= 2}
          className={({ isActive }) => `tab-bar__item${isActive ? ' is-active' : ''}`}
        >
          {({ isActive }) => (
            <>
              <Icon name={tab.icon} size={22} strokeWidth={isActive ? 2 : 1.7} />
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className="tab-bar__badge" aria-label={`${tab.badge} unread`}>
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              ) : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Toasts announce politely so a screen reader hears them without stealing focus. */
export function ToastRegion() {
  const { toasts } = useToast();
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.tone !== 'default' ? ` toast--${toast.tone}` : ''}`}>
          <Icon
            name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'}
            size={18}
          />
          <span className="grow">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Header route to the account screen. The admin tab bar is full at five
 * items, so admins reach their own settings — sign out, password, and the
 * two-factor enrolment their privileged actions require — from here.
 */
export function AccountAction() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="app-header__action"
      onClick={() => navigate('/profile')}
      aria-label="Account and settings"
    >
      <Icon name="user" size={20} />
    </button>
  );
}

/** Header button for the notification bell, with an unread count. */
export function BellAction({ unread }: { unread: number }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="app-header__action"
      onClick={() => navigate('/notifications')}
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Icon name="bell" size={20} />
      {unread > 0 && <span className="app-header__badge">{unread > 9 ? '9+' : unread}</span>}
    </button>
  );
}

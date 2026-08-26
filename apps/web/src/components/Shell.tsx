import { type ReactNode } from 'react';
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

export function Shell({ title, tabs, children, back, action, flush }: ShellProps) {
  const navigate = useNavigate();

  return (
    <div className="app-shell app-shell--railed">
      <a href="#main" className="skip-link">Skip to main content</a>

      <TabBar tabs={tabs} />

      <div className="railed-body">
        <header className="app-header">
          <div className="app-header__inner">
            {back ? (
              <button
                type="button"
                className="app-header__action"
                onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
                aria-label="Go back"
              >
                <Icon name="back" size={20} />
              </button>
            ) : (
              <span style={{ width: 40, flexShrink: 0 }} aria-hidden="true" />
            )}

            <h1 className="app-header__title">{title}</h1>

            {action ?? <span style={{ width: 40, flexShrink: 0 }} aria-hidden="true" />}
          </div>
        </header>

        <main className={flush ? 'app-main app-main--flush' : 'app-main'} id="main">
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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS, PROVIDER_TABS, ADMIN_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, TextField, Avatar, Pill, Banner, Modal, ConfirmDialog, SkeletonList,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError, getAccessToken } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useToast, useTheme, type ThemeChoice } from '../../state/ui';
import { formatDate } from '../../lib/format';

interface Consent {
  optedIn: boolean;
  phone: string | null;
  optInAt: string | null;
  optOutAt: string | null;
}

export function SettingsScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { notify } = useToast();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [consentOpen, setConsentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const consent = useApi(() => api.get<Consent>('/account/whatsapp-consent'), []);

  const tabs = user?.role === 'provider' ? PROVIDER_TABS
    : user?.role === 'admin' ? ADMIN_TABS : CUSTOMER_TABS;

  const optOut = async () => {
    try {
      await api.delete('/account/whatsapp-consent');
      notify('WhatsApp messages turned off.', 'success');
      consent.reload();
      await refreshUser();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not update your preference.', 'error');
    }
  };

  /**
   * Data export is fetched with the access token and saved client-side, so
   * the file never passes through a third party.
   */
  const exportData = async () => {
    try {
      const response = await fetch('/api/v1/account/export', {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ruvik-data-export.json';
      link.click();
      URL.revokeObjectURL(url);
      notify('Your data export has downloaded.', 'success');
    } catch {
      notify('We could not prepare your export. Please try again.', 'error');
    }
  };

  if (!user) return null;

  return (
    <Shell title="Profile" tabs={tabs}>
      <div className="card card--pad" style={{ marginBottom: 'var(--s5)' }}>
        <div className="row">
          <Avatar name={user.fullName} size="lg" />
          <div className="grow">
            <h2>{user.fullName}</h2>
            <p className="small muted">{user.email}</p>
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 6 }}>
              <Pill tone="brand">{user.role}</Pill>
              {user.mfaEnabled && <Pill tone="success"><Icon name="lock" size={11} /> 2FA on</Pill>}
            </div>
          </div>
        </div>
      </div>

      {user.role === 'provider' && (
        <section className="section">
          <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Business</h3>
          <div className="list-group">
            <SettingRow icon="briefcase" label="Business profile" onClick={() => navigate('/profile/business')} />
            <SettingRow icon="grid" label="Service listings" onClick={() => navigate('/services')} />
            <SettingRow icon="calendar" label="Calendar" onClick={() => navigate('/calendar')} />
            <SettingRow
              icon="receipt"
              label="Subscription and billing"
              value={user.subscriptionStatus ?? 'None'}
              onClick={() => navigate('/subscription')}
            />
          </div>
        </section>
      )}

      <section className="section">
        <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Notifications</h3>
        <div className="card card--pad">
          {consent.loading ? (
            <SkeletonList rows={1} />
          ) : (
            <>
              <div className="row row--between" style={{ marginBottom: 'var(--s3)' }}>
                <div className="row" style={{ gap: 'var(--s3)' }}>
                  <div
                    className="avatar avatar--sm"
                    style={{ background: consent.data?.optedIn ? '#25D366' : 'var(--bg-inset)', color: consent.data?.optedIn ? '#06301A' : 'var(--text-subtle)' }}
                  >
                    <Icon name="whatsapp" size={18} />
                  </div>
                  <div>
                    <div className="strong small">WhatsApp messages</div>
                    <div className="tiny subtle">
                      {consent.data?.optedIn
                        ? `On since ${formatDate(consent.data.optInAt)}`
                        : 'Off — you will only get in-app notifications'}
                    </div>
                  </div>
                </div>
                <Pill tone={consent.data?.optedIn ? 'success' : 'neutral'}>
                  {consent.data?.optedIn ? 'On' : 'Off'}
                </Pill>
              </div>

              <p className="tiny subtle" style={{ marginBottom: 'var(--s3)' }}>
                We only send quotes, invoices and appointment reminders — never marketing.
                You can turn this off at any time, or reply STOP on WhatsApp.
              </p>

              {consent.data?.optedIn ? (
                <Button variant="secondary" block onClick={optOut}>Turn off WhatsApp messages</Button>
              ) : (
                <Button variant="whatsapp" block icon="whatsapp" onClick={() => setConsentOpen(true)}>
                  Turn on WhatsApp messages
                </Button>
              )}
            </>
          )}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Appearance</h3>
        <div className="segmented">
          {(['system', 'light', 'dark'] as ThemeChoice[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__option${theme === option ? ' is-active' : ''}`}
              onClick={() => setTheme(option)}
              aria-pressed={theme === option}
            >
              {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Security</h3>
        <div className="list-group">
          <SettingRow icon="lock" label="Change password" onClick={() => navigate('/security/password')} />
          <SettingRow
            icon="shield"
            label="Two-factor authentication"
            value={user.mfaEnabled ? 'On' : 'Off'}
            onClick={() => navigate('/security/mfa')}
          />
        </div>
      </section>

      <section className="section">
        <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Privacy</h3>
        <div className="list-group">
          <SettingRow icon="download" label="Download my data" onClick={exportData} />
          <SettingRow icon="trash" label="Delete my account" danger onClick={() => setDeleteOpen(true)} />
        </div>
        <p className="tiny subtle" style={{ marginTop: 'var(--s3)' }}>
          Your export includes your profile, requests, reviews, notifications and consent history.
        </p>
      </section>

      <Button variant="ghost" block icon="logout" onClick={() => setLogoutOpen(true)}>
        Sign out
      </Button>

      <p className="tiny subtle center" style={{ marginTop: 'var(--s6)' }}>Ruvik v1.0</p>

      <WhatsAppConsentModal
        open={consentOpen}
        defaultPhone={user.phone ?? ''}
        onClose={() => setConsentOpen(false)}
        onDone={() => {
          setConsentOpen(false);
          notify('WhatsApp messages turned on.', 'success');
          consent.reload();
          void refreshUser();
        }}
      />

      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDone={async () => { setDeleteOpen(false); await logout(); }}
      />

      <ConfirmDialog
        open={logoutOpen}
        title="Sign out?"
        body="You will need to sign in again on this device."
        confirmLabel="Sign out"
        onConfirm={() => { void logout(); }}
        onCancel={() => setLogoutOpen(false)}
      />
    </Shell>
  );
}

function SettingRow({
  icon, label, value, danger, onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="list-item" onClick={onClick}>
      <Icon name={icon} size={19} className={danger ? undefined : 'muted'} />
      <span
        className="grow list-item__title"
        style={danger ? { color: 'var(--danger)' } : undefined}
      >
        {label}
      </span>
      {value && <span className="small subtle" style={{ textTransform: 'capitalize' }}>{value}</span>}
      <Icon name="chevron" size={17} className="subtle" />
    </button>
  );
}

/**
 * WhatsApp opt-in requires an affirmative tick. The checkbox starts unchecked
 * — a pre-ticked box would not be valid consent under WhatsApp policy or GDPR.
 */
function WhatsAppConsentModal({
  open, defaultPhone, onClose, onDone,
}: { open: boolean; defaultPhone: string; onClose: () => void; onDone: () => void }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/account/whatsapp-consent', { phone: phone.trim(), acknowledged: true });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save your preference.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Turn on WhatsApp messages" onClose={onClose}>
      {error && <div style={{ marginBottom: 'var(--s4)' }}><Banner tone="danger">{error}</Banner></div>}

      <p className="modal__body">
        We will send quotes, invoices and appointment reminders to this number using the
        official WhatsApp Business service.
      </p>

      <TextField
        label="WhatsApp number"
        type="tel"
        inputMode="tel"
        placeholder="+18095551234"
        hint="Include your country code."
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        autoFocus
      />

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span className="small">
          I agree to receive transactional WhatsApp messages from Ruvik at this number.
          I can turn this off at any time in settings, or by replying STOP.
        </span>
      </label>

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="whatsapp"
          onClick={submit}
          loading={busy}
          disabled={!acknowledged || !phone.trim()}
        >
          Turn on
        </Button>
      </div>
    </Modal>
  );
}

function DeleteAccountModal({
  open, onClose, onDone,
}: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/account/delete', { password, confirmation });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not process that request.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Delete your account" onClose={onClose}>
      <Banner tone="danger">
        This schedules your account for deletion. You have 30 days to contact support
        if you change your mind.
      </Banner>

      <div style={{ height: 'var(--s4)' }} />

      <p className="modal__body">
        Invoices and payment records are kept as long as the law requires for bookkeeping,
        with your personal details removed.
      </p>

      {error && <div style={{ marginBottom: 'var(--s4)' }}><Banner tone="danger">{error}</Banner></div>}

      <TextField
        label="Confirm your password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <TextField
        label="Type DELETE to confirm"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder="DELETE"
      />

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Keep my account</Button>
        <Button
          variant="danger"
          onClick={submit}
          loading={busy}
          disabled={confirmation !== 'DELETE' || !password}
        >
          Delete account
        </Button>
      </div>
    </Modal>
  );
}

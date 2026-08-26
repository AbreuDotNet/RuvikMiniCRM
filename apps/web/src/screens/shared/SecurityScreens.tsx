import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS, PROVIDER_TABS, ADMIN_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import { Button, TextField, Banner, Pill } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/ui';

function useTabs() {
  const { user } = useAuth();
  return user?.role === 'provider' ? PROVIDER_TABS
    : user?.role === 'admin' ? ADMIN_TABS : CUSTOMER_TABS;
}

export function ChangePasswordScreen() {
  const tabs = useTabs();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/change', { currentPassword: current, newPassword: next });
      notify('Password updated. Other devices have been signed out.', 'success');
      navigate('/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not change your password.');
      setBusy(false);
    }
  };

  return (
    <Shell title="Change password" tabs={tabs} back="/profile">
      <form onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 'var(--s4)' }}><Banner tone="danger">{error}</Banner></div>}

        <Banner tone="info">
          Changing your password signs you out everywhere else, which is what you want
          if you think someone else has access.
        </Banner>

        <div style={{ height: 'var(--s5)' }} />

        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters. A short phrase is easier to remember and harder to guess."
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />

        <Button type="submit" block size="lg" loading={busy}>Update password</Button>
      </form>
    </Shell>
  );
}

export function MfaScreen() {
  const tabs = useTabs();
  const { user, refreshUser } = useAuth();
  const { notify } = useToast();

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/enroll', {}));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { code: code.trim() });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      await refreshUser();
      notify('Two-factor authentication is on.', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/disable', { password });
      await refreshUser();
      notify('Two-factor authentication is off.', 'default');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not turn it off.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Two-factor authentication" tabs={tabs} back="/profile">
      {error && <div style={{ marginBottom: 'var(--s4)' }}><Banner tone="danger">{error}</Banner></div>}

      {recoveryCodes ? (
        <>
          <Banner tone="warning">
            Save these recovery codes somewhere safe. Each works once, and this is the only
            time they are shown.
          </Banner>
          <div className="card card--pad" style={{ marginTop: 'var(--s4)' }}>
            <div
              style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 'var(--s2)', fontFamily: 'var(--font-mono)', fontSize: '0.95rem',
              }}
            >
              {recoveryCodes.map((recoveryCode) => (
                <div key={recoveryCode} className="strong tabular">{recoveryCode}</div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 'var(--s4)' }}>
            <Button
              block
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                notify('Recovery codes copied.', 'success');
              }}
            >
              Copy codes
            </Button>
          </div>
          <div style={{ marginTop: 'var(--s3)' }}>
            <Button block onClick={() => setRecoveryCodes(null)}>Done</Button>
          </div>
        </>
      ) : user?.mfaEnabled ? (
        <>
          <div className="card card--pad" style={{ marginBottom: 'var(--s5)' }}>
            <div className="row" style={{ gap: 'var(--s3)' }}>
              <div className="avatar" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                <Icon name="shield" size={22} />
              </div>
              <div className="grow">
                <div className="strong">Two-factor is on</div>
                <div className="small muted">You are asked for a code each time you sign in.</div>
              </div>
              <Pill tone="success">Active</Pill>
            </div>
          </div>

          <h3 style={{ marginBottom: 'var(--s3)' }}>Turn it off</h3>
          <TextField
            label="Confirm your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button variant="danger" block loading={busy} disabled={!password} onClick={disable}>
            Turn off two-factor
          </Button>
        </>
      ) : setup ? (
        <>
          <Banner tone="info">
            Add this key to your authenticator app, then enter the 6-digit code it shows.
          </Banner>

          <div className="card card--pad" style={{ margin: 'var(--s4) 0' }}>
            <div className="tiny subtle" style={{ marginBottom: 'var(--s2)' }}>SETUP KEY</div>
            <div
              className="strong"
              style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all', fontSize: '1rem' }}
            >
              {setup.secret}
            </div>
            <div style={{ marginTop: 'var(--s3)' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(setup.secret);
                  notify('Setup key copied.', 'success');
                }}
              >
                Copy key
              </Button>
            </div>
          </div>

          <TextField
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />

          <Button block size="lg" loading={busy} disabled={code.length < 6} onClick={confirm}>
            Confirm and turn on
          </Button>
          <Button variant="ghost" block onClick={() => setSetup(null)} style={{ marginTop: 'var(--s2)' }}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Banner tone="info">
            Two-factor adds a second step at sign-in, so a stolen password is not enough
            on its own. Required for admin accounts.
          </Banner>
          <div style={{ marginTop: 'var(--s5)' }}>
            <Button block size="lg" icon="shield" loading={busy} onClick={begin}>
              Set up two-factor
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/ui';
import { ApiError } from '../../lib/api';
import { Button, TextField, SelectField } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ToastRegion } from '../../components/Shell';

type Mode = 'signin' | 'signup';

const DEMO_PASSWORD = 'RuvikDemo2026!';
const DEMO_ACCOUNTS = [
  { label: 'Customer', email: 'ana@ruvik.demo' },
  { label: 'Provider', email: 'greenleaf@ruvik.demo' },
  { label: 'Admin', email: 'admin@ruvik.demo' },
];

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="auth-brand__mark">
          <Icon name="wrench" size={32} />
        </div>
        <div className="auth-brand__name">Ruvik</div>
        <div className="auth-brand__tag">Your local service marketplace</div>
      </div>

      <div className="auth-card">
        {mfaToken ? (
          <MfaForm mfaToken={mfaToken} onCancel={() => setMfaToken(null)} />
        ) : (
          <>
            <div className="segmented" role="tablist" aria-label="Sign in or sign up">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                className={`segmented__option${mode === 'signin' ? ' is-active' : ''}`}
                onClick={() => setMode('signin')}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                className={`segmented__option${mode === 'signup' ? ' is-active' : ''}`}
                onClick={() => setMode('signup')}
              >
                Sign Up
              </button>
            </div>

            {mode === 'signin'
              ? <SignInForm onMfaRequired={setMfaToken} />
              : <SignUpForm />}
          </>
        )}
      </div>

      <ToastRegion />
    </div>
  );
}

/* ------------------------------------------------------------- sign in --- */

function SignInForm({ onMfaRequired }: { onMfaRequired: (token: string) => void }) {
  const { login } = useAuth();
  const { notify } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.mfaToken) onMfaRequired(result.mfaToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not sign you in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setBusy(true);
    setError(null);
    try {
      const result = await login(demoEmail, DEMO_PASSWORD);
      if (result.mfaRequired && result.mfaToken) onMfaRequired(result.mfaToken);
    } catch {
      notify('Demo data is not loaded. Run "npm run seed" first.', 'error');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      {error && (
        <div className="banner banner--danger" role="alert" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      <Button type="submit" block size="lg" loading={busy}>Sign In</Button>

      <div className="or-divider">or</div>

      <Button
        type="button"
        variant="secondary"
        block
        icon="apple"
        onClick={() => notify('Apple sign-in is not configured in this build.', 'default')}
      >
        Continue with Apple
      </Button>

      <div style={{ marginTop: 'var(--s6)', textAlign: 'center' }}>
        <p className="tiny subtle" style={{ marginBottom: 'var(--s2)' }}>Quick demo access</p>
        <div className="demo-chips">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="demo-chip"
              onClick={() => useDemo(account.email)}
              disabled={busy}
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- sign up --- */

function SignUpForm() {
  const { signup } = useAuth();
  const [form, setForm] = useState({
    role: 'customer' as 'customer' | 'provider',
    fullName: '',
    businessName: '',
    email: '',
    password: '',
    city: '',
  });
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await signup({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        role: form.role,
        city: form.city || undefined,
        businessName: form.role === 'provider' ? form.businessName : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors());
        setError(err.message);
      } else {
        setError('We could not create your account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      {error && (
        <div className="banner banner--danger" role="alert" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      <SelectField
        label="I am a"
        value={form.role}
        onChange={update('role')}
        options={[
          { value: 'customer', label: 'Customer looking for a service' },
          { value: 'provider', label: 'Professional offering services' },
        ]}
      />

      <TextField
        label="Full name"
        autoComplete="name"
        value={form.fullName}
        onChange={update('fullName')}
        error={fieldErrors.fullName}
        required
      />

      {form.role === 'provider' && (
        <TextField
          label="Business name"
          autoComplete="organization"
          placeholder="e.g. Greenleaf Plumbing"
          value={form.businessName}
          onChange={update('businessName')}
          error={fieldErrors.businessName}
          required
        />
      )}

      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={form.email}
        onChange={update('email')}
        error={fieldErrors.email}
        required
      />

      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters. A short phrase works well."
        value={form.password}
        onChange={update('password')}
        error={fieldErrors.password}
        required
      />

      <TextField
        label="City"
        autoComplete="address-level2"
        placeholder="Santo Domingo"
        value={form.city}
        onChange={update('city')}
        error={fieldErrors.city}
      />

      <Button type="submit" block size="lg" loading={busy}>Create account</Button>

      <p className="tiny subtle center" style={{ marginTop: 'var(--s4)' }}>
        By continuing you agree to our terms and privacy notice. We only send
        WhatsApp messages after you turn them on in settings.
      </p>
    </form>
  );
}

/* ----------------------------------------------------------------- MFA --- */

function MfaForm({ mfaToken, onCancel }: { mfaToken: string; onCancel: () => void }) {
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(mfaToken, code.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code was not accepted.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 style={{ marginBottom: 'var(--s2)' }}>Two-factor verification</h2>
      <p className="small muted" style={{ marginBottom: 'var(--s5)' }}>
        Enter the 6-digit code from your authenticator app, or one of your recovery codes.
      </p>

      {error && (
        <div className="banner banner--danger" role="alert" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      <TextField
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={12}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
        required
      />

      <Button type="submit" block size="lg" loading={busy}>Verify</Button>
      <Button type="button" variant="ghost" block onClick={onCancel} style={{ marginTop: 'var(--s2)' }}>
        Back to sign in
      </Button>
    </form>
  );
}

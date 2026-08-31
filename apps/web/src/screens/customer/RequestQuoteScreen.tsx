import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Button, TextField, TextArea, Banner } from '../../components/ui';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useToast } from '../../state/ui';

export function RequestQuoteScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const providerId = params.get('provider') ?? '';
  const serviceId = params.get('service');

  const [form, setForm] = useState({ title: '', description: '', city: '', addressLine: '' });
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const created = await api.post<{ id: string; reference: string; providerName: string }>(
        '/customer/requests',
        {
          providerId,
          serviceId: serviceId || undefined,
          title: form.title,
          description: form.description,
          city: form.city || undefined,
          addressLine: form.addressLine || undefined,
        },
        // A retried submit must not create two leads for the provider.
        newIdempotencyKey(),
      );
      notify(`Request sent to ${created.providerName}.`, 'success');
      navigate(`/requests/${created.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors());
        setError(err.message);
      } else {
        setError('We could not send your request. Please try again.');
      }
      setBusy(false);
    }
  };

  if (!providerId) {
    return (
      <Shell title="Request a quote" tabs={CUSTOMER_TABS} back>
        <Banner tone="warning">Choose a provider first, then request a quote from their profile.</Banner>
      </Shell>
    );
  }

  return (
    <Shell title="Request a quote" tabs={CUSTOMER_TABS} back>
      <form onSubmit={submit} noValidate>
        {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

        <Banner tone="info">
          Describe the job in your own words. The provider will reply with a written quote
          you can accept or decline — no obligation.
        </Banner>

        <div style={{ height: 'var(--s5)' }} />

        <TextField
          label="What do you need?"
          placeholder="e.g. Toilet running constantly"
          value={form.title}
          onChange={update('title')}
          error={fieldErrors.title}
          maxLength={160}
          required
          autoFocus
        />

        <TextArea
          label="Describe the job"
          hint="The more detail you give, the more accurate the quote."
          placeholder="The toilet in the main bathroom keeps running after flushing. It started about a week ago and the water bill has gone up."
          value={form.description}
          onChange={update('description')}
          error={fieldErrors.description}
          maxLength={2000}
          required
        />

        <TextField
          label="City"
          placeholder="Santo Domingo"
          value={form.city}
          onChange={update('city')}
          error={fieldErrors.city}
        />

        <TextField
          label="Address (optional)"
          hint="Only shared with this provider, after they accept the job."
          value={form.addressLine}
          onChange={update('addressLine')}
          error={fieldErrors.addressLine}
        />

        <Button type="submit" block size="lg" loading={busy} icon="check">
          Send request
        </Button>
      </form>
    </Shell>
  );
}

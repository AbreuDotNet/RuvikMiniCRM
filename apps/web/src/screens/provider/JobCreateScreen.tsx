import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import {
  Button, TextField, TextArea, SelectField, Banner, SkeletonList,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';

interface ClientOption {
  id: string;
  fullName: string;
  phone: string | null;
}

export function JobCreateScreen() {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [clientId, setClientId] = useState('');
  const [newClient, setNewClient] = useState({ fullName: '', phone: '', email: '', city: '' });
  const [form, setForm] = useState({ title: '', description: '', addressLine: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clients = useApi(() => api.get<{ data: ClientOption[] }>('/provider/clients', { limit: 100 }), []);

  const update = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const updateClient = (key: keyof typeof newClient) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => setNewClient((c) => ({ ...c, [key]: e.target.value }));

  const submit = async () => {
    if (!form.title.trim()) {
      setError('Give the job a title.');
      return;
    }
    if (mode === 'existing' && !clientId) {
      setError('Choose a client, or add a new one.');
      return;
    }
    if (mode === 'new' && !newClient.fullName.trim()) {
      setError('Enter the new client’s name.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string; reference: string }>('/provider/jobs', {
        ...(mode === 'existing'
          ? { clientId }
          : {
              newClient: {
                fullName: newClient.fullName,
                phone: newClient.phone || undefined,
                email: newClient.email || undefined,
                city: newClient.city || undefined,
              },
            }),
        title: form.title,
        description: form.description || undefined,
        addressLine: form.addressLine || undefined,
        city: form.city || undefined,
      });
      notify(`Job ${created.reference} created.`, 'success');
      navigate(`/jobs/${created.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not create this job.');
      setBusy(false);
    }
  };

  return (
    <Shell title="New job" tabs={PROVIDER_TABS} back="/jobs">
      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      <div className="segmented">
        <button
          type="button"
          className={`segmented__option${mode === 'existing' ? ' is-active' : ''}`}
          onClick={() => setMode('existing')}
        >
          Existing client
        </button>
        <button
          type="button"
          className={`segmented__option${mode === 'new' ? ' is-active' : ''}`}
          onClick={() => setMode('new')}
        >
          New client
        </button>
      </div>

      {mode === 'existing' ? (
        clients.loading ? (
          <SkeletonList rows={1} />
        ) : (
          <SelectField
            label="Client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: 'Choose a client…' },
              ...(clients.data?.data ?? []).map((client) => ({
                value: client.id,
                label: client.phone ? `${client.fullName} · ${client.phone}` : client.fullName,
              })),
            ]}
          />
        )
      ) : (
        <>
          <TextField label="Client name" value={newClient.fullName} onChange={updateClient('fullName')} required />
          <TextField label="Phone" type="tel" placeholder="+18095551234" value={newClient.phone} onChange={updateClient('phone')} />
          <TextField label="Email" type="email" value={newClient.email} onChange={updateClient('email')} />
          <TextField label="City" value={newClient.city} onChange={updateClient('city')} />
        </>
      )}

      <hr className="divider" />

      <TextField
        label="Job title"
        placeholder="Kitchen sink draining slowly"
        value={form.title}
        onChange={update('title')}
        maxLength={160}
        required
      />
      <TextArea
        label="Description"
        placeholder="What needs doing, and anything the customer mentioned."
        value={form.description}
        onChange={update('description')}
        maxLength={4000}
      />
      <TextField label="Address" value={form.addressLine} onChange={update('addressLine')} />
      <TextField label="City" value={form.city} onChange={update('city')} />

      <Button block size="lg" loading={busy} onClick={submit}>Create job</Button>
    </Shell>
  );
}

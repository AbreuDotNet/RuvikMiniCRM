import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import {
  Button, TextField, TextArea, SelectField, Modal, SkeletonList,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';

interface ClientOption {
  id: string;
  fullName: string;
  phone: string | null;
}

/** Un problema concreto, identificado por la ruta de campo que usa la API. */
interface Issue {
  field: string;
  message: string;
}

/**
 * Etiquetas legibles para el resumen del dialogo. Las claves son las rutas que
 * devuelve la API en `details[].field`, asi que `newClient.city` y `city` se
 * distinguen sin ambiguedad.
 */
const FIELD_LABELS: Record<string, string> = {
  clientId: 'Client',
  'newClient.fullName': 'Client name',
  'newClient.phone': 'Client phone',
  'newClient.email': 'Client email',
  'newClient.city': 'Client city',
  title: 'Job title',
  description: 'Description',
  addressLine: 'Address',
  city: 'City',
};

export function JobCreateScreen() {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [clientId, setClientId] = useState('');
  const [newClient, setNewClient] = useState({ fullName: '', phone: '', email: '', city: '' });
  const [form, setForm] = useState({ title: '', description: '', addressLine: '', city: '' });
  const [busy, setBusy] = useState(false);

  /** Errores por campo: pintan el aviso en linea y alimentan el dialogo. */
  const [issues, setIssues] = useState<Issue[]>([]);
  /** Fallo que no pertenece a ningun campo (red, permisos, servidor). */
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const clients = useApi(() => api.get<{ data: ClientOption[] }>('/provider/clients', { limit: 100 }), []);

  const errorFor = (field: string) => issues.find((i) => i.field === field)?.message;

  /** Al corregir un campo, su aviso deja de tener sentido. */
  const clearIssue = (field: string) =>
    setIssues((current) => current.filter((i) => i.field !== field));

  const update = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    clearIssue(key);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const updateClient = (key: keyof typeof newClient) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    clearIssue(`newClient.${key}`);
    setNewClient((c) => ({ ...c, [key]: e.target.value }));
  };

  /**
   * Lleva al usuario al primer campo marcado.
   *
   * Va en un rAF porque al cerrarse el dialogo devuelve el foco al boton que lo
   * abrio: esa limpieza corre en el commit, asi que enfocar antes lo perderia.
   * El scroll se hace aparte y el foco con preventScroll para no deshacerlo.
   */
  const focusFirstInvalid = () => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('#main [aria-invalid="true"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    });
  };

  const report = (found: Issue[], general: string | null = null) => {
    setIssues(found);
    setGeneralError(general);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    if (issues.length) focusFirstInvalid();
  };

  /**
   * Comprueba solo lo que el formulario sabe por si mismo. El formato del
   * telefono y del email los valida el servidor: duplicar aqui sus reglas las
   * dejaria divergir en silencio. Para eso estan los `hint` de cada campo.
   */
  const validate = (): Issue[] => {
    const found: Issue[] = [];
    if (mode === 'existing' && !clientId) {
      found.push({ field: 'clientId', message: 'Choose a client, or add a new one.' });
    }
    if (mode === 'new' && newClient.fullName.trim().length < 2) {
      found.push({ field: 'newClient.fullName', message: 'Enter the client’s name.' });
    }
    if (!form.title.trim()) {
      found.push({ field: 'title', message: 'Give the job a title.' });
    }
    return found;
  };

  const submit = async () => {
    const local = validate();
    if (local.length) {
      report(local);
      return;
    }

    setBusy(true);
    setIssues([]);
    setGeneralError(null);
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
      // La API ya dice que campo falla y por que; mostrar solo el mensaje
      // generico tiraba justo la parte util de la respuesta.
      const fields = err instanceof ApiError && Array.isArray(err.details)
        ? err.details.map((d) => ({ field: d.field, message: d.message }))
        : [];
      if (fields.length) report(fields);
      else report([], err instanceof ApiError ? err.message : 'We could not create this job.');
      setBusy(false);
    }
  };

  const switchMode = (next: 'existing' | 'new') => {
    setMode(next);
    // Los avisos del otro modo ya no aplican.
    setIssues([]);
  };

  return (
    <Shell title="New job" tabs={PROVIDER_TABS} back="/jobs">
      <div className="segmented">
        <button
          type="button"
          className={`segmented__option${mode === 'existing' ? ' is-active' : ''}`}
          onClick={() => switchMode('existing')}
        >
          Existing client
        </button>
        <button
          type="button"
          className={`segmented__option${mode === 'new' ? ' is-active' : ''}`}
          onClick={() => switchMode('new')}
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
            error={errorFor('clientId')}
            onChange={(e) => { clearIssue('clientId'); setClientId(e.target.value); }}
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
          <TextField
            label="Client name"
            value={newClient.fullName}
            error={errorFor('newClient.fullName')}
            onChange={updateClient('fullName')}
            required
          />
          <TextField
            label="Phone"
            type="tel"
            hint="International format, e.g. +18095551234"
            placeholder="+18095551234"
            value={newClient.phone}
            error={errorFor('newClient.phone')}
            onChange={updateClient('phone')}
          />
          <TextField
            label="Email"
            type="email"
            value={newClient.email}
            error={errorFor('newClient.email')}
            onChange={updateClient('email')}
          />
          <TextField
            label="City"
            value={newClient.city}
            error={errorFor('newClient.city')}
            onChange={updateClient('city')}
          />
        </>
      )}

      <hr className="divider" />

      <TextField
        label="Job title"
        placeholder="Kitchen sink draining slowly"
        value={form.title}
        error={errorFor('title')}
        onChange={update('title')}
        maxLength={160}
        required
      />
      <TextArea
        label="Description"
        placeholder="What needs doing, and anything the customer mentioned."
        value={form.description}
        error={errorFor('description')}
        onChange={update('description')}
        maxLength={4000}
      />
      <TextField
        label="Address"
        value={form.addressLine}
        error={errorFor('addressLine')}
        onChange={update('addressLine')}
      />
      <TextField
        label="City"
        value={form.city}
        error={errorFor('city')}
        onChange={update('city')}
      />

      <Button block size="lg" loading={busy} onClick={submit}>Create job</Button>

      <Modal
        open={dialogOpen}
        title={issues.length ? 'Check these fields' : 'We could not create this job'}
        onClose={closeDialog}
      >
        {issues.length > 0 ? (
          <>
            <p className="modal__body">
              {issues.length === 1
                ? 'One field needs a change before this job can be created:'
                : `${issues.length} fields need a change before this job can be created:`}
            </p>
            <ul className="issue-list">
              {issues.map((issue) => (
                <li key={issue.field} className="issue-list__item">
                  <span className="issue-list__field">{FIELD_LABELS[issue.field] ?? issue.field}</span>
                  <span className="issue-list__message">{issue.message}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="modal__body">{generalError}</p>
        )}
        <div className="modal__actions">
          <Button onClick={closeDialog}>
            {issues.length ? 'Take me there' : 'Close'}
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}

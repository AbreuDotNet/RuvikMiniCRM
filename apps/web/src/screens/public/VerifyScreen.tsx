import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { Shell } from '../../components/Shell';
import { Banner, ErrorState, SkeletonList, StatusPill, Section } from '../../components/ui';
import { formatMoney, formatDate } from '../../lib/format';

interface Verification {
  kind: 'quote' | 'invoice';
  number: string;
  status: string;
  issuedOn: string;
  currency: string;
  totalCents: number;
  digest: string | null;
  issuedBy: { businessName: string; city: string | null; region: string | null };
}

/** A 404 is the ordinary answer here, not a failure, so it is carried as data. */
type Result = Verification | { notFound: true };

const isMissing = (r: Result): r is { notFound: true } => 'notFound' in r;

/**
 * The page every Ruvik PDF footer has pointed at since documents were first
 * rendered, and which did not exist until now: "Document digest verifiable at
 * <WEB_BASE_URL>/verify/<kind>/<id>". Printing an invitation to check and then
 * answering it with a 404 is worse than printing nothing.
 *
 * Deliberately outside `<Protected>`. The person who needs this is a customer
 * holding a piece of paper; making them create an account to find out whether
 * that paper is genuine would defeat the point of printing the link. The route
 * discloses nothing the holder does not already have — see the API route's own
 * comment for why possession of the id is the whole capability.
 */
export function VerifyScreen() {
  const { kind, id } = useParams<{ kind: string; id: string }>();

  const state = useApi<Result>(
    () =>
      api.get<Verification>(`/verify/${kind}/${id}`).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return { notFound: true as const };
        throw err;
      }),
    [kind, id],
  );

  return (
    <Shell title="Verify a document" tabs={[]}>
      {state.loading && <SkeletonList rows={3} />}

      {state.error && <ErrorState message={state.error} onRetry={state.reload} />}

      {state.data && isMissing(state.data) && (
        <Banner tone="warning">
          <strong>No matching document.</strong>
          <p className="small" style={{ margin: 'var(--s1) 0 0' }}>
            We have no record of a document with that reference. Check the link against the
            footer of your copy, and if it still does not match, ask the business that sent
            it to you.
          </p>
        </Banner>
      )}

      {state.data && !isMissing(state.data) && (
        <Detail doc={state.data} />
      )}
    </Shell>
  );
}

function Detail({ doc }: { doc: Verification }) {
  const location = [doc.issuedBy.city, doc.issuedBy.region].filter(Boolean).join(', ');

  return (
    <>
      <Banner tone="success">
        <strong>This document was issued through Ruvik.</strong>
        <p className="small" style={{ margin: 'var(--s1) 0 0' }}>
          Compare the figures below with the copy you are holding. If anything differs, the
          copy has been altered since it was issued.
        </p>
      </Banner>

      <Section title={doc.kind === 'quote' ? 'Quote' : 'Invoice'}>
        <Row label="Issued by" value={doc.issuedBy.businessName} />
        {location && <Row label="Location" value={location} />}
        <Row label={doc.kind === 'quote' ? 'Quote number' : 'Invoice number'} value={doc.number} />
        <Row label="Issued on" value={formatDate(doc.issuedOn)} />
        <Row label="Total" value={formatMoney(doc.totalCents, doc.currency)} />
        <div className="row row--between">
          <span className="small muted">Status</span>
          <StatusPill status={doc.status} />
        </div>
      </Section>

      <Section title="Document digest">
        {doc.digest ? (
          <>
            <p className="tiny muted" style={{ margin: 0 }}>
              SHA-256 of the PDF Ruvik generated. A file that produces a different digest is
              not the file that was issued.
            </p>
            <code className="tiny" style={{ wordBreak: 'break-all', display: 'block' }}>
              {doc.digest}
            </code>
          </>
        ) : (
          <p className="tiny muted" style={{ margin: 0 }}>
            This document has no generated PDF yet, so there is no digest to compare. The
            figures above are still what was issued.
          </p>
        )}
      </Section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row row--between">
      <span className="small muted">{label}</span>
      <span className="small strong tabular">{value}</span>
    </div>
  );
}

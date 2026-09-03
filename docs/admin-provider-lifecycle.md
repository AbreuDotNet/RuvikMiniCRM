# Provider lifecycle and the admin panel

How a provider moves between states, which admin actions exist, and why the
interface is shaped the way it is.

---

## 1. The model: two axes, one derived state

Verification and account status answer different questions, so they are stored
separately.

| Axis | Column | Values |
|---|---|---|
| **Verification** — *did we check their documents?* | `providers.verification_status` | `unverified` · `pending` · `info_requested` · `verified` · `rejected` |
| **Account** — *may they operate right now?* | `users.status` | `active` · `suspended` · `blocked` · `pending_deletion` · `deleted` |

Folding these into one enum loses information. A verified provider who is
suspended and later reinstated must come back as **verified**, and a single
column cannot remember what they were before. Keeping two axes means
reinstatement never has to guess.

An admin, however, thinks in one status. So the two are collapsed into an
**effective state** for display and for deciding which actions to offer, with
account status winning:

```
blocked  ─┐
suspended ┼─ account status decides
closed   ─┘   (pending_deletion / deleted)
            otherwise → the verification status
```

`effectiveState()` in `apps/api/src/lib/providerLifecycle.ts` is the single
definition. The same expression exists in SQL as `STATE_SQL` in the admin
routes, so filtering and counting agree with it.

### `info_requested`

New. It is the state between *pending* and a decision: the reviewer looked,
something is missing, and the ball is in the provider's court. Without it,
"we asked for the licence number" had to be recorded as a rejection — which is
both wrong and unrecoverable from the provider's side.

---

## 2. The action table

| Effective state | Actions offered |
|---|---|
| **Not submitted** (`unverified`) | Approve · Request more information · Send to review queue · Reject · Suspend · Block |
| **Pending review** | Approve · Request more information · Reject · Suspend · Block |
| **Information requested** | Approve · Reject · Send to review queue · Suspend · Block |
| **Verified** | **Revoke verification** · Reject · Suspend · Block — *never Approve* |
| **Rejected** | Send to review queue · Overturn rejection and verify · Suspend · Block |
| **Suspended** | Reinstate · Block |
| **Blocked** | Unblock |
| **Closed** | *(none — the record is read-only)* |

Rules encoded in the table rather than in scattered `if`s:

- **Reason required** for everything that stops or reverses an account:
  reject, revoke, overturn, suspend, reinstate, block, unblock. Minimum 10
  characters, enforced server-side. "ok" is not a reason, and this text is read
  months later by whoever is reconstructing the decision.
- **Second confirmation** with a written consequence before anything hard to
  walk back. A confirmation dialog with no body is a speed bump, not a warning,
  so every one of them carries a sentence saying what will actually happen.
- **Two-factor** on every state-changing route (`requireMfa`).
- **Revoke ≠ Reject.** Revoking sends the case back to the queue and leaves the
  listings online — losing a trust signal is not the same as losing the right
  to trade. Rejecting takes the listings down.
- **Overturning a rejection is its own action**, so reversing another admin's
  decision demands a written reason where plain approval does not.

### Where the buttons come from

`GET /admin/providers/:id` returns `availableActions`, computed server-side from
the provider's actual state. The drawer renders exactly that list. It does not
decide for itself, and the API refuses anything not on it with a 409.

This is the specific failure being replaced: the old modal showed **"Approve
verification" on providers that were already verified**, along with "Mark as
pending review" and "Reject" regardless of state.

The table is duplicated in `apps/web/src/lib/providerLifecycle.ts` for copy and
tones. `providerLifecycle.test.ts` fails the build if the two ever differ —
otherwise the interface could offer a button the server would refuse.

---

## 3. History and audit

Two records, deliberately:

- **`provider_status_events`** — the readable timeline of what happened to one
  provider. Queried constantly during a review; answering that from a hash
  chain would mean scanning it.
- **`audit_logs`** — the tamper-evident record of what admins did to the
  platform. Unchanged in shape.

Both are written on every transition. Audit **action names are unchanged**
(`admin.provider_verification`, `admin.user_suspended`, …) so existing filters,
exports and the audit screen keep working; the specific lifecycle action rides
in the metadata.

Reinstating restores what the suspension took down: the event records whether
the provider was published, and reinstatement puts it back. Leaving them
unlisted after "your account is active again" is the kind of half-reversal that
produces a support ticket a week later.

---

## 4. Two bugs found while reviewing

**The audit chain reported itself broken with nothing tampered with.**
`writeAudit` hashed `metadata` as written, but the column is `jsonb`, which
normalises object keys by length and then bytewise. Verification re-hashed the
round-tripped value, so any entry whose insertion order differed from jsonb's
compared two different strings. `{reason, from, to, axis}` comes back as
`{to, axis, from, reason}`. Existing entries survived only because they happened
to be written in jsonb's order, or had a single key.

Fixed by canonicalising with jsonb's own rule before hashing — chosen over
plain alphabetical sorting specifically so every already-valid row stays valid.

**An MFA-elevated admin silently dropped to `aal1` after 15 minutes.**
`/auth/refresh` re-signed the access token without the `aal` claim, which
defaults to `aal1`. Every `requireMfa` route then returned 403 until the admin
signed out and back in. The auth level belongs to the session, so it is now
stored on the refresh token and carried across rotation. It is not re-derived
from `users.mfa_enabled`, which would silently elevate a session that never
passed a challenge.

---

## 5. Overview

Rebuilt around one question: *what needs doing?*

- **Needs attention** is the only section above the fold. It lists work, never
  status, and a zero disappears entirely — a permanent row reading "0 flagged
  reviews" trains an admin to stop reading the section.
- **Every counter is a link.** Each provider tile opens the list it counted
  (`/admin/providers?state=pending`), and each review-queue row opens that
  provider's drawer (`?provider=<id>`). A number an admin cannot open is a
  number they have to go and find by hand.
- **Buckets reconcile.** Counts come from the derived state, so a suspended
  provider is counted once, under Suspended. The old dashboard counted it as
  verified as well, and the buckets never summed to the total.
- **The review queue is ordered oldest-first**, and says how long each case has
  been waiting as an elapsed span. `formatRelative` degrades to an absolute date
  past a week, which is right for "last seen" and wrong for a queue: "waiting
  Aug 25" makes the reader do the subtraction that the queue is sorted on.
  `formatWaiting` was added for this.
- **Recent admin activity** reads from the audit log and links back to the
  provider each entry concerns.

Filters live in the URL on both the provider and user lists, so a tile can deep
link into exactly the list it counted and a filtered view is shareable.

---

## 6. Known limitations

**The demo admin cannot perform a single action.** Every state-changing admin
route requires an MFA session, and `admin@ruvik.demo` is seeded with two-factor
off, so `sessionAal` is `aal1` and the panel is read-only out of the box. This
is correct behaviour, and the UI now says so up front rather than letting
someone write a reason and then collect a 403 — but it does mean the panel
cannot be exercised from the demo account.

**This is a deliberate decision, not an outstanding task.** Three ways out were
weighed and declined: enrolling the demo admin from the existing Profile →
two-factor screen (works today, needs an authenticator app in hand), seeding a
fixed TOTP secret (puts a working second factor in the repository), and dropping
`requireMfa` from the admin routes (a stolen admin password would then be enough
to block accounts and strip verifications). The panel stays read-only from the
demo account until a real second factor is enrolled.

Because the actions are permanently disabled in that state, they are styled to
look it. The global `.btn:disabled { opacity: 0.55 }` is enough for one greyed
submit button but not for a stack of filled ones — a 55%-opacity danger fill
still reads as a red button somebody can press. Disabled actions inside
`.action-list__item` drop their fill entirely and go flat grey.

**Documents are listed, not viewable.** The drawer shows what was uploaded and
each file's malware-scan state, but there is no admin route that serves a
provider's private file. Verifying a licence still means opening it out of band.
The banner says so.

**"Request more information" does not open a thread.** It notifies the provider
with the note and moves the case to `info_requested`. There is no reply channel,
so the provider's response arrives by email or by re-uploading.

**Support tickets are counted, not routed.** The Needs-attention row for open
tickets links to the user list, because there is no ticket screen. The API
endpoint exists (`/admin/support-tickets`); the screen does not.

**No bulk actions.** Each decision is one provider at a time. That is right for
verification and wrong for, say, clearing a backlog of identical spam
registrations.

**`pending_deletion` and `deleted` accounts are read-only** in the panel. There
is no deletion workflow behind them yet.

---

## 7. Tests

| File | Covers |
|---|---|
| `tests/unit/providerLifecycle.test.ts` (30) | The state machine: availability per state, reason and confirmation rules, table integrity, no dead-end states, the legacy-status bridge, and parity with the admin UI's copy of the table. |
| `tests/integration/providerLifecycle.test.ts` (33) | The endpoints: contextual actions, 409 on an illegal transition, reason enforcement, history and audit writes, chain integrity after a run of actions, axis independence across suspend/reinstate, blocking and session revocation, queue ordering and search, bucket reconciliation, the status-based endpoint, and AAL surviving a token refresh. |

291 tests pass in total.

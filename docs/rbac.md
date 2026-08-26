# Roles and permissions

Three roles: `admin`, `provider`, `customer`. A user has exactly one.

Authorization is enforced **server-side on every request**. The UI hides what
a user cannot do, but hiding is not enforcement — every check below is a
middleware or a `WHERE` clause, and the security suite proves it.

## Authorization levels

| Level | Meaning |
|---|---|
| `aal1` | Password (and MFA, if the account has it) satisfied |
| `mfa` | A TOTP challenge was satisfied **this session** |

Admin state changes require `mfa`. An admin token alone cannot suspend an
account, moderate a review, or edit the catalogue.

## Matrix

Legend: ✓ allowed · ✗ denied · **own** = only their own records

### Identity

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| Register | ✓ | ✓ | ✗ (created out of band) |
| Sign in / refresh / sign out | ✓ | ✓ | ✓ |
| Change own password | ✓ | ✓ | ✓ |
| Enrol / disable own MFA | ✓ | ✓ | ✓ (required) |
| Export own data | ✓ | ✓ | ✓ |
| Delete own account | ✓ | ✓ (blocked with unpaid invoices) | ✓ |

### Discovery

| Capability | Anonymous | Customer | Provider | Admin |
|---|:--:|:--:|:--:|:--:|
| Search published services | ✓ | ✓ | ✓ | ✓ |
| View public provider profile | ✓ | ✓ | ✓ | ✓ |
| View unpublished / suspended provider | ✗ | ✗ | ✗ | ✓ |

### Provider business

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| Edit business profile | ✗ | **own** | ✓ |
| Set own verification status | ✗ | ✗ | ✓ (MFA) |
| Set own rating | ✗ | ✗ | ✗ (derived from reviews) |
| Publish / unpublish own profile | ✗ | **own** | ✓ (MFA) |
| Create / edit service listings | ✗ | **own** (plan-limited) | ✓ |
| View own dashboard | ✗ | **own** | ✓ |

### CRM

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| View clients | ✗ | **own** | ✗ |
| Create / edit clients | ✗ | **own** | ✗ |
| View jobs | **own** (as requester) | **own** | ✗ |
| Change job status | ✗ | **own** (legal transitions only) | ✗ |
| Add internal note | ✗ | **own** | ✗ |
| Read internal note | ✗ | **own** | ✗ |
| Read customer-facing comment | **own job** | **own** | ✗ |

Admins deliberately cannot browse provider CRM records. Moderation needs
account state and public content, not a customer's address book.

### Quotes and invoices

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| Create / edit quote | ✗ | **own** (drafts only) | ✗ |
| Send quote | ✗ | **own** | ✗ |
| View draft quote | ✗ | **own** | ✗ |
| View sent quote | **addressed to them** | **own** | ✗ |
| Accept / decline quote | **addressed to them** | ✗ | ✗ |
| Create invoice | ✗ | **own**, accepted quote only | ✗ |
| Record payment | ✗ | **own** | ✗ |
| View invoice | **addressed to them** | **own** | ✗ |

### Reviews

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| Leave a review | **own completed job, once** | ✗ | ✗ |
| Reply to a review | ✗ | **own** | ✗ |
| Moderate / remove | ✗ | ✗ | ✓ (MFA) |

### Billing

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| View plans | ✓ | ✓ | ✓ |
| Start subscription | ✗ | **own** | ✗ |
| Activate subscription | ✗ | ✗ | ✗ — **signed webhook only** |
| Cancel subscription | ✗ | **own** | ✓ |

No human role can activate a subscription. Only a verified payment webhook
can, which is what prevents a forged client callback buying a free plan.

### Administration

| Capability | Customer | Provider | Admin |
|---|:--:|:--:|:--:|
| View platform metrics | ✗ | ✗ | ✓ |
| Search users | ✗ | ✗ | ✓ |
| Suspend / reinstate a user | ✗ | ✗ | ✓ (MFA, reason required) |
| Verify a provider | ✗ | ✗ | ✓ (MFA) |
| Manage categories | ✗ | ✗ | ✓ (MFA) |
| Read audit log | ✗ | ✗ | ✓ |
| Verify audit chain | ✗ | ✗ | ✓ (MFA) |

An admin cannot change their own account status — that would allow locking
the platform out of its own administration.

## Tenant isolation

A provider's data is reachable only through their own `provider_id`, which is
pinned onto the request by `requireProvider` and read via `tenantId(req)`.
Ids in a URL or body are **never** trusted as a tenant selector:

```ts
// The tenant filter is in the WHERE clause, so another provider's id in the
// URL simply matches no rows.
await db.query(
  'UPDATE services SET ... WHERE id = $1 AND provider_id = $2',
  [req.params.id, tenantId(req)],
);
```

`tests/security/authz.test.ts` proves this for clients, jobs, quotes,
invoices, notes and list endpoints, including that a cross-tenant read is
indistinguishable from a non-existent record.

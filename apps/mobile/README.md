# Ruvik mobile

The native app for iOS and Android. Expo SDK 57, React Native 0.86, Expo Router.

It is a **client of the existing Ruvik API** and nothing more. Prices, taxes,
document totals, status transitions, plan limits and permissions are all
decided by `apps/api` and rendered here as given. The web app in `apps/web`
keeps working exactly as it did; this does not replace it.

---

## Running it

```bash
# 1. The API has to be up first — from the repo root:
npm run dev:api          # http://localhost:4000

# 2. Then the app, from this directory:
cd apps/mobile
npm install              # first time only
npm start
```

Press `i` for the iOS simulator, `a` for the Android emulator, or scan the QR
code with Expo Go on a real phone.

> **Do not press `w`.** This app has no web target — `react-native-web` is not
> installed, so the web bundle fails with a MIME-type error. The web app is a
> separate thing that already exists at `apps/web`, on port 5173. Adding a web
> build here would also quietly break the session model: `expo-secure-store`
> ships an empty stub on web, so the refresh token would simply never persist.

> **Push does not work in Expo Go on Android.** Expo Go dropped remote
> notifications in SDK 53, and `expo-notifications` throws *as it is imported*
> rather than when it is called. `src/services/push.ts` therefore loads it
> lazily behind a `require` in a try/catch — a static import took the whole app
> down on launch with `Cannot read property 'ErrorBoundary' of undefined`,
> which names nothing to do with notifications. Everything else works in Expo
> Go; use a development build when you need to exercise push itself.

From the repo root you can also use `npm run dev:mobile`, `npm run
typecheck:mobile` and `npm run test:mobile`.

### Pointing the app at the API

`src/services/config.ts` resolves the base URL in this order:

1. **`EXPO_PUBLIC_API_URL`** if set — use this for staging and production.
2. In development, the host Expo served the bundle from, on port
   `EXPO_PUBLIC_API_PORT` (default `4000`).

That second rule is what makes a **physical device** work without editing
anything: the phone loads the bundle from your laptop's LAN address, so the
API is at that same address. `localhost` would be the phone itself.

| Where you run it | What it talks to | Anything to do? |
|---|---|---|
| iOS simulator | `http://localhost:4000` | No |
| Android emulator | `http://10.0.2.2:4000` | No |
| Physical device (Expo Go) | `http://<your-LAN-ip>:4000` | Laptop and phone on the same network; let the API through the firewall |
| Staging / production | `EXPO_PUBLIC_API_URL` | Set it in `.env` or the EAS build profile |

Copy `.env.example` to `.env` if you need to override either value. `.env` is
gitignored.

> The API is bound to `localhost` by default. To reach it from a real phone,
> start it listening on all interfaces (`HOST=0.0.0.0`) or run it behind a
> tunnel.

### Demo accounts

The same ones the seeded database creates — password `RuvikDemo2026!`:

| Role | Email |
|---|---|
| Provider | `greenleaf@ruvik.demo` |
| Customer | `ana@ruvik.demo` |
| Admin | `admin@ruvik.demo` |

### Checks

```bash
npm run typecheck    # tsc, strict, no any
npm run lint         # eslint-config-expo, including the React Compiler rules
npm test             # vitest — API client, session refresh, money parsing
npx expo-doctor      # dependency and config sanity
```

---

## How it is put together

```
app/                      Expo Router routes (the file tree is the navigation)
  (auth)/                 sign-in, sign-up, MFA, password reset
  (customer)/             tabs: Home, Search, Requests, Alerts, Account
  (provider)/             tabs: Today, Jobs, Clients, Money, Alerts, Account
  (admin)/                tabs: Overview, Alerts, Account — deliberately small
  job/ client/ quote/ invoice/ request/ provider/ service/   stack screens
  settings/               profile, security, appearance, WhatsApp, tax

src/
  services/     HTTP client, session storage, config, file transfer, push
  state/        auth context
  features/     one folder per domain: hooks + the screens only it uses
  components/   the UI kit (components/ui) and shared building blocks
  theme/        tokens and the light/dark provider
  types/        the API contract, as this client reads it
  utils/        pure helpers — money, formatting, status vocabulary
```

### Session handling

- The **access token lives in memory only** and dies with the process.
- The **refresh token lives in Expo SecureStore** — the iOS keychain, the
  Android encrypted store. Never AsyncStorage: that is a plain file in the app
  sandbox, and this is a 30-day credential.
- **Refresh is serialised through one shared promise.** Refresh tokens are
  single-use and the server treats a second presentation of the same token as
  theft — it revokes the whole token family. Two screens refreshing at once
  would therefore sign the user out. `src/services/apiClient.test.ts` proves
  three concurrent callers produce exactly one rotation.
- A 401 triggers one refresh and one replay. If the refresh fails, the
  keychain is cleared and the app returns to sign-in — **unless** the failure
  was the network, in which case the session is left alone. A dead network is
  not a dead session.

### Money

- Everything is **integer cents**. `src/utils/moneyInput.ts` parses what
  someone typed with string arithmetic, because `parseFloat('8.145') * 100` is
  the classic way a price ends up a cent out.
- `src/utils/money.ts` is a **byte-identical mirror** of the API's
  `lib/money.ts`, used only for the quote builder's live preview.
  `apps/api/tests/unit/moneyParity.test.ts` runs the API copy, the web copy and
  this one over the same 4,000 generated documents, so editing one without the
  others fails the build.
- Whatever the preview shows, **the server recomputes and stores its own
  totals** from the line items it receives.

### Idempotency

Every money-moving or document-creating call carries an `Idempotency-Key`:
quote create/send/respond, invoice create/send/payment/void, subscription
checkout, customer requests, job creation.

The key is minted **once when the button is pressed** and reused across
retries — that is the entire point. The payment sheet mounts fresh each time
it opens so its key is per-attempt, and React Query is configured to **never
retry a mutation automatically**.

### Branding and the launch screen

`assets/splash-mark.png` is the mark cropped from the launch artwork, and
`brand` in `src/theme/tokens.ts` carries the palette sampled from that same
file rather than eyeballed — the ring in the artwork is exactly the accent at
80% over the navy.

There are two launch screens, and they are not the same thing:

- The **native splash** (`app.json`) is the OS one. Android 12 removed
  full-bleed splash images, so it can only be a centred mark on a flat
  colour. **Expo Go shows its own splash, not this one** — it is only visible
  in a development or production build.
- **`LaunchScreen`** is the in-app one, shown while the session is restored.
  It rebuilds the rings, wordmark, tagline and a moving progress bar in plain
  views: sharp at every density, correct on any aspect ratio, and the bar can
  actually move. Both share the navy, so the handoff is invisible.

The auth screens continue the same composition — navy band, same mark, same
rings at a whisper — so signing in reads as the next step of starting the app
rather than a different product.
### Accessibility

Touch targets are 44pt minimum, `allowFontScaling` stays on everywhere (capped
at 1.6× where the layout would otherwise break), every icon-only control has
an accessible label, choices use the `radio`/`radiogroup` roles so screen
readers announce the selection, and errors are `accessibilityLiveRegion`
announcements rather than silent colour changes.

Disabled filled buttons **lose their fill** rather than fading to 55% opacity.
A faded button still reads as "pressable, just quiet", and people tap it
repeatedly waiting for something to happen.

---

## What is implemented

**Customer** — sign-up and sign-in with MFA; home with recent requests,
categories and highly-rated providers; search with text, category, city and
verified-only filters plus cursor pagination; provider profiles and service
detail; requesting a quote; request list and detail; accepting or declining a
quote; viewing invoices and their payment state; reviewing a completed job;
notifications; profile, security, WhatsApp and appearance settings.

**Provider** — dashboard with leads, upcoming work, outstanding and overdue
money, pipeline counts and quick actions, every tile opening the list behind
it; jobs by status with search; job detail with the server's allowed
transitions, internal and customer-visible notes and the full timeline;
clients list, detail and editing; an agenda calendar; the quote builder with
per-line kind and tax treatment and a live preview; sending a quote; invoices
from an accepted quote or from scratch; sending, recording payments and
voiding; sharing the server-generated PDF; business profile; listings; tax
settings; subscription and plan changes; verification document upload.

**Admin** — profile, notifications and security only, on purpose. See below.

## What is not implemented, and why

- **Admin moderation stays on the web panel.** Provider verification, user
  status, review moderation and audit logs need a reason, the full history in
  view and a two-factor session. A reduced version on a phone would mostly be a
  way to take an irreversible action with less context.
- **Requesting verification.** A provider can upload documents —
  `/files/uploads` accepts them — but the API has **no endpoint for a provider
  to submit themselves for review**; only an administrator can move a provider
  into `pending`. The verification screen says so plainly instead of pretending.
- **Push notifications are half-wired.** Permission, the Android channel, the
  Expo push token and the tap-to-route handler are all real. There is **no API
  endpoint that stores a device token**, so `registerDeviceToken` deliberately
  does not call one — inventing a route would give a 404 on every launch and an
  app that looks connected. Until it exists, the unread badge is kept current by
  polling `/notifications`, which is real and works today.
- **Thermal printing** is not ported. The web version depends on
  `window.print`, which has no meaning here. The app shares the server's PDF
  through the OS share sheet instead — from which it can be printed, saved or
  sent on WhatsApp. A direct thermal-printer integration belongs behind a print
  service abstraction, later.
- **Hosted checkout.** `POST /billing/subscription` currently returns a local
  reference rather than a gateway URL. The subscription screen already handles
  a `checkout.url` when one appears — it opens an in-app browser — and
  activation stays the webhook's job either way. A client saying the payment
  succeeded must never grant a paid plan.
- **The app is in English.** The language preference on the account screen is
  stored and used by the server for email and WhatsApp; the interface itself is
  not yet translated, and the screen says so.
- **No offline write queue.** Reads are cached by React Query and lists tell
  you when a fetch failed, but a mutation made with no signal fails rather than
  queueing.

## Dependency notes

- **Not an npm workspace.** `apps/mobile` installs into its own
  `node_modules` so React Native is never hoisted next to the web app's React
  18. Run `npm install` from *this* directory, not the repo root.
- **No Reanimated or Gesture Handler.** The bottom sheets are `Modal` plus
  `Animated` on the native driver. That is a lot less native surface to keep
  building for a panel that slides up.
- **`noUncheckedIndexedAccess` is off** in `tsconfig.json`, deliberately: the
  money mirror has to stay byte-identical to the API's copy, and the flag would
  force it to drift. `strict` is on.

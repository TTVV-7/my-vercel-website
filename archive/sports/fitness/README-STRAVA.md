# Strava Integration (Local + Server Exchange)

This section explains the Strava integration now implemented: client-side token management plus server-side OAuth code exchange and refresh endpoints.

## Key Concepts
- Tokens are persisted in your browser `localStorage` **and** can now be obtained via secure server routes.
- Multiple logical profiles ("users") supported – each stores access, refresh, and expiry.
- Context: `StravaAuthContext` provides active user + update utilities.
- OAuth exchange and refresh implemented at:
	- `POST /api/strava/exchange` – exchanges `code` for `access_token` + `refresh_token`.
	- `POST /api/strava/refresh` – refreshes tokens when expiring.

## Relevant Files
- `app/strava/StravaAuthContext.tsx` – context/provider storing users + current user.
- `app/strava/layout.tsx` – wraps Strava pages with provider.
- `app/strava/page.tsx` – user/token management + automatic exchange of `code`.
- `app/strava/activity/page.tsx` – activities list with active token.
- `app/strava/stats/page.tsx` – segment & weekly stats UI.
- `app/api/strava/exchange/route.ts` – server token exchange.
- `app/api/strava/refresh/route.ts` – server token refresh.

## Adding a Token Manually
1. Go to `/strava`.
2. Paste a valid Strava access token in the "Access Token" textarea.
3. (Optional) Give it a display name.
4. Click "Save & Go to Activities" – you'll be redirected.

## Switching Users
1. Return to `/strava`.
2. Click `Use` beside any saved user.
3. You will be redirected to the activities page with that user's token active.

## Clearing Users
- On `/strava`, click `Clear all saved` (removes all tokens from localStorage).

## OAuth Flow (Implemented Exchange)
1. User clicks "Connect with Strava" on `/strava`.
2. Strava redirects back with `?code=...`.
3. The page automatically POSTs `{ code }` to `/api/strava/exchange`.
4. Response fields stored locally: `access_token`, `refresh_token`, `expires_at`, basic athlete profile.
5. User is redirected to `/strava/activity`.

### Refresh Flow (Manual Trigger Concept)
Currently the refresh endpoint exists (`POST /api/strava/refresh`) but **auto-refresh logic is not yet wired**. You can manually test it with:
```
fetch('/api/strava/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token }) })
```
Returned values can be merged using `updateUserToken` (already in context).

## Environment Variables
Create `.env.local` (never commit real secrets) with:
```
STRAVA_CLIENT_ID=YOUR_CLIENT_ID
STRAVA_CLIENT_SECRET=YOUR_CLIENT_SECRET
# Optional if you need explicit redirect control
NEXT_PUBLIC_STRAVA_REDIRECT_URL=http://localhost:3000/strava
```
Restart the dev server after adding these.

## Security Notice
Never commit long-lived or refresh tokens. This demo stores only what you enter locally.

## Future Enhancements (Suggested)
- Auto-refresh when `expires_at` < now + 2 minutes.
- Persist tokens server-side per authenticated site user session.
- Segment caching / ETag + conditional requests.
- Visual filtering: distance ranges, activity types, date range slider.
- Error telemetry / retry backoff for 429 responses.

---
If you want help implementing the secure server exchange, just ask.

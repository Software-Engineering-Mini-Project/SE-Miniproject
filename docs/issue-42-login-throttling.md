# Issue #42: deploy-safe login throttling

The API stores failed-login counters in the existing MongoDB database so they are shared by app instances and survive process restarts. It does not add a paid provider or new external service.

## Behavior

- Five failed attempts for the same normalized email and client IP are allowed per 60-second window; the next attempt receives the generic `429 RATE_LIMITED` response.
- Sixty failed attempts from one client IP across different accounts are allowed per 60-second window to slow account spraying without permanently locking an account by email alone.
- Counter keys are HMAC digests made with the JWT secret. Raw email addresses and IPs are not stored in the counter collection.
- A MongoDB TTL index removes expired records. Expired records are also ignored by the query before TTL cleanup occurs.
- If counter storage is unavailable, the login request fails closed with a generic `503 AUTH_RATE_LIMIT_UNAVAILABLE`; internal database details are not returned or logged.
- The API uses the first valid address in `X-Forwarded-For` for the client IP and falls back to the socket address. Render documents this header for obtaining the true client IP: [Render DDoS and application-level protection](https://render.com/articles/how-render-handles-ddos-attacks).

## Verification

API tests cover the account limit, persistence across separate app instances that share MongoDB, expiry after 60 seconds, the per-IP account-spraying limit, and fail-closed behavior when the counter store is unavailable. Model tests check the TTL index and that records contain only a keyed digest. The targeted tests and API lint passed locally; CI remains authoritative for the full repository suite.

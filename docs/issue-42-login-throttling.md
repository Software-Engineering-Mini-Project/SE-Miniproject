# Issue #42: deploy-safe login throttling

The API stores failed-login counters in the existing MongoDB database so they are shared by app instances and survive process restarts. It does not add a paid provider or new external service.

## Behavior

- Five failed attempts for the same normalized email and client IP are allowed per 60-second window; the next attempt receives the generic `429 RATE_LIMITED` response.
- Sixty failed attempts from one client IP across different accounts are allowed per 60-second window to slow account spraying without permanently locking an account by email alone.
- Counter keys are HMAC digests made with the JWT secret. Raw email addresses and IPs are not stored in the counter collection.
- A MongoDB TTL index removes expired records. Expired records are also ignored by the query before TTL cleanup occurs.
- If counter storage is unavailable, the login request fails closed with a generic `503 AUTH_RATE_LIMIT_UNAVAILABLE`; internal database details are not returned or logged.
- The API uses Express's `request.ip`; `createApp` trusts only loopback, link-local, and private-network proxy peers. Direct public callers cannot choose their limiter identity by supplying `X-Forwarded-For`. Vercel's edge proxy must connect from one of those private ranges for forwarded client addresses to be used; otherwise the socket peer is used. Review this trust boundary if the service's proxy topology changes.
- Each counter's expiry is fixed when its 60-second window begins, so repeated failures cannot extend a bucket indefinitely. Expired buckets are reset on the next failure and later removed by MongoDB's TTL index.

## Verification

API tests cover the account limit, persistence across separate app instances that share MongoDB, expiry after 60 seconds, the per-IP account-spraying limit, and fail-closed behavior when the counter store is unavailable. Model tests check the TTL index and that records contain only a keyed digest. The two latest CI checks remain authoritative for this revision.

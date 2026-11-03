# Task Manager project context

The repository is a single-app monolith. Next.js serves pages from src/app; one Express process in server/main.js routes /api requests to the existing API and all other requests to Next.js. MongoDB remains an external database.

```text
src/       Next.js app and features
server/    Express API, MongoDB models, tests, and support
fixtures/  Synthetic fixtures
tests/     Web unit and component tests
e2e/       Playwright browser tests
scripts/   Seed and staging deployment scripts
docs/      API contract and handoff documentation
```

Copy .env.example to .env, configure MongoDB and a strong JWT secret, then run npm install. Use npm run dev for the single server on port 3000. Checks: npm run lint, npm test, npm run build. Seeding clears selected collections; use a disposable local/test database.

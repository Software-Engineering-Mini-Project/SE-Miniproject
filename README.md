# SE-Miniproject - Task Manager

Starter repository for the Task Manager application. The project uses a React + Vite frontend and a Node.js + Express API, with a MongoDB/Mongoose data layer to be added in the backend foundation work.

## Prerequisites

- Node.js 22 or newer (Node.js 24 LTS is recommended)
- npm 10 or newer (included with supported Node.js releases)

## Repository layout

```text
backend/       Express API and backend tests
frontend/      React application and frontend tests
.github/       GitHub Actions workflows
```

## Install

From the repository root:

```bash
npm ci
```

## Configure

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local` if you need to override the defaults. Do not commit local `.env` files or real credentials. The starter health endpoint does not require a database yet.

## Run locally

Start both applications from the root:

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- API health check: <http://localhost:4000/api/health>

You can also start each application separately with `npm run dev:frontend` or `npm run dev:backend`.

## Verify

```bash
npm test
npm run lint
npm run build
```

GitHub Actions runs install, test, lint, and frontend build checks for pull requests targeting `main` and pushes to `main`.

## Contribution workflow

1. Create a feature branch from the latest `main`.
2. Make focused commits and keep secrets and real personal data out of Git.
3. Open a pull request to `main`, link the related issue, and request review.
4. Resolve review feedback and wait for the required approval and CI checks before merging.

## Current scope

This commit is a development skeleton: the frontend shell and API health endpoint are placeholders for feature issues. Authentication, task and project APIs, database integration, and product UI are not implemented yet.

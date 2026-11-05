# Performance evidence: TC-PERF-01 and TC-PERF-02

Requirements: **TM-NF-001** (at least 95% of measured API requests within 2 s under a documented normal load) and **TM-NF-005** (100 simulated concurrent users).
Tool: [`scripts/load-test.mjs`](../scripts/load-test.mjs) (`npm run test:load -- --base-url <url> --vus <n> --duration <s>`).

> **Scope of this evidence.** These are **local** runs, not the staging runs the STP asks for. They show that the application and its queries meet the target with headroom on modest hardware. They do not measure network distance to Vercel or MongoDB Atlas. Rerun the same command against the staging deployment (with `--allow-remote true`) and add those results below before claiming TC-PERF-01/02 for release.

## Workload

Each virtual user signs in once (bcrypt is not counted as API latency), then loops with 250 ms think time over the requests the UI makes on its main screens:

| Request | Purpose |
| --- | --- |
| `GET /dashboard?today=` | Dashboard stats, project summaries, open tasks |
| `GET /notifications/unread-count` | Unread badge (also schedules due-date reminders) |
| `GET /projects` | Sidebar and project index |
| `GET /projects/project-alpha/tasks?page=1&pageSize=50` | Board / list |
| `GET /tasks?q=release&page=1&pageSize=50` | Cross-project search |
| `GET /notifications?page=1` | Notifications page |
| `PATCH /tasks/:id/status` | Board move (write path), every iteration for Lead users |

Virtual users are spread across four fixture accounts (Lead, two Members, Admin), so reads cover member-scoped and Admin queries. The write path cycles a task created for the run, which is deleted afterwards.

## Results: 2026-11-06, local

Environment: production build (`npm run build`, `node server/main.js`), single Node.js v24.14.1 process; MongoDB 8.2.6 on the same machine; data from `npm run seed:demo`; Windows 11, Intel Core i5-12450H (12 threads), 16 GB RAM. The load generator ran on the same machine, which inflates latency at 100 users.

| Run | Virtual users | Duration | Requests | Errors | p50 | p95 | p99 | Throughput | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| TC-PERF-01 normal load | 10 | 60 s | 9,930 | 0 | 12 ms | 61 ms | 113 ms | 164.7 req/s | Pass (p95 ≤ 2,000 ms) |
| TC-PERF-02 concurrency | 100 | 60 s | 15,099 | 0 | 336 ms | 625 ms | 759 ms | 244.4 req/s | Pass (p95 ≤ 2,000 ms) |

Slowest endpoint at 100 users: `PATCH /tasks/:id/status` at p95 700 ms, then `GET /dashboard` at p95 671 ms. No request failed and none exceeded 1 s at p99.

## Still to do for release

- Run both profiles against staging (Vercel `bom1` + Atlas `ap-south-1`) and record the results here.
- OPS-MON-01 (availability over an observation window) needs monitoring data and is not covered by this file.

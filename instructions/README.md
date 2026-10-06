# Docker Practice: Start Here

This folder has three guides. Do them **in order**. Each one ends with a checklist; do not move on until you can tick every box.

| # | Guide | You will learn |
| --- | --- | --- |
| 1 | [01-dockerize-express.md](01-dockerize-express.md) | Write a Dockerfile, build an image, run a container |
| 2 | [02-dockerize-nextjs.md](02-dockerize-nextjs.md) | Multi-stage builds, build-time vs run-time config |
| 3 | [03-docker-compose.md](03-docker-compose.md) | Run web + api + db together with Docker Compose |

## The project

| App | Folder | Port | Needs |
| --- | --- | --- | --- |
| API (Express + Drizzle) | `api/` | 4000 | Postgres |
| Web (Next.js) | `web/` | 3000 | The API |
| Database | _you add it in guide 3_ | 5432 | |

The web app lists users and has a "New user" modal. The API has `GET /api/users`, `POST /api/users` and `GET /health`.

## Rules

- Try each step yourself first. Every guide has a **Solution** at the bottom, hidden in a collapsible block. Open it only after you are stuck, then explain to your mentor why it works.
- Do not copy-paste blindly. For every line in a Dockerfile you must be able to say what it does.
- Never commit `.env` files with real secrets.

## Prerequisites

- Docker Desktop running (`docker version` shows both Client and Server).
- Node.js 20+ (only needed if you want to run the apps without Docker first).

## Optional: run without Docker first

Seeing the apps work normally makes debugging containers much easier.

```sh
# needs a local Postgres with a database called "practice"
cd api && npm install && npm run db:migrate && npm run db:seed && npm run dev
cd web && npm install && npm run dev      # in another terminal
```

Open http://localhost:3000.

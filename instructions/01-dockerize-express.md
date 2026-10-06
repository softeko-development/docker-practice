# Guide 1: Dockerize the Express API

Goal: build an image for [api/](../api/) and run it as a container.

By the end you will have `api/Dockerfile` and `api/.dockerignore`, and `curl localhost:4000/health` will answer from inside a container.

## Concepts in 2 minutes

- **Image**: a read-only package containing your app and everything it needs to run.
- **Container**: a running instance of an image.
- **Dockerfile**: the recipe for building an image. Each instruction creates a cached **layer**.
- **Multi-stage build**: use one stage with all the build tools, then copy only the results into a small final stage.

## What the API needs

Look at [api/package.json](../api/package.json) and [api/.env](../api/.env).

- `npm run build` compiles TypeScript from `src/` into `dist/`.
- `npm start` runs `node dist/server.js`.
- It reads `PORT`, `DATABASE_URL` and `CORS_ORIGIN` from **environment variables**.
- `package.json` has `"type": "module"`, so the final image needs `package.json` too.

## Step 1: `.dockerignore`

Create `api/.dockerignore`. It stops files from being sent to Docker and copied into the image.

It should list at least:

```
node_modules
dist
.env
.git
```

Question: why is `.env` on this list?

## Step 2: First Dockerfile (single stage)

Create `api/Dockerfile` with these steps, in this order:

1. Start from `node:22-alpine`.
2. Set the working directory to `/app`.
3. Copy `package.json` and `package-lock.json`.
4. Run `npm ci`.
5. Copy the rest of the source.
6. Run `npm run build`.
7. Document port 4000 with `EXPOSE`.
8. Start the app with `CMD ["node", "dist/server.js"]`.

Build it:

```sh
docker build -t practice-api ./api
```

Check the size:

```sh
docker image ls practice-api
```

Write the size down. You will compare it later.

## Step 3: Run it

The API needs `DATABASE_URL` to start (it validates it at boot). The database does not exist yet, so the server will start but requests that touch the DB will fail. That is fine for now.

```sh
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgres://postgres:postgres@localhost:5432/practice \
  practice-api
```

In another terminal:

```sh
curl localhost:4000/health
```

Expected: `{"status":"ok"}`

Understand the flags:
- `-p 4000:4000` maps `host:container` ports.
- `-e` sets an environment variable inside the container.
- `--rm` deletes the container when it stops.

Try running it **without** `-e DATABASE_URL=...`. What happens, and why?

Stop it with Ctrl+C.

## Step 4: Use the layer cache

1. Run the build again. It should finish instantly. Why?
2. Change any line in `api/src/app.ts` (add a comment) and build again. Which steps say `CACHED` and which re-run?
3. Does `npm ci` re-run? If it does, your `COPY` order is wrong. Dependencies must be copied and installed **before** the source code.

## Step 5: Make it multi-stage and production-ready

Your image currently contains dev dependencies (TypeScript, drizzle-kit, tsx) and source files it never uses at runtime. Fix that.

Split the Dockerfile into three stages:

| Stage name | Purpose | Contents |
| --- | --- | --- |
| `build` | Compile TypeScript | all deps, source, runs `npm run build` |
| `deps` | Production deps only | `npm ci --omit=dev` |
| `runner` | Final image | `node_modules` from `deps`, `dist` from `build`, `package.json` |

Use `COPY --from=<stage> ...` to move files between stages.

In the `runner` stage also:
- set `ENV NODE_ENV=production`
- switch to the non-root user with `USER node`

**Name the first stage `build`** (`FROM node:22-alpine AS build`). Guide 3 reuses it to run database migrations.

Rebuild and compare:

```sh
docker build -t practice-api ./api
docker image ls practice-api
```

The image should be noticeably smaller.

## Step 6: Verify

```sh
docker run --rm -p 4000:4000 -e DATABASE_URL=postgres://u:p@localhost:5432/d practice-api
```

In another terminal:

```sh
curl localhost:4000/health
docker ps                                   # copy the container id
docker exec <container-id> whoami           # should print: node
docker exec <container-id> ls /app          # no src/, only dist, node_modules, package.json
```

## Checklist

- [ ] `.dockerignore` exists and excludes `node_modules`, `dist`, `.env`, `.git`
- [ ] Multi-stage Dockerfile with a stage named `build`
- [ ] Base image has a pinned tag (not `latest`)
- [ ] `npm ci` layer is cached when only source files change
- [ ] Container runs as `node`, not `root`
- [ ] `curl localhost:4000/health` returns `{"status":"ok"}`
- [ ] You can explain why `.env` is not copied into the image

## Common problems

| Problem | Likely cause |
| --- | --- |
| `Cannot find module '/app/dist/server.js'` | The build stage failed or you did not copy `dist` into `runner` |
| `ERR_MODULE_NOT_FOUND` / `Unknown file extension` | `package.json` is missing from the final image |
| `Invalid environment variables` on start | You forgot `-e DATABASE_URL=...` |
| `permission denied ... /var/run/docker.sock` | Your user is not in the `docker` group. See the prerequisites in the [README](README.md) |
| `Cannot connect to the Docker daemon` | Daemon not running: `sudo systemctl start docker` |
| Port already in use | Another process uses 4000. Stop it or use `-p 4001:4000` |
| Can't reach the server from the host | The app must listen on all interfaces. Express's default does, so check your `-p` flag |

<details>
<summary>Solution (open only after trying)</summary>

`api/.dockerignore`

```
node_modules
dist
.env
.git
```

`api/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

Why this order: `package*.json` changes rarely, so `npm ci` stays cached. Source changes often, so it is copied after.

</details>

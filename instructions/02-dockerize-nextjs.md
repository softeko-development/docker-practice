# Guide 2: Dockerize the Next.js App

Goal: build an image for [web/](../web/) and run it as a container.

By the end you will have `web/Dockerfile` and `web/.dockerignore`. Finish [Guide 1](01-dockerize-express.md) first; this one assumes you know the basics.

## What the web app needs

Look at [web/package.json](../web/package.json), [web/.env](../web/.env) and [web/next.config.ts](../web/next.config.ts).

- `npm run build` creates the production build in `.next/`.
- `npm start` runs it on port 3000.
- It reads **one** environment variable, `API_URL`, and only on the **server** (server components and server actions). The browser never calls the API directly.

## Concept: build time vs run time

| | When | Example |
| --- | --- | --- |
| Build time | `docker build` | `npm run build` |
| Run time | `docker run` / compose | `API_URL` |

Good images do **not** bake run-time config in. The same image should work in dev, staging and prod just by changing environment variables. The web app is already written this way: `API_URL` is only read when a request arrives.

## Step 1: `.dockerignore`

Create `web/.dockerignore`. Include at least:

```
node_modules
.next
.env
.git
```

## Step 2: Enable standalone output

A normal Next.js install needs the whole `node_modules` (hundreds of MB) at runtime. **Standalone output** traces which files are really needed and copies them to `.next/standalone`, together with a tiny `server.js`.

Edit [web/next.config.ts](../web/next.config.ts) and add `output: "standalone"` to the config object.

Try it locally to see what it does:

```sh
cd web && npm run build && ls .next/standalone
```

Look for `server.js`. Then delete the build output: `rm -rf .next`.

## Step 3: Write the Dockerfile

Create `web/Dockerfile` with **three stages**:

| Stage | Base | Does |
| --- | --- | --- |
| `deps` | `node:22-alpine` | copy `package*.json`, `npm ci` |
| `build` | `node:22-alpine` | copy `node_modules` from `deps`, copy source, `npm run build` |
| `runner` | `node:22-alpine` | copy only what's needed to run, start the server |

In the `runner` stage you need these three copies from the `build` stage:

| From (`build` stage) | To (`runner` stage) |
| --- | --- |
| `/app/.next/standalone` | `./` |
| `/app/.next/static` | `./.next/static` |
| `/app/public` | `./public` |

Standalone does **not** include `static` and `public` automatically, so forgetting those two gives you a site with no CSS and no assets.

Also set in `runner`:

```dockerfile
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
```

`HOSTNAME=0.0.0.0` is important. Without it Next listens on the container's own hostname only, and you cannot reach it from outside.

Finish with `USER node`, `EXPOSE 3000` and `CMD ["node", "server.js"]`.

## Step 4: Build and run

```sh
docker build -t practice-web ./web
docker image ls practice-web
```

Run it. Pass `API_URL` at **run time**:

```sh
docker run --rm -p 3000:3000 -e API_URL=http://host.docker.internal:4000/api practice-web
```

Open http://localhost:3000.

- With no API running, you should see an error page. That is expected.
- `host.docker.internal` is a special name Docker Desktop provides that points to your computer. Inside a container, `localhost` means the container itself.

To see it fully working you need the API and DB. That is Guide 3.

## Step 5: Experiments (learning)

1. Remove the `COPY ... static` line, rebuild, reload the page. What breaks?
2. Remove `HOSTNAME=0.0.0.0`, rebuild, run. What happens? (Try `docker logs`.)
3. Turn standalone off, rebuild and compare image sizes. Put the line back.

## Checklist

- [ ] `.dockerignore` excludes `node_modules`, `.next`, `.env`, `.git`
- [ ] `output: "standalone"` is enabled
- [ ] Multi-stage Dockerfile with pinned base image
- [ ] `static` and `public` are copied to the final image
- [ ] Runs as `node`, listens on `0.0.0.0:3000`
- [ ] `API_URL` is **not** baked into the image
- [ ] You can explain why `localhost` as `API_URL` fails inside a container

## Common problems

| Problem | Likely cause |
| --- | --- |
| `Cannot find module 'server.js'` | `.next/standalone` was copied to the wrong place. `server.js` must end up at `/app/server.js` |
| Page loads without styles | `.next/static` missing |
| Connection refused from browser | `HOSTNAME=0.0.0.0` missing or wrong `-p` mapping |
| `API_URL is not set` | You did not pass `-e API_URL=...` at run time |
| `fetch failed` on the page | The API is not reachable at that URL |

<details>
<summary>Solution (open only after trying)</summary>

`web/.dockerignore`

```
node_modules
.next
.env
.git
```

`web/next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

`web/Dockerfile`

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

</details>

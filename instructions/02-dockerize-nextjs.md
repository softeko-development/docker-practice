# Guide 2: Dockerize the Next.js App

Goal: build an image for [web/](../web/) and run it as a container.

By the end you will have `web/Dockerfile` and `web/.dockerignore`. Finish [Guide 1](01-dockerize-express.md) first; this one assumes you know the basics.

## What the web app needs

Look at [web/package.json](../web/package.json), [web/.env](../web/.env) and [web/next.config.ts](../web/next.config.ts).

- `npm run build` creates the production build in `.next/`.
- `npm start` runs it on port 3000.
- It reads **two** environment variables, and the difference between them is the main lesson of this guide:

| Variable | Used by | Runs where | When is it read? |
| --- | --- | --- | --- |
| `API_URL` | server components (the users list) | inside the Next.js container | **run time** |
| `NEXT_PUBLIC_API_URL` | client components (the "New user" modal) | in the **user's browser** | **build time** |

## Concept: build time vs run time

| | When | Example |
| --- | --- | --- |
| Build time | `docker build` | `npm run build` |
| Run time | `docker run` / compose | `API_URL` |

Good images do **not** bake run-time config in. The same image should work in dev, staging and prod just by changing environment variables. `API_URL` works this way: it is only read when a request arrives.

`NEXT_PUBLIC_API_URL` is the exception. Next.js finds every `process.env.NEXT_PUBLIC_*` in your code during `npm run build` and **replaces it with the literal value** in the JavaScript sent to the browser. After the build, changing the env var does nothing. So it must be provided **at build time**, and in Docker that means a **build argument** (`ARG`).

## Concept: who can reach what?

Code in a **server component** runs inside the web container. In Docker Compose it can call the API by service name: `http://api:4000/api`.

Code in a **client component** runs in the **browser on your computer**. The browser knows nothing about Docker's internal network, so `http://api:4000` means nothing to it. It must use an address reachable from the host: `http://localhost:4000/api` (the port the API publishes).

So the same API has two different URLs depending on who is calling:

```
browser ──► http://localhost:4000/api   (NEXT_PUBLIC_API_URL, published port)
web container ──► http://api:4000/api   (API_URL, compose network)
```

Because the browser calls the API directly (from `localhost:3000` to `localhost:4000`), the API must allow that origin with CORS. It does: see `CORS_ORIGIN` in [api/.env](../api/.env).

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

In the `build` stage, **before** `RUN npm run build`, declare the build argument and turn it into an environment variable so Next.js can see it:

```dockerfile
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
```

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
docker build -t practice-web \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000/api \
  ./web
docker image ls practice-web
```

Run it. Pass `API_URL` at **run time**:

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e API_URL=http://host.docker.internal:4000/api \
  practice-web
```

Open http://localhost:3000.

- With no API running, you should see an error page. That is expected.
- Inside a container, `localhost` means the container itself, so it can't be used to reach something running on your computer.
- `host.docker.internal` is a name for "the host machine". Docker Desktop (Mac/Windows) provides it automatically, but **Docker Engine on Linux does not**, so we add it with `--add-host=host.docker.internal:host-gateway`.
- Only needed when the API runs on your host. In Compose you will use the service name `api` instead.

To see it fully working you need the API and DB. That is Guide 3.

## Step 5: Experiments (learning)

1. Build the image **without** `--build-arg`, run it, open the modal and submit the form. Open the browser dev tools Network tab. Which URL was called? (`undefined/users`.) Why is setting `-e NEXT_PUBLIC_API_URL=...` on `docker run` not a fix?
2. Run `docker run --rm practice-web grep -r "localhost:4000" .next/static | head -1` (use `sh -c` if needed) to see the URL baked into the JavaScript.
3. Remove the `COPY ... static` line, rebuild, reload the page. What breaks?
4. Remove `HOSTNAME=0.0.0.0`, rebuild, run. What happens? (Try `docker logs`.)
5. Turn standalone off, rebuild and compare image sizes. Put the line back.

## Checklist

- [ ] `.dockerignore` excludes `node_modules`, `.next`, `.env`, `.git`
- [ ] `output: "standalone"` is enabled
- [ ] Multi-stage Dockerfile with pinned base image
- [ ] `static` and `public` are copied to the final image
- [ ] Runs as `node`, listens on `0.0.0.0:3000`
- [ ] `API_URL` is **not** baked into the image (run time), `NEXT_PUBLIC_API_URL` is passed as a build arg
- [ ] You can explain why `localhost` as `API_URL` fails inside a container
- [ ] You can explain why `NEXT_PUBLIC_API_URL` must be `localhost:4000` and not `api:4000`
- [ ] You can explain why changing `NEXT_PUBLIC_API_URL` needs a rebuild

## Common problems

| Problem | Likely cause |
| --- | --- |
| `Cannot find module 'server.js'` | `.next/standalone` was copied to the wrong place. `server.js` must end up at `/app/server.js` |
| Page loads without styles | `.next/static` missing |
| Connection refused from browser | `HOSTNAME=0.0.0.0` missing or wrong `-p` mapping |
| `API_URL is not set` | You did not pass `-e API_URL=...` at run time |
| Modal calls `undefined/users` | `NEXT_PUBLIC_API_URL` was not passed as a build arg (or you changed it without rebuilding) |
| Browser console: CORS error | The API's `CORS_ORIGIN` does not include the origin the page is served from |
| Browser: `ERR_NAME_NOT_RESOLVED` for `api` | `NEXT_PUBLIC_API_URL` uses the compose service name; the browser can't resolve it |
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
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
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

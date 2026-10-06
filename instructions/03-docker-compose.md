# Guide 3: Run Everything with Docker Compose

Goal: one `docker-compose.yml` that runs **db**, **api** and **web** together.

Prerequisite: [Guide 1](01-dockerize-express.md) and [Guide 2](02-dockerize-nextjs.md) done. Both Dockerfiles must build.

Work in the project root (the folder that contains `api/` and `web/`).

## Concepts in 2 minutes

- **Compose** describes several containers in one YAML file and starts them with one command.
- Each entry under `services:` becomes a container.
- Compose creates a **network**. Services reach each other **by service name**: the API connects to the DB at host `db`, not `localhost`.
- **Volumes** keep data after a container is deleted.
- `depends_on` controls start order. `condition: service_healthy` waits until a healthcheck passes.

## Step 0: Root `.env`

Compose automatically reads a `.env` file next to `docker-compose.yml` and lets you use `${VARIABLE}` in the YAML. Create two files in the root:

`.env.example` (committed):

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me
POSTGRES_DB=practice
```

Then copy it: `cp .env.example .env` and edit `.env`. `.env` must never be committed.

## Step 1: The database

Create `docker-compose.yml`:

```yaml
services:
  db:
    image: ???                 # official postgres, pinned, e.g. 16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ???
      POSTGRES_DB: ???
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ???                # use pg_isready
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

Fill in the `???`. Hints:
- Image: `postgres:16-alpine`.
- Healthcheck uses `CMD-SHELL`. Inside a compose file, a literal `$` must be written as `$$` if you want the container's shell to expand it.

Start only the DB:

```sh
docker compose up -d db
docker compose ps
```

Wait until the status shows `healthy`. Then open a SQL shell:

```sh
docker compose exec db psql -U postgres -d practice
```

Type `\dt` (no tables yet) and `\q` to leave.

**Test persistence:**

```sh
docker compose down        # removes containers, keeps the volume
docker compose up -d db
```

Is your data still there? Now try `docker compose down -v` (also removes volumes). What changed?

Notice there is no `ports:` entry. The DB is only reachable from other containers, which is what we want.

## Step 2: Run migrations

The API needs its tables before it is useful. The production `runner` image has no `tsx` or `drizzle` CLI, but your Dockerfile's `build` stage has everything. Add a **one-shot service** built from that stage:

```yaml
  migrate:
    build:
      context: ./api
      target: build              # use the "build" stage of the Dockerfile
    command: npm run db:migrate
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy
    restart: "no"
```

Notice the host in `DATABASE_URL` is `db`, the service name.

Run it:

```sh
docker compose run --rm migrate
```

Expected output: `Migrations applied`. Verify:

```sh
docker compose exec db psql -U postgres -d practice -c '\dt'
```

You should see the `users` table.

Optional seed data (25 users):

```sh
docker compose run --rm migrate npm run db:seed
```

## Step 3: The API

Add:

```yaml
  api:
    build: ./api
    environment:
      NODE_ENV: production
      PORT: "4000"
      DATABASE_URL: ???            # same as migrate
      CORS_ORIGIN: http://localhost:3000
    ports:
      - "4000:4000"
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped
```

`service_completed_successfully` means: wait until `migrate` has exited with code 0. So migrations now run automatically on every `up`.

Start it:

```sh
docker compose up -d --build api
docker compose ps
curl localhost:4000/health
curl "localhost:4000/api/users?limit=3"
curl -X POST localhost:4000/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}'
```

Also try sending invalid data (`"email":"nope"`) and a duplicate email. What status codes do you get?

Look at the logs: `docker compose logs -f api`.

## Step 4: The web app

Add:

```yaml
  web:
    build:
      context: ./web
      args:
        NEXT_PUBLIC_API_URL: ???   # BUILD time: used by the browser
    environment:
      API_URL: ???                 # RUN time: used by the Next.js server
    ports:
      - "3000:3000"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
```

The web app talks to the API from **two different places**, so it needs two different URLs:

| Variable | Who calls the API? | Network it is on | Value |
| --- | --- | --- | --- |
| `API_URL` | Next.js **server** (users list) inside the web container | compose network | service name + container port + `/api` |
| `NEXT_PUBLIC_API_URL` | the **browser** (create-user modal) on your computer | your host machine | `localhost` + the **published** port + `/api` |

The browser cannot resolve `api`; that name only exists inside Docker. It reaches the API through the published port `4000:4000`.

`NEXT_PUBLIC_API_URL` is baked in at build time, so it goes under `build.args` (which feed the `ARG` you wrote in Guide 2), not under `environment`. Changing it later means rebuilding: `docker compose up -d --build web`.

Start everything:

```sh
docker compose up -d --build
docker compose ps
```

Open http://localhost:3000, check the list, click **New user**, create one. It should show up at once.

## Step 5: Experiments

1. `docker compose stop api` then reload the web page. What do you see? Start it again with `docker compose start api`.
2. Change `API_URL` to `http://localhost:4000/api`, restart web (`docker compose up -d web`). The list fails to load. Why? Revert it.
2b. Now change `NEXT_PUBLIC_API_URL` to `http://api:4000/api` and rebuild (`docker compose up -d --build web`). The list still loads (server-side), but creating a user fails. Open the browser dev tools. What error do you see, and why? Revert it.
2c. Change only `CORS_ORIGIN` on the api to `http://localhost:9999` and restart it. Create a user. What does the browser report? Revert it.
3. `docker compose exec web sh`, then `wget -qO- http://api:4000/health`. Name resolution works. Try `wget -qO- http://db:5432`. It can resolve the name, so web and db can currently talk to each other. Is that good?
4. `docker compose down`, `docker compose up -d`. Is your user still in the list? Why?
5. `docker compose config` prints the final merged YAML with variables filled in.

## Step 6: Network isolation (stretch)

The web app has no reason to reach the database. Create two networks:

- `frontend`: web and api
- `backend`: api and db

Add a top-level `networks:` section, then add `networks:` to each service. Prove it by running the `wget` test from the web container again; it should now fail to resolve `db`.

## Final checklist

- [ ] `docker compose up -d --build` from scratch brings up a working stack (after copying `.env.example` to `.env`)
- [ ] `docker compose ps` shows `db` and `api` as `healthy`
- [ ] The web page lists users and the modal creates a user
- [ ] Data survives `docker compose down` + `up`
- [ ] Only ports 3000 and 4000 are published; the DB is not
- [ ] No passwords are written directly in `docker-compose.yml`
- [ ] You can explain why `DATABASE_URL` uses host `db` and `API_URL` uses host `api`
- [ ] You can explain why `NEXT_PUBLIC_API_URL` uses `localhost:4000` and is a build arg, not an environment variable

## Common problems

| Problem | Likely cause |
| --- | --- |
| `variable is not set` warning | Missing root `.env` |
| API exits with `Invalid environment variables` | `DATABASE_URL` empty or misspelled |
| `ECONNREFUSED 127.0.0.1:5432` | You used `localhost` instead of `db` |
| `password authentication failed` | The DB volume was created with an older password. Run `docker compose down -v` and start again |
| Web shows `fetch failed` | `API_URL` wrong, or the API is not healthy |
| List loads but creating a user fails | `NEXT_PUBLIC_API_URL` wrong (browser can't reach it), changed without rebuilding, or the API's `CORS_ORIGIN` doesn't match |
| Healthcheck always `unhealthy` | `wget` missing in image, wrong port, or the app is not listening yet. See `docker inspect --format '{{json .State.Health}}' <container>` |
| Changed code but nothing changed | Rebuild: `docker compose up -d --build` |

## Useful commands

```sh
docker compose up -d --build   # build and start in the background
docker compose ps              # status and health
docker compose logs -f api     # follow one service's logs
docker compose exec api sh     # shell inside a running container
docker compose down            # stop and remove containers
docker compose down -v         # ...and delete volumes (wipes the DB)
docker compose config          # show the final resolved file
```

<details>
<summary>Solution (open only after trying)</summary>

`.env.example`

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me
POSTGRES_DB=practice
```

`docker-compose.yml`

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  migrate:
    build:
      context: ./api
      target: build
    command: npm run db:migrate
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  api:
    build: ./api
    environment:
      NODE_ENV: production
      PORT: "4000"
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      CORS_ORIGIN: http://localhost:3000
    ports:
      - "4000:4000"
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  web:
    build:
      context: ./web
      args:
        NEXT_PUBLIC_API_URL: http://localhost:4000/api
    environment:
      API_URL: http://api:4000/api
    ports:
      - "3000:3000"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
```

Step 6 (networks): add to the file

```yaml
networks:
  frontend:
  backend:
```

and per service: `db` → `networks: [backend]`, `migrate` → `[backend]`, `api` → `[frontend, backend]`, `web` → `[frontend]`.

</details>

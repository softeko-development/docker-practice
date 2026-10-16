# Task 4: Make the Users API a Real REST API

Goal: take the existing `users` endpoints and make them follow REST conventions properly: all the HTTP methods, correct status codes, validation, caching with ETag, versioning, simple authentication and authorization, and hypermedia links (HATEOAS).

You will work on the **users resource that already exists**. No new resource. Everything stays in:

- [api/src/routes/users.ts](../api/src/routes/users.ts): the handlers (one file, read it top to bottom first)
- [api/src/server.ts](../api/src/server.ts): middleware, route mounting, error handler
- [api/src/db/schema.ts](../api/src/db/schema.ts): table definition

If you need a helper (for example auth), add **one small file** next to them, such as `api/src/auth.ts`. Do not build controller/service layers; the point is that anyone can read an endpoint in one screen.

## Stuck? Use the implementation guide

[04-rest-api-implementation.md](04-rest-api-implementation.md) explains **how** to build every level, with code, explanations and tests, plus a detailed write-up of each stretch goal. Rule of thumb:

1. Try the level yourself for at least 30 minutes.
2. Still stuck? Read **only that level's section** in the guide.
3. Close the guide and write the code again without looking.

## How to work

- Do the levels **in order**. Commit after each level.
- After each level run the `curl -i` commands from that level. `-i` shows the status line and headers, which is where most of the REST behavior is.
- The existing web app must **keep working** at the end (list loads, modal creates a user). Part of the task is not breaking your client when you change the API.
- Everything must run in Docker (`docker compose up --build`) at the end, not just on your machine.

## What exists today

```sh
curl -i "localhost:4000/api/users?page=1&limit=3"
curl -i -X POST localhost:4000/api/users -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}'
```

Run both and look at the responses. Write down what is **missing or wrong** compared with a good REST API (hint: look at the headers of the POST response, and try to fetch the user you just created by id).

---

## Level 1: Complete the CRUD

> How to: [implementation guide, Level 1](04-rest-api-implementation.md#level-1-complete-the-crud)

Add the missing endpoints to `users.ts`:

| Method | URL | Purpose | Success status |
| --- | --- | --- | --- |
| `GET` | `/users` | List (already exists) | `200` |
| `GET` | `/users/:id` | Get one user | `200` |
| `POST` | `/users` | Create (already exists, must be improved) | `201` |
| `PUT` | `/users/:id` | **Replace** a user: all fields required | `200` |
| `PATCH` | `/users/:id` | **Partially** update: any subset of fields | `200` |
| `DELETE` | `/users/:id` | Delete | `204` |

Rules:
- `POST` returns `201 Created`, the created user in the body, **and** a `Location: /api/users/<id>` header.
- `DELETE` returns `204 No Content` with an **empty body**.
- `PUT` with a missing required field is an error. `PATCH` with the same body is fine. `PATCH` with `{}` is an error.
- Clients must not be able to set `id` or `createdAt` through the body. Unknown fields must be rejected or ignored, never saved.
- Add an `updated_at` column to the `users` table (default now, and set to now on every change). Generate the migration with `npm run db:generate`, commit the new file in `api/drizzle/`, and apply it.
- Changing the email to one that belongs to another user returns `409`.

Add `:id` validation: `/users/abc`, `/users/-1`, `/users/1.5` return `400`.

### Fill in this table by testing (keep it, your mentor will check it)

| Situation | Status you return |
| --- | --- |
| User created | |
| User found / updated | |
| User deleted | |
| Body is not valid JSON | |
| Valid JSON but fails validation | (`400` or `422`: pick one, use it everywhere) |
| `:id` is not a positive integer | |
| User does not exist (GET, PUT, PATCH, DELETE) | |
| Email already used by someone else | |
| Wrong method on a known URL (`POST /users/1`) | (hint: `405` + `Allow` header) |
| Request `Content-Type` is not JSON | (hint: `415`) |
| Request body is huge | (hint: `413`) |
| Unknown URL | |
| Unexpected crash | (no stack trace in the body) |

### Safe and idempotent

Prove with `curl` and write down the result:
- `GET` is **safe**: it never changes data.
- `PUT` and `DELETE` are **idempotent**: calling twice leaves the same final state. What does the second `DELETE /users/5` return? Why is that still idempotent?
- `POST` is **not** idempotent: two identical calls... what happens in your API, and why (hint: the unique email)?

---

## Level 2: A better collection endpoint

> How to: [implementation guide, Level 2](04-rest-api-implementation.md#level-2-a-better-collection-endpoint)

`GET /users` must support:

| Query param | Meaning | Rules |
| --- | --- | --- |
| `page`, `limit` | pagination | already there; `limit` max 100 |
| `search` | name or email contains text | already there |
| `sort` | `id`, `name`, `email` or `createdAt` | **whitelist** these; default `id` |
| `order` | `asc` or `desc` | default `desc` |
| `createdAfter` | ISO date; only users created after it | invalid date → `400` |

Requirements:
- Never put a raw query-string value into SQL or `ORDER BY`. `?sort=password` must return `400`, not a silent fallback.
- Add pagination headers: `X-Total-Count` and a `Link` header (`rel="next"`, `rel="prev"`).
- An empty result is `200` with `"data": []`, never `404`.

### The CORS trap

The web app runs on another origin (`localhost:3000`) and calls the API from the browser. By default JavaScript in the browser can **not read** custom response headers such as `Location`, `X-Total-Count` or `ETag`. Find out how `cors({ exposedHeaders: [...] })` fixes this, and prove it: log `res.headers.get("X-Total-Count")` in the browser console from the web page before and after.

---

## Level 3: Caching and ETag

> How to: [implementation guide, Level 3](04-rest-api-implementation.md#level-3-caching-and-etag)

An **ETag** is a fingerprint of a response. The client sends it back later and the server can answer `304 Not Modified` with no body, saving bandwidth.

1. Run `curl -i localhost:4000/api/users/1`. Notice Express **already** sends an `ETag` header. Find out how (look up the Express `etag` setting) and whether it is strong (`"abc"`) or weak (`W/"abc"`).
2. Repeat the request with the header the server gave you:

   ```sh
   curl -i localhost:4000/api/users/1 -H 'If-None-Match: <the etag>'
   ```

   You should get `304` with no body.
3. Make the ETag for a single user **meaningful**: build it from the user's `id` and `updated_at` (for example `"1-1759744800000"`). Set it yourself with `res.set("ETag", ...)` and return `304` yourself when `If-None-Match` matches. Why would you do this instead of letting Express hash the whole body?
4. Add `Cache-Control` headers and be able to justify each:
   - `GET /users/:id` → `private, max-age=...` or `no-cache` (pick and explain the difference)
   - `GET /users` → something shorter, or `no-cache`
   - any response that is not a `GET` → `no-store`
5. **Optimistic concurrency** with `If-Match`:
   - `PUT` and `PATCH` require an `If-Match` header with the ETag the client last saw.
   - Missing header → `428 Precondition Required`.
   - ETag does not match the current one (someone else changed the user) → `412 Precondition Failed`.
   - On success, return the **new** `ETag`.

Prove the concurrency rule with two terminals: read the user in both, update from terminal A (works), then update from terminal B with the old ETag (`412`).

---

## Level 4: Versioning

> How to: [implementation guide, Level 4](04-rest-api-implementation.md#level-4-versioning)

Clients depend on your URLs and response shape. You must be able to change them without breaking old clients.

1. Mount the users router under `/api/v1/users` in `server.ts`.
2. The old `/api/users/...` URL must not silently vanish. Choose one and explain why:
   - respond `308 Permanent Redirect` to the `/api/v1` URL, or
   - keep it working and add `Deprecation: true` and `Sunset: <date>` headers, or
   - respond `410 Gone` with a message that points to `/api/v1`.
3. **Update the web app** so it still works: the `API_URL` and `NEXT_PUBLIC_API_URL` values must now end in `/api/v1`. Change them in `web/.env`, `web/.env.example` and `docker-compose.yml`. Rebuild with `docker compose up -d --build`. (Remember: why does `NEXT_PUBLIC_API_URL` need a rebuild but `API_URL` does not?)
4. Explain to your mentor how you would introduce `/api/v2` where users have a single `fullName` field instead of `name`, without breaking `/api/v1` clients. (Implementing a `v2` is a stretch goal.)

---

## Level 5: Authentication and authorization (dummy)

> How to: [implementation guide, Level 5](04-rest-api-implementation.md#level-5-authentication-and-authorization)

We will not build real login. We use **fixed tokens** so you learn the HTTP side of security: who are you (authentication) and what may you do (authorization).

1. Add two env vars to `api/.env`, `api/.env.example`, validate them in [api/src/env.ts](../api/src/env.ts) and pass them in `docker-compose.yml`:

   ```
   ADMIN_TOKEN=admin-secret-token
   USER_TOKEN=user-secret-token
   ```

2. Write a middleware that reads `Authorization: Bearer <token>`, and sets the caller's role (`admin`, `user`) on `res.locals` (or rejects the request).
3. Apply these rules:

   | Endpoint | Who can call it |
   | --- | --- |
   | `GET /users`, `GET /users/:id` | any valid token (`user` or `admin`) |
   | `POST /users` | **public** (this is "sign up") |
   | `PUT`, `PATCH`, `DELETE` | `admin` only |
   | `GET /health` | public |

4. Return the right codes and headers:
   - No token, malformed header or unknown token → `401 Unauthorized` plus a `WWW-Authenticate: Bearer` header.
   - Valid token but not allowed (a `user` calling `DELETE`) → `403 Forbidden`.
   - Be able to explain **401 vs 403** in one sentence.
5. Compare tokens in constant time (`crypto.timingSafeEqual`) and explain what a timing attack is.
6. **Keep the web app working.** The users list is fetched on the Next.js **server**, so it can send the token. Add a server-only env var `API_TOKEN` to the web app (no `NEXT_PUBLIC_` prefix!) and send it in `web/src/lib/api.ts`. The create-user modal calls the public `POST` and needs no token.
7. Think and answer: why must you **never** call an admin endpoint from the browser with the token in `NEXT_PUBLIC_*`? Open the built JS in the browser's dev tools and search for it to see what happens.

---

## Level 6: Hardening

> How to: [implementation guide, Level 6](04-rest-api-implementation.md#level-6-hardening)

- **Rate limit** `POST /users` (for example 5 per minute per IP) with `express-rate-limit`. Over the limit → `429` with a `Retry-After` header.
- **Consistent errors.** Every error from every endpoint uses the same shape:

  ```json
  { "message": "Validation failed", "errors": { "email": ["Invalid email address"] } }
  ```

  Malformed JSON currently falls into the generic handler. Make it return `400` with this shape. No stack traces, SQL or table names in any response.
- **Response hygiene.** Keys are camelCase, timestamps are ISO-8601, lists are `[]` never `null`.
- **Content negotiation.** If the client sends `Accept: application/xml` return `406 Not Acceptable`.
- **Request ID.** Generate an id per request (`crypto.randomUUID()`), return it as `X-Request-Id`, and include it in your error log lines.
- **Helmet** is already enabled. Look at the headers it adds with `curl -i` and name three of them and what they protect against.

---

## Level 7: Hypermedia (HATEOAS)

> How to: [implementation guide, Level 7](04-rest-api-implementation.md#level-7-hypermedia-hateoas)

So far a client must **know** your URLs (`/api/v1/users/5`, `?page=2`). In a hypermedia API the response tells the client where it can go next, and the client follows links instead of building URLs.

Requirements:

1. **Entry point.** `GET /api/v1` is public and returns links to the main things a client can do (`users`, `signup`, `health`, and itself).
2. **Link format.** Every response that contains links uses one `_links` object. Each link is `{ "href": "...", "method": "..." }`, and the key is the relation name (`self`, `collection`, `next`, `prev`, `first`, `last`, `create`, `update`, `replace`, `delete`).
3. **Single user** (`GET`, `POST`, `PUT`, `PATCH` responses): `self` and `collection` for everybody. `replace`, `update` and `delete` **only for admins**.
4. **User list:** each item has its own `_links`; the list itself has `self`, `first`, `last`, `create`, and `next`/`prev` **only when that page exists**. Keep the `Link` header from Level 2 as well.
5. Build every `href` from `req.baseUrl`. No hardcoded `/api/v1` strings in `users.ts`.
6. Add `Vary: Authorization` to the responses whose body now depends on the caller's role. Be able to explain why.
7. The web app must keep working (it ignores the extra field).

Prove it by following links only:
- From `GET /api/v1`, reach the first page of users, then the last page, using nothing but `_links.*.href`.
- With an admin token, delete a user using only the `href` and `method` from that user's `_links.delete`.

Think about:
- A normal user does not get a `delete` link. Is that enough to stop them deleting? What stops them?
- When is a link "a lie"? Give an example for this API.
- What does a client lose if it hardcodes URLs anyway?

---

## Stretch goals

Do these only after everything above works. Each one is explained in detail (goal, why, plan, hints, tests, pitfalls) in the [implementation guide](04-rest-api-implementation.md#stretch-goals-in-detail).

| # | Stretch goal | You practice |
| --- | --- | --- |
| 1 | **`/api/v2`** with `fullName` while v1 stays unchanged | real versioning, mapping layers, per-version ETags |
| 2 | **Soft delete** with restore endpoint | `deleted_at`, partial unique index, `404` vs `410` |
| 3 | **`Idempotency-Key`** on `POST /users` | making a non-idempotent method safe to retry |
| 4 | **`HEAD` and `OPTIONS`**, CORS preflight | what browsers send before your real request |
| 5 | **Field selection** `?fields=id,name` | whitelisting, dynamic selects, caching effects |
| 6 | **OpenAPI** file + Swagger UI at `/docs` | documentation as code, contract-first thinking |
| 7 | **Automated tests** with Vitest + Supertest | proving every status code, test databases |

---

## How you will be reviewed

Your mentor will run commands like these. Run them yourself first.

```sh
A='Authorization: Bearer admin-secret-token'
U='Authorization: Bearer user-secret-token'

# sign up is public; check status and Location
curl -i -X POST localhost:4000/api/v1/users -H 'content-type: application/json' \
  -d '{"name":"Grace Hopper","email":"grace@example.com"}'

# auth
curl -i localhost:4000/api/v1/users                 # 401 + WWW-Authenticate
curl -i localhost:4000/api/v1/users -H "$U"         # 200
curl -i -X DELETE localhost:4000/api/v1/users/1 -H "$U"   # 403

# read, filter, sort, paginate
curl -i localhost:4000/api/v1/users/1 -H "$U"
curl -i "localhost:4000/api/v1/users?search=grace&sort=name&order=asc&limit=5" -H "$U"
curl -i "localhost:4000/api/v1/users?sort=password" -H "$U"          # 400

# caching
curl -i localhost:4000/api/v1/users/1 -H "$U" -H 'If-None-Match: "<etag>"'   # 304

# update with concurrency control
curl -i -X PATCH localhost:4000/api/v1/users/1 -H "$A" -H 'content-type: application/json' -d '{"bio":"hi"}'  # 428
curl -i -X PATCH localhost:4000/api/v1/users/1 -H "$A" -H 'If-Match: "stale"' -H 'content-type: application/json' -d '{"bio":"hi"}'  # 412
curl -i -X PUT   localhost:4000/api/v1/users/1 -H "$A" -H 'If-Match: "<etag>"' -H 'content-type: application/json' \
  -d '{"name":"New Name","email":"new@example.com","bio":null}'

# delete twice
curl -i -X DELETE localhost:4000/api/v1/users/1 -H "$A"

# errors
curl -i -X POST localhost:4000/api/v1/users -H 'content-type: application/json' -d '{bad json'
curl -i -X POST localhost:4000/api/v1/users -H 'content-type: text/plain' -d 'hello'
curl -i -X POST localhost:4000/api/v1/users/1 -H "$A"                 # 405 + Allow
curl -i localhost:4000/api/v1/users/abc -H "$U"
curl -i localhost:4000/api/users                                      # your versioning choice
```

## Checklist

- [ ] All six CRUD endpoints on users, with the correct method semantics and status codes
- [ ] `POST` returns `201` + `Location`; `DELETE` returns `204` with no body
- [ ] `PUT` and `PATCH` behave differently; `updated_at` column + migration committed
- [ ] The status-code table is filled in and matches what the API does
- [ ] Sorting is whitelisted; pagination headers and `Link` are present; custom headers are exposed through CORS
- [ ] `ETag` built from `id` + `updated_at`; `If-None-Match` → `304`
- [ ] `If-Match` required on `PUT`/`PATCH`; `428` and `412` work
- [ ] `Cache-Control` set deliberately on every response type
- [ ] Mounted at `/api/v1`; old path handled intentionally; web app updated and working
- [ ] Bearer-token auth with `401` + `WWW-Authenticate`; role check with `403`
- [ ] Tokens compared in constant time; the web token is server-only (no `NEXT_PUBLIC_`)
- [ ] Rate limit with `429` + `Retry-After`
- [ ] `GET /api/v1` entry point; `_links` on users and on the list; admin-only action links; `Vary: Authorization`
- [ ] One consistent error shape; malformed JSON returns `400`; no internals leaked
- [ ] `docker compose up --build` from a clean state still gives a working app

## Questions to answer in your PR description

1. Why plural nouns in URLs? Why is `/users/5/delete` wrong?
2. What does `PUT` do that `PATCH` does not? When would a client prefer each?
3. `400` or `422` for validation errors: what did you choose and why?
4. Why is a second `DELETE` returning `404` still idempotent?
5. Explain `401` vs `403` vs `404` for "a user tries to delete someone else's data".
6. What problem do `ETag` + `If-Match` solve that `updated_at` in the JSON body alone does not?
7. What is the difference between `no-cache`, `no-store` and `max-age`?
8. Why can the Next.js server send `API_TOKEN` but the browser can't?
9. Which of your decisions would break existing clients if you changed it later, and how does versioning help?
10. What would you split out of `users.ts` first if it grew to 800 lines?
11. What is HATEOAS, and what does a client gain and lose when it follows links instead of building URLs?
12. Why is hiding the `delete` link not an authorization mechanism?

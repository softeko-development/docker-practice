# Task 4: Implementation Guide

This is the "how" for [04-rest-api-task.md](04-rest-api-task.md). **Try each level yourself first.** Open this guide when you are stuck, read only the part for that level, then close it and write the code again in your own words.

The code for Levels 1 to 7 and the reference files at the bottom were run against a real database with the `curl` commands from the task. The stretch goals are outlines with hints, not finished code. But the goal is not to copy: for every line you must be able to say what it does and what breaks if you remove it.

## Contents

- [Setup: files you will touch](#setup-files-you-will-touch)
- [Level 1: Complete the CRUD](#level-1-complete-the-crud)
- [Level 2: A better collection endpoint](#level-2-a-better-collection-endpoint)
- [Level 3: Caching and ETag](#level-3-caching-and-etag)
- [Level 4: Versioning](#level-4-versioning)
- [Level 5: Authentication and authorization](#level-5-authentication-and-authorization)
- [Level 6: Hardening](#level-6-hardening)
- [Level 7: Hypermedia (HATEOAS)](#level-7-hypermedia-hateoas)
- [Docker and web app changes](#docker-and-web-app-changes)
- [Stretch goals in detail](#stretch-goals-in-detail)
- [Complete reference files](#complete-reference-files)

---

## Setup: files you will touch

| File | Why |
| --- | --- |
| `api/src/routes/users.ts` | all user endpoints |
| `api/src/server.ts` | middleware, versioning, error handler |
| `api/src/auth.ts` (new) | token check and role check |
| `api/src/env.ts` | the two new token variables |
| `api/src/db/schema.ts` | `updated_at` column |
| `api/drizzle/` | the generated migration |

Install the one new dependency:

```sh
cd api && npm install express-rate-limit
```

(In Docker the image is rebuilt with `docker compose up --build`, so `package.json` and `package-lock.json` must both be committed.)

---

## Level 1: Complete the CRUD

### 1.1 Add `updated_at`

In `api/src/db/schema.ts` add one column to the `users` table:

```ts
updatedAt: timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date()),
```

- `defaultNow()` fills it on insert.
- `$onUpdate(...)` makes Drizzle set it to the current time on **every** `db.update(...)`. You do not set it by hand.

Generate and apply the migration:

```sh
cd api
npm run db:generate      # creates drizzle/0001_xxx.sql: ALTER TABLE ... ADD COLUMN "updated_at" ...
npm run db:migrate       # applies it to your local database
```

Open the generated `.sql` file and read it. Commit it. In Docker the `migrate` service applies it for you.

### 1.2 Read one user: `GET /users/:id`

Three small pieces are needed.

**Validate the id.** `req.params.id` is always a string. Zod converts and checks it:

```ts
const idParam = z.coerce.number().int().positive();

const id = idParam.parse(req.params.id);   // "abc", "-1", "1.5" all throw -> 400
```

**A helper to load one row:**

```ts
const findUser = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];
```

`db.select()` always returns an array; `[0]` is the first row or `undefined`.

**The handler:**

```ts
usersRouter.get("/:id", async (req, res) => {
  const user = await findUser(idParam.parse(req.params.id));
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.json({ data: user });
});
```

Why `return` after sending? `res.json` does not stop the function. Without `return` the code continues and tries to send a second response ("Cannot set headers after they are sent").

### 1.3 `POST` returns `201` and `Location`

```ts
res
  .status(201)
  .set("Location", `${req.baseUrl}/${user.id}`)   // /api/v1/users/7
  .json({ data: user });
```

`req.baseUrl` is the path where the router is mounted, so this keeps working when you change the version prefix in Level 4.

### 1.4 `PUT` (replace) and `PATCH` (partial)

They share one idea but differ in validation:

```ts
// .strict() rejects unknown keys such as "id" or "createdAt" instead of ignoring them
const createBody = z
  .object({
    name: cleanString().pipe(z.string().min(2).max(100)),
    email: cleanString().pipe(z.email().max(255)).transform((email) => email.toLowerCase()),
    bio: cleanString().pipe(z.string().max(500)).optional(),
  })
  .strict();

// PATCH: every field optional, but at least one must be sent
const patchBody = createBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field" });
```

- `PUT` uses `createBody`: `name` and `email` are required. A missing `bio` means "no bio", so we store `null`. That is what **replace** means: the new representation completely replaces the old one.
- `PATCH` uses `patchBody`: only the fields that were sent change.

The updates:

```ts
// PUT
const [user] = await db.update(users).set({ ...input, bio: input.bio ?? null }).where(eq(users.id, id)).returning();

// PATCH
const [user] = await db.update(users).set(input).where(eq(users.id, id)).returning();
```

`updated_at` changes by itself because of `$onUpdate`.

**Duplicate email on update.** The unique index would throw an ugly database error. Check first:

```ts
const [taken] = await db.select().from(users).where(and(eq(users.email, input.email), ne(users.id, id)));
if (taken) {
  res.status(409).json({ message: "Email already in use", errors: { email: ["Email already in use"] } });
  return;
}
```

`ne(users.id, id)` excludes the user themselves, so saving their own email unchanged is not a conflict.

> Limitation to be aware of: "check, then update" is not atomic. Two requests at the same moment could both pass the check. The unique index in the database is the real guard. Production code also catches the database error code `23505`. Knowing this limitation matters more than fixing it now.

### 1.5 `DELETE`

```ts
usersRouter.delete("/:id", async (req, res) => {
  const [deleted] = await db.delete(users).where(eq(users.id, idParam.parse(req.params.id))).returning();
  if (!deleted) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.status(204).end();   // 204 = success, and there is deliberately no body
});
```

`.returning()` gives back the deleted row, or nothing if the id did not exist. That is how we tell `204` from `404` with one query.

### 1.6 `405 Method Not Allowed`

`POST /users/1` has no handler. Without extra code Express answers `404`, which is misleading: the URL exists, the method is wrong. Group the handlers per URL with `router.route()` and end with `.all()`:

```ts
const methodNotAllowed =
  (allow: string): RequestHandler =>
  (_req, res) => {
    res.set("Allow", allow).status(405).json({ message: "Method not allowed" });
  };

usersRouter
  .route("/:id")
  .get(...)
  .put(...)
  .patch(...)
  .delete(...)
  .all(methodNotAllowed("GET, PUT, PATCH, DELETE"));   // only reached by methods not handled above
```

`Allow` is required by the HTTP spec on a `405`: it tells the client which methods do work.

### 1.7 `415`, `413`, and bad JSON

These are request-level problems, so they live in `server.ts`, **before** the routes.

```ts
// 415: a request that has a body must say it is JSON
app.use((req, res, next) => {
  if (req.is("json") === false) {
    res.status(415).json({ message: "Content-Type must be application/json" });
    return;
  }
  next();
});

app.use(express.json({ limit: "100kb" }));   // a bigger body makes it throw err.type === "entity.too.large"
```

`req.is("json")` returns `null` when there is no body (a `GET`), `true` for JSON, and `false` for a body of another type. Only `false` is an error.

`express.json` throws on bad input. The error handler (see [Level 6](#level-6-hardening)) maps those errors:

| `err.type` | Status |
| --- | --- |
| `entity.parse.failed` | `400` (not valid JSON) |
| `entity.too.large` | `413` |

### Checkpoint for Level 1

```sh
curl -i -X POST localhost:4000/api/users -H 'content-type: application/json' -d '{"name":"Ada Lovelace","email":"ada@example.com"}'
# 201 Created + Location header
curl -i localhost:4000/api/users/abc          # 400
curl -i localhost:4000/api/users/9999         # 404
curl -i -X POST localhost:4000/api/users/1    # 405 + Allow header
```

---

## Level 2: A better collection endpoint

### 2.1 Sort, order, `createdAfter`

Extend the query schema:

```ts
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["id", "name", "email", "createdAt"]).default("id"),   // the whitelist
  order: z.enum(["asc", "desc"]).default("desc"),
  createdAfter: z.coerce.date().optional(),
});
```

`z.enum([...])` **is** the whitelist: any other value, including `password`, fails validation and returns `400`.

Map the validated name to a real column. Only these four ever reach SQL:

```ts
const sortColumn = { id: users.id, name: users.name, email: users.email, createdAt: users.createdAt }[sort];

.orderBy(order === "asc" ? asc(sortColumn) : desc(sortColumn))
```

Combine several optional filters with `and(...)`. Drizzle ignores `undefined` entries, so filters that were not sent simply disappear:

```ts
const where = and(
  search ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)) : undefined,
  createdAfter ? gt(users.createdAt, createdAfter) : undefined,
);
```

> Drizzle sends values as bound parameters, not by pasting strings into SQL. That protects the **values** (`search`) from SQL injection. Column names cannot be parameters, which is why `sort` needs a whitelist.

### 2.2 Pagination headers

```ts
const totalPages = Math.ceil(total / limit);

// Rebuild the current URL with a different page, keeping the other params (search, sort, ...)
const pageUrl = (p: number, rel: string) => {
  const query = new URLSearchParams(req.query as Record<string, string>);
  query.set("page", String(p));
  return `<${req.baseUrl}?${query}>; rel="${rel}"`;
};
const links = [];
if (page > 1) links.push(pageUrl(page - 1, "prev"));
if (page < totalPages) links.push(pageUrl(page + 1, "next"));

res.set("X-Total-Count", String(total));
if (links.length) res.set("Link", links.join(", "));
```

Result: `Link: </api/v1/users?limit=1&page=2>; rel="next"`.

An empty page is not an error. `data: []` with status `200` is correct; `404` means the **resource** does not exist, and "the list" always exists.

### 2.3 The CORS trap

A browser hides every response header except a small safe list from JavaScript on another origin. To let the web app read ours, list them in `server.ts`:

```ts
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(","),
    exposedHeaders: ["Location", "ETag", "Link", "X-Total-Count", "X-Request-Id", "Retry-After"],
  }),
);
```

Prove it in the browser console on http://localhost:3000:

```js
const r = await fetch("http://localhost:4000/api/v1/users", { headers: { Authorization: "Bearer user-secret-token" } });
r.headers.get("X-Total-Count");   // null before the change, "25" after
```

(`curl` always sees all headers. This problem only exists in browsers, which is why it surprises people.)

---

## Level 3: Caching and ETag

### 3.1 What Express already does

`curl -i localhost:4000/api/users/1` shows `ETag: W/"..."`. Express hashes every JSON body it sends (`app.get("etag")` defaults to `weak`). Repeating the request with `-H 'If-None-Match: W/"..."'` returns `304`. Free, but it still loads the row and builds the whole body before comparing, only to throw the body away.

### 3.2 A meaningful ETag from `updated_at`

```ts
type User = typeof users.$inferSelect;

// The ETag changes whenever the row changes, because updatedAt changes.
const etagOf = (user: User) => `"${user.id}-${user.updatedAt.getTime()}"`;
```

Set it on the response:

```ts
res.set("ETag", etagOf(user)).set("Cache-Control", "private, no-cache").json({ data: user });
```

You do not have to code the `304` yourself: when a handler sets an `ETag` and the request has a matching `If-None-Match`, Express's `res.json` turns the response into `304` with no body. Check with:

```sh
curl -i localhost:4000/api/users/1 -H 'Authorization: Bearer user-secret-token'
curl -i localhost:4000/api/users/1 -H 'Authorization: Bearer user-secret-token' -H 'If-None-Match: "1-1759744800000"'   # 304
```

Why own the ETag? It is a **version number** of the row. That is what makes `If-Match` in 3.4 possible. A hash of the JSON body would also change if you merely reorder fields.

### 3.3 `Cache-Control`

| Response | Header | Reason |
| --- | --- | --- |
| `GET /users/:id`, `GET /users` | `private, no-cache` | `private`: only the user's own browser may store it (it needs a token). `no-cache`: it may be stored, but must be **revalidated** with the server (using the ETag) before every reuse. |
| `POST`, `PUT`, `PATCH` | `no-store` | the response must not be stored anywhere |
| Public, rarely-changing data | `public, max-age=3600` | can be reused for an hour without asking (not used here) |

The classic confusion: `no-cache` does **not** mean "don't cache". `no-store` means that.

### 3.4 `If-Match` (optimistic concurrency)

Problem: Ana and Bo both open user 1. Ana saves a new name. Bo then saves a new bio from an old copy and silently overwrites Ana's name. `If-Match` prevents that: Bo's request says "apply this only if the user is still version X".

```ts
// Returns an error to send, or undefined when the If-Match header is fine.
function checkIfMatch(current: User, ifMatch: string | undefined) {
  if (!ifMatch) return { status: 428, message: "If-Match header is required" };
  if (ifMatch !== etagOf(current)) return { status: 412, message: "User was changed by someone else" };
}
```

In `PUT` and `PATCH`, **after** validating the body and **before** updating:

```ts
const current = await findUser(id);
if (!current) {
  res.status(404).json({ message: "User not found" });
  return;
}
const problem = checkIfMatch(current, req.headers["if-match"]);
if (problem) {
  res.status(problem.status).json({ message: problem.message });
  return;
}
```

After a successful update return the **new** ETag so the client can keep editing:

```ts
res.set("ETag", etagOf(user)).set("Cache-Control", "no-store").json({ data: user });
```

Two-terminal test:

```sh
A='Authorization: Bearer admin-secret-token'
curl -i localhost:4000/api/users/1 -H "$A"                     # copy the ETag: "1-1759744800000"

# terminal A: works
curl -i -X PATCH localhost:4000/api/users/1 -H "$A" -H 'If-Match: "1-1759744800000"' \
  -H 'content-type: application/json' -d '{"bio":"from A"}'    # 200 + a NEW ETag

# terminal B: still holds the old ETag
curl -i -X PATCH localhost:4000/api/users/1 -H "$A" -H 'If-Match: "1-1759744800000"' \
  -H 'content-type: application/json' -d '{"bio":"from B"}'    # 412
```

| Status | Meaning |
| --- | --- |
| `428 Precondition Required` | you must send `If-Match` |
| `412 Precondition Failed` | you sent it, but it is out of date |

---

## Level 4: Versioning

### 4.1 Mount under `/api/v1`

In `server.ts` change one line:

```ts
app.use("/api/v1/users", usersRouter);
```

Nothing inside `users.ts` changes. This is why handlers use `req.baseUrl` for links instead of a hardcoded path.

### 4.2 Deal with the old URL

Three valid choices, each with a trade-off:

| Choice | Behavior | Trade-off |
| --- | --- | --- |
| `308` redirect | old URL forwards to new one | old clients keep working; every call costs an extra round trip |
| Keep both + `Deprecation`/`Sunset` headers | old URL still answers, but warns | no break, but you must maintain two paths |
| `410 Gone` | old URL says "removed, use v1" | clean, but breaks every old client immediately |

The reference solution uses `308`:

```ts
// 308 = "moved permanently, repeat the same method and body there"
app.use("/api/users", (req, res) => {
  res.redirect(308, `/api/v1/users${req.url === "/" ? "" : req.url}`);
});
```

Why `308` and not `301`? `301` lets clients turn a `POST` into a `GET` when following the redirect. `308` forces the same method and body. Inside `app.use("/api/users", ...)`, `req.url` is the part **after** the mount path (`/1?x=1`), so we append it to the new base.

For the "keep both" option, add to the old route's responses:

```ts
res.set("Deprecation", "true").set("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
```

### 4.3 Keep the web app working

See [Docker and web app changes](#docker-and-web-app-changes). The two URLs now end in `/api/v1`.

### 4.4 Thinking exercise: `/api/v2`

You rename `name` to `fullName` in v2. If you edited the single handler, every v1 client would break on deploy day. Versioning gives you two parallel contracts: v1 keeps `name`, v2 offers `fullName`, and both read the same table. See stretch goal 1 below.

---

## Level 5: Authentication and authorization

Vocabulary:
- **Authentication** (`401`): *who are you?* Prove your identity.
- **Authorization** (`403`): *what may you do?* You are known, but not allowed.

### 5.1 Env vars

`api/.env` and `api/.env.example`:

```
ADMIN_TOKEN=admin-secret-token
USER_TOKEN=user-secret-token
```

`api/src/env.ts`: add them to the schema so the server refuses to start without them:

```ts
ADMIN_TOKEN: z.string().min(8),
USER_TOKEN: z.string().min(8),
```

### 5.2 The middleware: `api/src/auth.ts`

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "./env.js";

// Hash both sides first so the buffers always have the same length,
// then compare in constant time (the time taken does not reveal how many characters matched).
const sameToken = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// Authentication: WHO are you? Sets res.locals.role or answers 401.
export const authenticate: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

  if (token && sameToken(token, env.ADMIN_TOKEN)) res.locals.role = "admin";
  else if (token && sameToken(token, env.USER_TOKEN)) res.locals.role = "user";
  else {
    res.set("WWW-Authenticate", "Bearer").status(401).json({ message: "Authentication required" });
    return;
  }
  next();
};

// Authorization: WHAT may you do? Use after authenticate.
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.role !== "admin") {
    res.status(403).json({ message: "Admin role required" });
    return;
  }
  next();
};
```

Read it slowly:
- `req.headers.authorization` looks like `Bearer admin-secret-token`. The regex extracts the part after `Bearer `.
- `authenticate` sets `res.locals.role`, a per-request place to pass data to later handlers, or ends the request with `401`.
- `WWW-Authenticate: Bearer` is **required** on a `401`; it tells the client what kind of credentials to send.
- `requireAdmin` runs **after** `authenticate` and answers `403`.

**Why `timingSafeEqual`?** A normal `===` on strings stops at the first different character. An attacker can measure tiny differences in response time and guess the token one character at a time (a *timing attack*). `timingSafeEqual` always takes the same time. It needs two buffers of equal length, so we hash both sides to a fixed length first.

### 5.3 Apply it per route

Handlers run left to right; each middleware either calls `next()` or ends the response:

```ts
.get(authenticate, handler)                         // any valid token
.post(signupLimiter, handler)                       // public
.put(authenticate, requireAdmin, handler)           // admin only
```

`GET /health` is defined outside the router, so it stays public.

### 5.4 Keep the web working

The users list is fetched on the **server** (a server component), so it can hold a secret. See [Docker and web app changes](#docker-and-web-app-changes).

### 5.5 Why not `NEXT_PUBLIC_API_TOKEN`?

Everything prefixed `NEXT_PUBLIC_` is written into the JavaScript bundle at build time and downloaded by every visitor. Anyone can open the dev tools, press Ctrl+F, and read it. An admin token there is not a secret at all. Rule: **secrets live only in server-side code**. Browser code can only use credentials that the user themselves provides at runtime (for example a login).

This is also why `POST /users` is public in this task. The modal runs in the browser, so it cannot hold a secret. The usual remedy for public endpoints is rate limiting (Level 6).

---

## Level 6: Hardening

### 6.1 Rate limit

```ts
import { rateLimit } from "express-rate-limit";

const signupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,                 // 5 sign-ups per minute per IP, then 429
  standardHeaders: true,    // sends Retry-After and RateLimit-* headers
  legacyHeaders: false,
  message: { message: "Too many requests, try again later" },   // same error shape as everything else
});

usersRouter.route("/").post(signupLimiter, handler);
```

Test with a loop; the 6th call returns `429` with `Retry-After: <seconds>`:

```sh
for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:4000/api/v1/users \
    -H 'content-type: application/json' -d "{\"name\":\"Rate $i\",\"email\":\"r$i@example.com\"}"
done
```

> Behind a reverse proxy every request seems to come from the proxy's IP, so all users share one limit. Real deployments set `app.set("trust proxy", ...)`. Know the problem exists.

### 6.2 One error shape, everywhere

All errors are produced in one place. Put this at the **very end** of `server.ts`:

```ts
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    // fieldErrors: problems with one field. formErrors: problems with the whole input (unknown key, empty body, bad :id)
    const { fieldErrors, formErrors } = z.flattenError(err);
    res.status(400).json({ message: formErrors[0] ?? "Validation failed", errors: fieldErrors });
    return;
  }
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ message: "Request body is not valid JSON" });
    return;
  }
  if (err.type === "entity.too.large") {
    res.status(413).json({ message: "Request body too large" });
    return;
  }
  console.error(`[${res.locals.requestId}]`, err);                  // details go to the LOG...
  res.status(500).json({ message: "Internal server error" });      // ...never to the client
};
app.use(errorHandler);
```

Express 5 forwards errors thrown (or rejected) inside `async` handlers to this function automatically; no `try/catch` is needed in routes.

### 6.3 Content negotiation: `406`

```ts
app.use((req, res, next) => {
  if (!req.accepts("json")) {
    res.status(406).json({ message: "This API only returns application/json" });
    return;
  }
  next();
});
```

`Accept: application/xml` -> `406`. `Accept: */*` (curl's default) and `Accept: application/json` pass.

### 6.4 Request id

```ts
import { randomUUID } from "node:crypto";

app.use((req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.set("X-Request-Id", id);
  next();
});
```

Put it early. A user can now say "request `3f1c...` failed" and you can grep the logs for that id (see the `console.error` above).

### 6.5 Middleware order matters

Express runs middleware in the order of `app.use`. The working order is:

1. `helmet()`: security headers
2. `cors(...)`: must come early so even error responses carry CORS headers, and so preflight `OPTIONS` requests are answered
3. request id
4. `406` check
5. `415` check
6. `express.json(...)`
7. routes
8. `404` for unknown URLs
9. the error handler (last)

Try swapping two and see what breaks. That is the fastest way to learn it.

### 6.6 Helmet headers (answers for the question in the task)

`curl -i localhost:4000/health` shows, among others: `Content-Security-Policy` (limits where scripts can load from, reducing XSS), `X-Content-Type-Options: nosniff` (stops browsers guessing a file's type), `Strict-Transport-Security` (forces HTTPS), `X-Frame-Options`/`frame-ancestors` (blocks clickjacking), and it removes `X-Powered-By` (does not advertise Express).

---

## Level 7: Hypermedia (HATEOAS)

### The idea

**HATEOAS** = *Hypermedia As The Engine Of Application State*. Every response contains **links** that tell the client what it can do next. The client starts at one known URL and **follows links** instead of building URLs from documentation.

A web page works this way: you do not type `/orders/42/cancel` into your browser, you click a button the server gave you. HATEOAS gives API clients the same thing. (In the Richardson maturity model this is the last step, "level 3" of REST.)

Benefits:
- The server can change URLs without breaking clients, because clients read the URL from the response.
- The server can show **only the actions that are currently possible** (an admin sees "delete", a normal user does not; a post that is already published has no "publish" link).
- A new developer can explore the API by following links from the root.

Honest note: full HATEOAS is rare in the wild. Pagination links and `Location` headers are the parts almost every API uses. We implement it here so you understand the idea and its costs.

### The format

We use a small, HAL-style shape: a `_links` object whose keys are **link relations** (what the link means) and whose values say where to go. HAL has no `method`; we add it, because REST uses one URL with several methods.

```json
"_links": {
  "self":   { "href": "/api/v1/users/1", "method": "GET" },
  "update": { "href": "/api/v1/users/1", "method": "PATCH" }
}
```

Relation names are a vocabulary the client relies on, so name them consistently: `self`, `collection`, `next`, `prev`, `first`, `last`, `create`, `update`, `replace`, `delete`.

### 7.1 An entry point

In `server.ts`, before the users router:

```ts
// The API entry point: a client only needs to know this one URL and can discover the rest from the links.
app.get("/api/v1", (_req, res) => {
  res.json({
    _links: {
      self: { href: "/api/v1", method: "GET" },
      users: { href: "/api/v1/users", method: "GET" },
      signup: { href: "/api/v1/users", method: "POST" },
      health: { href: "/health", method: "GET" },
    },
  });
});
```

`curl localhost:4000/api/v1` is now the "home page" of the API.

### 7.2 Links on a single user

In `users.ts`, one helper builds the links. It is **role-aware**: only admins are told about `replace`, `update` and `delete`.

```ts
type Link = { href: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" };

const withLinks = (baseUrl: string, role: string | undefined, user: User) => ({
  ...user,
  _links: {
    self: { href: `${baseUrl}/${user.id}`, method: "GET" },
    collection: { href: baseUrl, method: "GET" },
    ...(role === "admin" && {
      replace: { href: `${baseUrl}/${user.id}`, method: "PUT" },
      update: { href: `${baseUrl}/${user.id}`, method: "PATCH" },
      delete: { href: `${baseUrl}/${user.id}`, method: "DELETE" },
    }),
  } satisfies Record<string, Link>,
});
```

Notes:
- `...(condition && { ... })` adds keys only when the condition is true (spreading `false` adds nothing).
- Use `baseUrl` (`req.baseUrl`), never a hardcoded `/api/v1`, so the links follow the mount path (Level 4 / stretch 1).
- `res.locals.role` is set by `authenticate`. On the public `POST`, it is `undefined`, so the response only has `self` and `collection`.

Use it everywhere a single user is returned (`POST`, `GET /:id`, `PUT`, `PATCH`):

```ts
res.json({ data: withLinks(req.baseUrl, res.locals.role, user) });
```

### 7.3 Links on the collection

Each item gets its own links, and the list gets links for navigation. Refactor the pagination code from Level 2 so one function produces the page URL:

```ts
// URL of another page, keeping all other query params (search, sort, ...)
const pageHref = (p: number) => {
  const query = new URLSearchParams(req.query as Record<string, string>);
  query.set("page", String(p));
  return `${req.baseUrl}?${query}`;
};

// Same information twice: in the Link HEADER (standard HTTP) and in _links in the BODY (easy for JSON clients)
const links: string[] = [];
if (page > 1) links.push(`<${pageHref(page - 1)}>; rel="prev"`);
if (page < totalPages) links.push(`<${pageHref(page + 1)}>; rel="next"`);
if (links.length) res.set("Link", links.join(", "));

res.json({
  data: data.map((user) => withLinks(req.baseUrl, res.locals.role, user)),
  meta: { page, limit, total, totalPages },
  _links: {
    self: { href: pageHref(page), method: "GET" },
    first: { href: pageHref(1), method: "GET" },
    last: { href: pageHref(Math.max(totalPages, 1)), method: "GET" },
    ...(page > 1 && { prev: { href: pageHref(page - 1), method: "GET" } }),
    ...(page < totalPages && { next: { href: pageHref(page + 1), method: "GET" } }),
    create: { href: req.baseUrl, method: "POST" },
  } satisfies Record<string, Link>,
});
```

The last page has **no** `next` link and the first has **no** `prev`. A client loops with `while (body._links.next) { fetch(body._links.next.href) }` and never has to do page arithmetic.

### 7.4 Links change the body, so tell caches

The body of `GET /users/1` is now different for an admin and a normal user, but the URL is the same. Without a hint, a shared cache could hand the admin's body to a normal user. `Vary: Authorization` tells caches "this response depends on the `Authorization` request header":

```ts
res.set("Vary", "Authorization");
```

Add it to `GET /users` and `GET /users/:id`. The ETag is built from `id` + `updatedAt` and does not include links; that is fine because the cache already keys on `Authorization` through `Vary`.

### 7.5 Test it

```sh
U='Authorization: Bearer user-secret-token'
A='Authorization: Bearer admin-secret-token'

curl -s localhost:4000/api/v1 | jq                      # the entry point
curl -s localhost:4000/api/v1/users/1 -H "$U" | jq '.data._links'   # self, collection only
curl -s localhost:4000/api/v1/users/1 -H "$A" | jq '.data._links'   # + replace, update, delete
curl -s "localhost:4000/api/v1/users?limit=1" -H "$U" | jq '._links'   # first, last, next, create (no prev)
curl -si localhost:4000/api/v1/users/1 -H "$U" | grep -i '^vary'
```

(`jq` pretty-prints JSON. If you do not have it, `python3 -m json.tool` works.)

Then **follow the links without typing any URL**: take `_links.next.href` from one response and `curl` exactly that. Take `_links.delete.href` and `_links.delete.method` from an admin response and perform that call. That is the whole point.

### 7.6 Pitfalls and discussion

- **A hidden link is not security.** Not showing `delete` to a normal user is a usability feature. The server must still answer `403` if they call it (Level 5). Never rely on links for authorization.
- **Do not lie.** If a link is in the response, following it should work for this caller in this state.
- **Responses got bigger.** Links cost bytes on every item. Is that worth it for a list of 100 users? (Some APIs only add `self` per item.)
- **Clients must be written for it.** A client that hardcodes `/api/v1/users/${id}` ignores your links and gets none of the benefit.
- **`_links` is output only.** Sending it in a `PUT`/`PATCH` body is rejected by `.strict()`; check this.
- **Thinking exercise (web app):** the Next.js pager builds `?page=2` URLs itself. The API links point to **API** URLs, not web URLs. How would you use `_links.next` there, and what would you have to translate?

---

## Docker and web app changes

The API now needs tokens, and the URLs changed. Every place that holds config must change together. Checklist:

**1. `api/.env` and `api/.env.example`**: add `ADMIN_TOKEN` and `USER_TOKEN`.

**2. Root `.env.example` (and your `.env`)**:

```
ADMIN_TOKEN=admin-secret-token
USER_TOKEN=user-secret-token
```

**3. `docker-compose.yml`**

```yaml
  migrate:
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      ADMIN_TOKEN: ${ADMIN_TOKEN}      # see the gotcha below
      USER_TOKEN: ${USER_TOKEN}

  api:
    environment:
      # ...existing variables...
      ADMIN_TOKEN: ${ADMIN_TOKEN}
      USER_TOKEN: ${USER_TOKEN}

  web:
    build:
      context: ./web
      args:
        NEXT_PUBLIC_API_URL: http://localhost:4000/api/v1     # changed: /v1
    environment:
      API_URL: http://api:4000/api/v1                          # changed: /v1
      API_TOKEN: ${USER_TOKEN}                                 # new: server-side only
```

> **Gotcha:** the `migrate` service runs `db/migrate.ts`, which imports the database module, which imports `env.ts`. `env.ts` now requires the tokens, so without them `migrate` crashes with a Zod error and the API never starts (`service_completed_successfully`). Read the logs with `docker compose logs migrate` to see it. Passing the tokens (above) is the quick fix; a cleaner fix is a separate small env file for the database. Think about which you prefer.

**4. `web/.env` and `web/.env.example`**

```
API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
API_TOKEN=user-secret-token
```

**5. `web/src/lib/env.ts`**: add a lazy getter, like `apiUrl`:

```ts
get apiToken(): string {
  const token = process.env.API_TOKEN;
  if (!token) throw new Error("API_TOKEN is not set. Check web/.env");
  return token;
},
```

**6. `web/src/lib/api.ts`**: send it:

```ts
const res = await fetch(`${env.apiUrl}/users?${qs}`, {
  cache: "no-store",
  headers: { Authorization: `Bearer ${env.apiToken}` },
});
```

**7. Rebuild everything**

```sh
docker compose down
docker compose up -d --build
```

`NEXT_PUBLIC_API_URL` is baked in at build time, so `--build` is not optional.

Test: http://localhost:3000 lists users, the modal still creates one. In the browser Network tab the list request is **not** visible (the server made it), while the create request goes straight to `localhost:4000/api/v1/users`.

---

## Stretch goals in detail

These are open-ended on purpose. Each one has: **goal**, **why it matters**, **plan**, **hints**, **how to test**, **pitfalls**. Outlines are given, not full solutions.

### Stretch 1: `/api/v2` with `fullName`

**Goal.** Offer a second version of the users API where the field `name` is called `fullName`, while `/api/v1` keeps working unchanged.

**Why.** Real APIs have clients you cannot update (mobile apps already installed, other teams' services). Versioning lets you improve the contract without breaking them.

**Plan.**
1. The database column stays `name`. Only the JSON "shape" changes.
2. Create `api/src/routes/users-v2.ts` with its own router.
3. Add two small mapping functions:
   ```ts
   const toV2 = (user: User) => { const { name, ...rest } = user; return { ...rest, fullName: name }; };
   // incoming v2 body: { fullName, email, bio } -> { name: fullName, email, bio }
   ```
4. Mount it: `app.use("/api/v2/users", usersV2Router)` next to the v1 line.
5. Add `Deprecation`/`Sunset` headers to v1 responses with a small middleware on the v1 mount.

**Hints.**
- Easiest start: copy `users.ts`, rename the router, change the schemas and map the output with `toV2`. Duplication is acceptable at first.
- Then compare: what would you share? Queries and ETag logic can move to a helper both routers import. The schemas and mappers stay separate. Where to stop is a judgment call; be ready to explain yours.
- The **ETag must differ between versions** for the same user, because the body differs. Include the version in the tag (`"v2-1-1759744800000"`), otherwise a cached v1 body could be revalidated as v2.

**Test.** Create through v2 and read through v1, and the other way around. Both must see the same user, in their own shape.

**Pitfalls.**
- Changing `schema.ts` (renaming the column) would break v1. Never do that for a version change.
- Do not break `Location`: a v2 `POST` must point at `/api/v2/users/<id>`. This is why we used `req.baseUrl`.

**Discuss.** Other places for a version: header (`Accept: application/vnd.myapp.v2+json`) or query (`?version=2`). Why is the URL the most common choice for beginners (visible, easy to test with curl, cacheable)?

### Stretch 2: Soft delete

**Goal.** `DELETE` marks a user as deleted instead of removing the row. Deleted users disappear from normal reads.

**Why.** Audit trails, undo, and foreign keys from other tables that must keep pointing to something.

**Plan.**
1. Add `deletedAt: timestamp("deleted_at", { withTimezone: true })` (nullable) to the schema, generate and apply a migration.
2. Every read and write must ignore deleted rows. Add `isNull(users.deletedAt)` to the list `where`, to `findUser`, and to the email-conflict check.
3. `DELETE` becomes an update: `db.update(users).set({ deletedAt: new Date() }).where(and(eq(users.id, id), isNull(users.deletedAt))).returning()`. Keep the `204`/`404` logic.
4. Add `POST /users/:id/restore` (admin only) that sets `deletedAt` back to `null`.

**Hints.**
- Decide: should a deleted user return `404` or `410 Gone`? `410` says "it existed and was removed on purpose", `404` says nothing. Both are defensible; pick one and write why.
- **Big pitfall: the unique email.** A soft-deleted user still holds their email, so nobody can ever sign up with it again, and the unique index still blocks it. Solve it with a *partial unique index* that only covers live rows:
  ```ts
  // third argument of pgTable(...)
  (t) => [uniqueIndex("users_email_active").on(t.email).where(sql`${t.deletedAt} is null`)]
  ```
  Also remove `.unique()` from the `email` column. Then `onConflictDoNothing({ target: users.email })` no longer matches the new index. Think about what to do instead (hint: you already do a "check first" in PUT/PATCH).
- Forgetting `isNull(deletedAt)` in just one query leaks deleted users. Wrap the repeated condition in one helper: `const alive = isNull(users.deletedAt)`.

**Test.** Delete a user, then: `GET /users/:id` is `404`/`410`, the list excludes them, you can sign up again with the same email, restore works, and the row is still in the table (`docker compose exec db psql ...`).

### Stretch 3: `Idempotency-Key` on `POST /users`

**Goal.** If a client repeats a `POST` with the same `Idempotency-Key` header, it gets the **first** response again, and no second user is created.

**Why.** `POST` is not idempotent. A mobile client on a bad connection sends a payment, sees a timeout, and retries. Without a key, that could create two charges. Real payment APIs use exactly this header.

**Plan.**
1. Client sends `Idempotency-Key: <uuid>`. Header is optional; no header means normal behavior.
2. Server remembers, per key: a fingerprint of the request body, and the response (status + JSON).
3. If the key is new: process normally, then store the response.
4. If the key was seen with the **same** body: return the stored response and add `Idempotency-Replayed: true`.
5. If the key was seen with a **different** body: reject with `422` (or `409`): the client reused a key by mistake.

**Starter (in-memory), as a middleware for the POST route only:**

```ts
const seen = new Map<string, { bodyHash: string; status: number; body: unknown }>();
// to capture the response: wrap res.json
```

Hints:
- Hash the body with `createHash("sha256").update(JSON.stringify(req.body)).digest("hex")`.
- To capture the response, replace `res.json` with a function that first saves `{ status: res.statusCode, body }` in the Map, then calls the original.
- An in-memory Map is lost on restart and not shared between several API containers. For the real version, create a table `idempotency_keys(key text primary key, body_hash text, status int, response jsonb, created_at timestamptz)`.
- **Concurrency:** two identical requests arriving at the same moment would both miss the Map. With a table, `INSERT` the key **first** (the primary key makes the second insert fail) and only then do the work. Explain why this is safer than "check then insert".
- Delete keys older than 24 hours.

**Test.**
```sh
K='Idempotency-Key: 6b3c1e5a-0000-4000-8000-000000000001'
curl -i -X POST localhost:4000/api/v1/users -H "$K" -H 'content-type: application/json' -d '{"name":"Once Only","email":"once@example.com"}'   # 201
curl -i -X POST localhost:4000/api/v1/users -H "$K" -H 'content-type: application/json' -d '{"name":"Once Only","email":"once@example.com"}'   # 201 again, same id, Idempotency-Replayed: true
curl -i -X POST localhost:4000/api/v1/users -H "$K" -H 'content-type: application/json' -d '{"name":"Other","email":"other@example.com"}'        # 422
```
Without the key, the second call would be `409` (duplicate email). With it, it's the same `201`. That's the difference.

### Stretch 4: `HEAD` and `OPTIONS`

**Goal.** Understand the two methods nobody writes by hand but every client uses.

**HEAD.** Same as `GET`, but only headers, no body. Used to check "does it exist / has it changed" cheaply. Express answers `HEAD` for any `GET` route **automatically**. Verify:

```sh
curl -I localhost:4000/api/v1/users/1 -H 'Authorization: Bearer user-secret-token'
```

Check that status, `ETag` and `Content-Length` match the `GET`, and that no body is sent. Does your auth still apply to `HEAD`? Should it?

**OPTIONS and CORS preflight.** When a browser wants to send a "non-simple" request (`PATCH`, a JSON `Content-Type`, an `Authorization` or `If-Match` header) to another origin, it first sends an `OPTIONS` **preflight** asking "is this allowed?". The `cors()` middleware answers it. Simulate the browser:

```sh
curl -i -X OPTIONS localhost:4000/api/v1/users/1 \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: authorization,if-match,content-type'
```

Read the response: `Access-Control-Allow-Origin`, `-Methods`, `-Headers`. Then change `CORS_ORIGIN`, restart, and rerun with `Origin: http://localhost:9999`: the `Allow-Origin` header disappears and the browser would block the real request.

**Tasks.**
1. Explain why the web app's create-user request triggers a preflight, but a plain `GET` of a public URL does not.
2. Add `Access-Control-Max-Age` (`cors({ maxAge: 600 })`) and explain what it saves.
3. Make `OPTIONS /api/v1/users/1` (no `Origin`) answer `204` with an `Allow` header listing the allowed methods.

**Pitfall.** Middleware order: a preflight carries no token, so if an auth check ran before `cors`, every preflight would get `401` and the browser would report a confusing CORS error.

### Stretch 5: Field selection `?fields=id,name`

**Goal.** Let clients ask for only the columns they need, so responses are smaller.

**Plan.**
1. Add to the list and get-one query schemas:
   ```ts
   fields: z.string().transform((s) => s.split(",")).pipe(z.array(z.enum(["id", "name", "email", "bio", "createdAt", "updatedAt"]))).optional(),
   ```
   The `enum` is again a **whitelist**: unknown fields return `400`.
2. Build the select list from the real columns:
   ```ts
   import { getTableColumns } from "drizzle-orm";
   const all = getTableColumns(users);
   const selected = fields ? Object.fromEntries(fields.map((f) => [f, all[f]])) : all;
   db.select(selected).from(users)
   ```
3. Careful with the ETag: it is built from `id` and `updatedAt`. If `fields` leaves those out, you cannot compute it. Either always select them internally and strip them before sending, or decide not to send an ETag when `fields` is used.

**Hints.** Different `fields` values produce different bodies for the same URL path, so a cache must treat them as different responses. The query string is part of the cache key, so this works. But read about the `Vary` header: it matters when the *headers* change the response (for example `Accept-Language`).

**Test.** `?fields=id,name` returns only those two keys; `?fields=password` returns `400`; `?fields=` (empty) should not crash.

### Stretch 6: OpenAPI document and Swagger UI

**Goal.** A machine-readable description of your API (`api/openapi.yaml`) plus a web page (`/docs`) where anyone can read and try the endpoints.

**Why.** Documentation that lives outside the code goes stale. An OpenAPI file can be linted, used to generate client code and used for contract tests.

**Plan.**
1. Write `api/openapi.yaml`. Skeleton:
   ```yaml
   openapi: 3.0.3
   info: { title: Users API, version: 1.0.0 }
   servers: [{ url: http://localhost:4000/api/v1 }]
   components:
     securitySchemes:
       bearerAuth: { type: http, scheme: bearer }
     schemas:
       User:
         type: object
         properties:
           id: { type: integer }
           name: { type: string }
           email: { type: string, format: email }
           bio: { type: string, nullable: true }
           createdAt: { type: string, format: date-time }
           updatedAt: { type: string, format: date-time }
       Error:
         type: object
         properties:
           message: { type: string }
           errors: { type: object, additionalProperties: { type: array, items: { type: string } } }
   paths:
     /users/{id}:
       get:
         security: [{ bearerAuth: [] }]
         parameters:
           - { name: id, in: path, required: true, schema: { type: integer, minimum: 1 } }
         responses:
           "200":
             description: The user
             headers:
               ETag: { schema: { type: string } }
             content:
               application/json:
                 schema:
                   type: object
                   properties: { data: { $ref: "#/components/schemas/User" } }
           "401": { description: Missing or invalid token }
           "404": { description: User not found }
   ```
   Describe **every** endpoint, **every** status code from your table, and the headers (`Location`, `ETag`, `If-Match`, `Link`).
2. Serve it. Install `swagger-ui-express` and `yaml`:
   ```ts
   import swaggerUi from "swagger-ui-express";
   import { parse } from "yaml";
   import { readFileSync } from "node:fs";

   app.use("/docs", swaggerUi.serve, swaggerUi.setup(parse(readFileSync("openapi.yaml", "utf8"))));
   ```
3. Validate the file: `npx @redocly/cli lint api/openapi.yaml`.

**Pitfalls.**
- **Docker:** the Dockerfile copies only `dist/` and `node_modules` into the final image. Your YAML will be missing at runtime; `readFileSync` throws. You need to `COPY openapi.yaml` into the `runner` stage. Helmet's CSP also blocks Swagger UI's inline scripts; you must relax it for `/docs` only, and know what you are weakening.
- Keep the file honest: change an endpoint, change the YAML.

**Test.** Open http://localhost:4000/docs, click *Authorize*, paste a token, and execute `GET /users`.

### Stretch 7: Automated tests (Vitest + Supertest)

**Goal.** A test suite that checks every row of the status-code table and runs with one command.

**Plan.**
1. `cd api && npm i -D vitest supertest @types/supertest`; add `"test": "vitest run"` to `package.json`.
2. The app must be importable **without** starting a server. In `server.ts`:
   ```ts
   export const app = express();
   // ...
   if (process.env.NODE_ENV !== "test") app.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
   ```
   Vitest sets `NODE_ENV=test` automatically.
3. Use a **separate database** (`practice_test`), never your dev data. Set `DATABASE_URL` for tests in `api/.env.test` and load it (`vitest --env-file`, or `test.env` in `vitest.config.ts`).
4. Reset between tests: `await db.delete(users)` in a `beforeEach`.

**Skeleton:**

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/server.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const admin = { Authorization: "Bearer admin-secret-token" };
const user = { Authorization: "Bearer user-secret-token" };

beforeEach(async () => { await db.delete(users); });

describe("POST /api/v1/users", () => {
  it("creates a user and returns 201 with Location", async () => {
    const res = await request(app).post("/api/v1/users").send({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/users/${res.body.data.id}`);
  });

  it("returns 409 for a duplicate email", async () => { /* create twice */ });
  it("returns 400 for invalid input", async () => { /* ... */ });
});

describe("PATCH /api/v1/users/:id", () => {
  it("returns 428 without If-Match", async () => { /* ... */ });
  it("returns 412 with a stale ETag", async () => { /* ... */ });
});
```

**Cover at least:** each status in your table, `401` vs `403`, the `304` flow, the `412` flow, sort whitelist, pagination headers, and the `308` redirect (`.redirects(0)` in Supertest so it does not follow it).

**Pitfalls.**
- The rate limiter (5 per minute) will make the 6th `POST` in your suite return `429`. Find a clean way to disable or raise it under `NODE_ENV=test`, or your tests will fail at random.
- Tests must not depend on each other's order or data.

**Docker bonus.** Run the tests in a container against the compose database: a `test` service under a `profiles: ["test"]` profile that runs `npm test`.

---

## Complete reference files

Compare your solution with these only **after** finishing a level. These are the files from the reference solution that was run against every `curl` command in the task.

<details>
<summary><code>api/src/routes/users.ts</code></summary>

```ts
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { and, asc, count, desc, eq, gt, ilike, ne, or } from "drizzle-orm";
import { z } from "zod";
import { authenticate, requireAdmin } from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { cleanString } from "../utils.js";

export const usersRouter = Router();

// ---------- Validation (zod) ----------
// Invalid input makes .parse() throw; the error handler in server.ts turns that into a 400.

const idParam = z.coerce.number().int().positive();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["id", "name", "email", "createdAt"]).default("id"), // whitelist
  order: z.enum(["asc", "desc"]).default("desc"),
  createdAfter: z.coerce.date().optional(),
});

// .strict() rejects unknown fields such as "id" or "createdAt"
const createBody = z
  .object({
    name: cleanString().pipe(z.string().min(2).max(100)),
    email: cleanString().pipe(z.email().max(255)).transform((email) => email.toLowerCase()),
    bio: cleanString().pipe(z.string().max(500)).optional(),
  })
  .strict();

const patchBody = createBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field" });

// ---------- Helpers ----------

type User = typeof users.$inferSelect;

// The ETag changes whenever the row changes, because updatedAt changes.
const etagOf = (user: User) => `"${user.id}-${user.updatedAt.getTime()}"`;

// ---------- Hypermedia (HATEOAS) ----------
// Every response tells the client what it can do next, so clients follow links instead of building URLs.
// Links are role-aware: only an admin is told about update and delete.

type Link = { href: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" };

const withLinks = (baseUrl: string, role: string | undefined, user: User) => ({
  ...user,
  _links: {
    self: { href: `${baseUrl}/${user.id}`, method: "GET" },
    collection: { href: baseUrl, method: "GET" },
    ...(role === "admin" && {
      replace: { href: `${baseUrl}/${user.id}`, method: "PUT" },
      update: { href: `${baseUrl}/${user.id}`, method: "PATCH" },
      delete: { href: `${baseUrl}/${user.id}`, method: "DELETE" },
    }),
  } satisfies Record<string, Link>,
});

const findUser = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

const userNotFound = { message: "User not found" };

// Answer 405 for a URL that exists but does not support this method.
const methodNotAllowed =
  (allow: string): RequestHandler =>
  (_req, res) => {
    res.set("Allow", allow).status(405).json({ message: "Method not allowed" });
  };

// Used by PUT and PATCH: the client must prove it saw the latest version of the user.
// Returns an error to send, or undefined when the If-Match header is fine.
function checkIfMatch(current: User, ifMatch: string | undefined) {
  if (!ifMatch) return { status: 428, message: "If-Match header is required" };
  if (ifMatch !== etagOf(current)) return { status: 412, message: "User was changed by someone else" };
}

const signupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5, // 5 sign-ups per minute per IP, then 429 + Retry-After
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, try again later" },
});

// ---------- /api/v1/users ----------

usersRouter
  .route("/")
  // GET /users?page=1&limit=10&search=ann&sort=name&order=asc&createdAfter=2026-01-01
  .get(authenticate, async (req, res) => {
    const { page, limit, search, sort, order, createdAfter } = listQuery.parse(req.query);

    const where = and(
      search ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)) : undefined,
      createdAfter ? gt(users.createdAt, createdAfter) : undefined,
    );

    // Only whitelisted columns reach SQL: `sort` is validated by z.enum above.
    const sortColumn = { id: users.id, name: users.name, email: users.email, createdAt: users.createdAt }[sort];

    const data = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(order === "asc" ? asc(sortColumn) : desc(sortColumn))
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ total }] = await db.select({ total: count() }).from(users).where(where);
    const totalPages = Math.ceil(total / limit);

    // URL of another page, keeping all other query params (search, sort, ...)
    const pageHref = (p: number) => {
      const query = new URLSearchParams(req.query as Record<string, string>);
      query.set("page", String(p));
      return `${req.baseUrl}?${query}`;
    };

    // Same information twice: in the Link HEADER (standard HTTP) and in _links in the BODY (easy for JSON clients)
    const links: string[] = [];
    if (page > 1) links.push(`<${pageHref(page - 1)}>; rel="prev"`);
    if (page < totalPages) links.push(`<${pageHref(page + 1)}>; rel="next"`);

    res.set("X-Total-Count", String(total));
    if (links.length) res.set("Link", links.join(", "));
    res.set("Cache-Control", "private, no-cache").set("Vary", "Authorization");
    res.json({
      data: data.map((user) => withLinks(req.baseUrl, res.locals.role, user)),
      meta: { page, limit, total, totalPages },
      _links: {
        self: { href: pageHref(page), method: "GET" },
        first: { href: pageHref(1), method: "GET" },
        last: { href: pageHref(Math.max(totalPages, 1)), method: "GET" },
        ...(page > 1 && { prev: { href: pageHref(page - 1), method: "GET" } }),
        ...(page < totalPages && { next: { href: pageHref(page + 1), method: "GET" } }),
        create: { href: req.baseUrl, method: "POST" },
      } satisfies Record<string, Link>,
    });
  })

  // POST /users (public: this is "sign up")
  .post(signupLimiter, async (req, res) => {
    const input = createBody.parse(req.body);

    const [user] = await db.insert(users).values(input).onConflictDoNothing({ target: users.email }).returning();

    // onConflictDoNothing returns no row when the email already exists
    if (!user) {
      res.status(409).json({ message: "Email already in use", errors: { email: ["Email already in use"] } });
      return;
    }

    res
      .status(201)
      .set("Location", `${req.baseUrl}/${user.id}`)
      .set("ETag", etagOf(user))
      .set("Cache-Control", "no-store")
      .json({ data: withLinks(req.baseUrl, res.locals.role, user) });
  })

  .all(methodNotAllowed("GET, POST"));

usersRouter
  .route("/:id")
  // GET /users/:id
  .get(authenticate, async (req, res) => {
    const user = await findUser(idParam.parse(req.params.id));
    if (!user) {
      res.status(404).json(userNotFound);
      return;
    }

    // Because we set an ETag, Express answers 304 on its own when If-None-Match matches.
    res
      .set("ETag", etagOf(user))
      .set("Cache-Control", "private, no-cache")
      .set("Vary", "Authorization") // the body differs per role (admins get more links)
      .json({ data: withLinks(req.baseUrl, res.locals.role, user) });
  })

  // PUT /users/:id (replace: every field required; optional bio becomes null)
  .put(authenticate, requireAdmin, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = createBody.parse(req.body);

    const current = await findUser(id);
    if (!current) {
      res.status(404).json(userNotFound);
      return;
    }
    const problem = checkIfMatch(current, req.headers["if-match"]);
    if (problem) {
      res.status(problem.status).json({ message: problem.message });
      return;
    }

    const [taken] = await db.select().from(users).where(and(eq(users.email, input.email), ne(users.id, id)));
    if (taken) {
      res.status(409).json({ message: "Email already in use", errors: { email: ["Email already in use"] } });
      return;
    }

    const [user] = await db.update(users).set({ ...input, bio: input.bio ?? null }).where(eq(users.id, id)).returning();
    res.set("ETag", etagOf(user)).set("Cache-Control", "no-store").json({ data: withLinks(req.baseUrl, res.locals.role, user) });
  })

  // PATCH /users/:id (partial: only the fields that were sent)
  .patch(authenticate, requireAdmin, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = patchBody.parse(req.body);

    const current = await findUser(id);
    if (!current) {
      res.status(404).json(userNotFound);
      return;
    }
    const problem = checkIfMatch(current, req.headers["if-match"]);
    if (problem) {
      res.status(problem.status).json({ message: problem.message });
      return;
    }

    if (input.email) {
      const [taken] = await db.select().from(users).where(and(eq(users.email, input.email), ne(users.id, id)));
      if (taken) {
        res.status(409).json({ message: "Email already in use", errors: { email: ["Email already in use"] } });
        return;
      }
    }

    const [user] = await db.update(users).set(input).where(eq(users.id, id)).returning();
    res.set("ETag", etagOf(user)).set("Cache-Control", "no-store").json({ data: withLinks(req.baseUrl, res.locals.role, user) });
  })

  // DELETE /users/:id
  .delete(authenticate, requireAdmin, async (req, res) => {
    const [deleted] = await db.delete(users).where(eq(users.id, idParam.parse(req.params.id))).returning();
    if (!deleted) {
      res.status(404).json(userNotFound);
      return;
    }
    res.status(204).end();
  })

  .all(methodNotAllowed("GET, PUT, PATCH, DELETE"));
```

</details>

<details>
<summary><code>api/src/server.ts</code></summary>

```ts
import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { z } from "zod";
import { env } from "./env.js";
import { usersRouter } from "./routes/users.js";

const app = express();

// ---------- Middleware ----------
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(","),
    // Without this the browser hides these headers from JavaScript
    exposedHeaders: ["Location", "ETag", "Link", "X-Total-Count", "X-Request-Id", "Retry-After"],
  }),
);

// Give every request an id and return it, so a user can report "request abc123 failed"
app.use((req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.set("X-Request-Id", id);
  next();
});

// 406: we only speak JSON
app.use((req, res, next) => {
  if (!req.accepts("json")) {
    res.status(406).json({ message: "This API only returns application/json" });
    return;
  }
  next();
});

// 415: a request that has a body must say it is JSON
app.use((req, res, next) => {
  if (req.is("json") === false) {
    res.status(415).json({ message: "Content-Type must be application/json" });
    return;
  }
  next();
});

app.use(express.json({ limit: "100kb" })); // bigger bodies fail with 413

// ---------- Routes (add new resources here) ----------
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// The API entry point: a client only needs to know this one URL and can discover the rest from the links.
app.get("/api/v1", (_req, res) => {
  res.json({
    _links: {
      self: { href: "/api/v1", method: "GET" },
      users: { href: "/api/v1/users", method: "GET" },
      signup: { href: "/api/v1/users", method: "POST" },
      health: { href: "/health", method: "GET" },
    },
  });
});

app.use("/api/v1/users", usersRouter);

// The old, unversioned URL: 308 = "moved permanently, repeat the same method and body there"
app.use("/api/users", (req, res) => {
  res.redirect(308, `/api/v1/users${req.url === "/" ? "" : req.url}`);
});

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

// ---------- Error handler (must be last) ----------
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    // fieldErrors: problems with one field. formErrors: problems with the whole input (unknown key, empty body, bad :id)
    const { fieldErrors, formErrors } = z.flattenError(err);
    res.status(400).json({ message: formErrors[0] ?? "Validation failed", errors: fieldErrors });
    return;
  }
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ message: "Request body is not valid JSON" });
    return;
  }
  if (err.type === "entity.too.large") {
    res.status(413).json({ message: "Request body too large" });
    return;
  }
  console.error(`[${res.locals.requestId}]`, err);
  res.status(500).json({ message: "Internal server error" });
};
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT}`);
});
```

</details>

<details>
<summary><code>api/src/auth.ts</code></summary>

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "./env.js";

// Hash both sides first so the buffers always have the same length,
// then compare in constant time (the time taken does not reveal how many characters matched).
const sameToken = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// Authentication: WHO are you? Sets res.locals.role or answers 401.
export const authenticate: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

  if (token && sameToken(token, env.ADMIN_TOKEN)) res.locals.role = "admin";
  else if (token && sameToken(token, env.USER_TOKEN)) res.locals.role = "user";
  else {
    res.set("WWW-Authenticate", "Bearer").status(401).json({ message: "Authentication required" });
    return;
  }
  next();
};

// Authorization: WHAT may you do? Use after authenticate.
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.role !== "admin") {
    res.status(403).json({ message: "Admin role required" });
    return;
  }
  next();
};
```

</details>

<details>
<summary><code>api/src/env.ts</code></summary>

```ts
import { z } from "zod";

// Read and validate environment variables once, at startup.
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ADMIN_TOKEN: z.string().min(8),
  USER_TOKEN: z.string().min(8),
});

export const env = schema.parse(process.env);
```

</details>

<details>
<summary><code>api/src/db/schema.ts</code></summary>

```ts
import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

</details>

import { Router } from "express";
import { count, desc, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { cleanString } from "../utils.js";

export const usersRouter = Router();

// ---------- Validation (zod) ----------
// Invalid input makes .parse() throw; the error handler in server.ts turns that into a 400.

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
});

const createBody = z.object({
  name: cleanString().pipe(z.string().min(2).max(100)),
  email: cleanString().pipe(z.email().max(255)).transform((email) => email.toLowerCase()),
  bio: cleanString().pipe(z.string().max(500)).optional(),
});

// ---------- GET /api/users?page=1&limit=10&search=ann ----------

usersRouter.get("/", async (req, res) => {
  const { page, limit, search } = listQuery.parse(req.query);

  // Optional filter: match name or email
  const where = search
    ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))
    : undefined;

  const data = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.id))
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ total }] = await db.select({ total: count() }).from(users).where(where);

  res.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

// ---------- POST /api/users ----------

usersRouter.post("/", async (req, res) => {
  const input = createBody.parse(req.body);

  const [user] = await db.insert(users).values(input).onConflictDoNothing({ target: users.email }).returning();

  // onConflictDoNothing returns no row when the email already exists
  if (!user) {
    res.status(409).json({ message: "Email already in use", errors: { email: ["Email already in use"] } });
    return;
  }

  res.status(201).json({ data: user });
});

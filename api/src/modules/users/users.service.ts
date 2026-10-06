import { count, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { HttpError } from "../../common/errors.js";
import { buildMeta, toOffset } from "../../common/pagination.js";
import { buildUsersFilter } from "./users.filter.js";
import type { CreateUserInput, ListUsersQuery } from "./users.schema.js";
import type { PaginatedUsers, User } from "./users.types.js";

export const usersService = {
  async list(query: ListUsersQuery): Promise<PaginatedUsers> {
    const where = buildUsersFilter(query);

    const [data, [{ total }]] = await Promise.all([
      db.select().from(users).where(where).orderBy(desc(users.id)).limit(query.limit).offset(toOffset(query)),
      db.select({ total: count() }).from(users).where(where),
    ]);

    return { data, meta: buildMeta(query, total) };
  },

  async create(input: CreateUserInput): Promise<User> {
    const [created] = await db.insert(users).values(input).onConflictDoNothing({ target: users.email }).returning();
    if (!created) {
      throw new HttpError(409, "Email already in use", { email: ["Email already in use"] });
    }
    return created;
  },
};

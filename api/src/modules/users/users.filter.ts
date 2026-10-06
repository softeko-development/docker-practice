import { ilike, or, type SQL } from "drizzle-orm";
import { users } from "../../db/schema.js";
import type { ListUsersQuery } from "./users.schema.js";

/** Builds the WHERE clause for the users list from query params. */
export const buildUsersFilter = ({ search }: Pick<ListUsersQuery, "search">): SQL | undefined => {
  if (!search) return undefined;
  const pattern = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
  return or(ilike(users.name, pattern), ilike(users.email, pattern));
};

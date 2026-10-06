import type { InferSelectModel } from "drizzle-orm";
import type { users } from "../../db/schema.js";
import type { PaginationMeta } from "../../common/pagination.js";

export type User = InferSelectModel<typeof users>;

export type PaginatedUsers = {
  data: User[];
  meta: PaginationMeta;
};

import { z } from "zod";
import { cleanString } from "../../common/sanitize.js";
import { paginationSchema } from "../../common/pagination.js";

export const createUserSchema = z.object({
  name: cleanString().pipe(z.string().min(2, "Name must be at least 2 characters").max(100)),
  email: cleanString().pipe(z.email("Invalid email address").max(255)).transform((v) => v.toLowerCase()),
  bio: cleanString().pipe(z.string().max(500)).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

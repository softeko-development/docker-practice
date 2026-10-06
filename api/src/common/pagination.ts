import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export const toOffset = ({ page, limit }: PaginationQuery) => (page - 1) * limit;

export const buildMeta = (q: PaginationQuery, total: number): PaginationMeta => ({
  page: q.page,
  limit: q.limit,
  total,
  totalPages: Math.ceil(total / q.limit),
});

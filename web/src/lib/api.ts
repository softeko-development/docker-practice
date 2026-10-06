import { env } from "./env";
import type { UsersResponse } from "./types";

export async function fetchUsers(params: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<UsersResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);

  const res = await fetch(`${env.apiUrl}/users?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch users: ${res.status}`);
  }
  return res.json();
}

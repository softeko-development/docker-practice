import type { ApiError, CreateUserInput, User } from "./types";

// NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public fieldErrors?: ApiError["errors"],
  ) {
    super(message);
  }
}

export async function createUser(input: CreateUserInput): Promise<User> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiRequestError(`Cannot reach the API at ${apiUrl}`);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(body?.message ?? "Failed to create user", body?.errors);
  }
  return body.data;
}

"use server";

import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import type { CreateUserState } from "@/lib/types";

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const payload = {
    name: formData.get("name"),
    email: formData.get("email"),
    bio: formData.get("bio") || undefined,
  };

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, message: "Cannot reach the API." };
  }

  if (res.ok) {
    revalidatePath("/");
    return { ok: true };
  }

  const body = await res.json().catch(() => null);
  return {
    ok: false,
    message: body?.message ?? "Failed to create user.",
    fieldErrors: body?.errors,
  };
}

"use client";

import { useActionState, useEffect } from "react";
import { createUser } from "@/app/actions";
import type { CreateUserState } from "@/lib/types";

const initialState: CreateUserState = { ok: false };

export function CreateUserForm({ onSuccess }: { onSuccess: () => void }) {
  const [state, action, pending] = useActionState(createUser, initialState);

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  const err = (field: string) => state.fieldErrors?.[field]?.[0];

  return (
    <form action={action} className="form">
      {state.message && !state.ok && <p className="error banner">{state.message}</p>}

      <label>
        Name
        <input name="name" required maxLength={100} />
        {err("name") && <span className="error">{err("name")}</span>}
      </label>

      <label>
        Email
        <input name="email" type="email" required />
        {err("email") && <span className="error">{err("email")}</span>}
      </label>

      <label>
        Bio (optional)
        <textarea name="bio" rows={3} maxLength={500} />
        {err("bio") && <span className="error">{err("bio")}</span>}
      </label>

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </button>
    </form>
  );
}

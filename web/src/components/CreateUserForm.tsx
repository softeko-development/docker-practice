"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError, createUser } from "@/lib/client-api";

export function CreateUserForm({ onSuccess }: { onSuccess: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setMessage(undefined);
    setFieldErrors({});

    try {
      await createUser({
        name: String(form.get("name")),
        email: String(form.get("email")),
        bio: String(form.get("bio") ?? "") || undefined,
      });
      router.refresh(); // re-run server components to reload the list
      onSuccess();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setMessage(err.message);
        setFieldErrors(err.fieldErrors ?? {});
      } else {
        setMessage("Something went wrong");
      }
    } finally {
      setPending(false);
    }
  }

  const err = (field: string) => fieldErrors[field]?.[0];

  return (
    <form onSubmit={onSubmit} className="form">
      {message && <p className="error banner">{message}</p>}

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

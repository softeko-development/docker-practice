"use client";

import { useCallback, useState } from "react";
import { Modal } from "./Modal";
import { CreateUserForm } from "./CreateUserForm";

export function CreateUserButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + New user
      </button>
      <Modal open={open} title="Create user" onClose={close}>
        <CreateUserForm onSuccess={close} />
      </Modal>
    </>
  );
}

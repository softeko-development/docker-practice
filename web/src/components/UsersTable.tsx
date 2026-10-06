import type { User } from "@/lib/types";

export function UsersTable({ users }: { users: User[] }) {
  if (users.length === 0) return <p className="muted">No users yet.</p>;

  return (
    <table className="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Email</th>
          <th>Bio</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.id}</td>
            <td>{u.name}</td>
            <td>{u.email}</td>
            <td>{u.bio ?? "—"}</td>
            <td>{new Date(u.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

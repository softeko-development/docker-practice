import { fetchUsers } from "@/lib/api";
import { UsersTable } from "@/components/UsersTable";
import { Pager } from "@/components/Pager";
import { CreateUserButton } from "@/components/CreateUserButton";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { page, search } = await searchParams;
  const { data, meta } = await fetchUsers({
    page: Number(page) || 1,
    limit: 10,
    search,
  });

  return (
    <main className="container">
      <header className="page-header">
        <h1>Users</h1>
        <CreateUserButton />
      </header>

      <form className="search" action="/">
        <input name="search" defaultValue={search} placeholder="Search name or email…" />
        <button type="submit" className="btn secondary">Search</button>
      </form>

      <UsersTable users={data} />
      <Pager meta={meta} search={search} />
    </main>
  );
}

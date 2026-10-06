import { db, pool } from "./index.js";
import { users } from "./schema.js";

const rows = Array.from({ length: 25 }, (_, i) => ({
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  bio: i % 3 === 0 ? `Seeded bio for user ${i + 1}` : null,
}));

await db.insert(users).values(rows).onConflictDoNothing();
console.log(`Seeded ${rows.length} users`);
await pool.end();

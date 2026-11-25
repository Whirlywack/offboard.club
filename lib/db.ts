import { attachDatabasePool } from "@vercel/functions/db-connections";
import { Pool, type ClientBase } from "pg";

// The pool, or a single connection such as one holding a transaction.
export type Queryable = Pick<ClientBase, "query">;

// One pool per server instance; Neon's pooled connection string handles the rest. Neon suspends the database after 5
// minutes without a query, and the next connection waits while it wakes: a few hundred milliseconds as a rule, a few
// seconds at times, which 5 s did not always cover (#55). 10 s, as in Neon's own example, allows for that and still
// gives up on a database that is down long before a request's time runs out.
export const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000 });

// Vercel suspends an instance between requests, and the pool's idle timer does not run while it is suspended, so a
// connection left idle could be closed by the database under it and handed to the next request dead. This keeps the
// instance up after each request until the pool has closed its idle connections. Off Vercel it does nothing.
attachDatabasePool(db);

// Neon closes idle connections when it suspends; the pool replaces them, so this is not fatal.
db.on("error", (error) => console.error("Idle database connection closed:", error.message));

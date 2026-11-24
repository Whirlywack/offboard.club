import { Pool } from "pg";

// One pool per server instance; Neon's pooled connection string handles the rest.
// Give up on an unreachable database after 5 s instead of holding the request open.
export const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });

// Neon closes idle connections when it suspends; the pool replaces them, so this is not fatal.
db.on("error", (error) => console.error("Idle database connection closed:", error.message));

import { Pool } from "pg";

// One pool per server instance; Neon's pooled connection string handles the rest.
export const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

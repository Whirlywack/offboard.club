import { db } from "@/lib/db";

// Proves the app can reach the database. Says nothing else about it.
export async function GET() {
  try {
    await db.query("select 1");
    return Response.json({ db: "ok" });
  } catch {
    return Response.json({ db: "unreachable" }, { status: 503 });
  }
}

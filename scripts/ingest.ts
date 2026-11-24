// Ingests one finished Lichess Swiss tournament on the Club's team as a Matchday, by hand:
//   pnpm ingest <tournament id>
// The id is the last part of lichess.org/swiss/<id>. DATABASE_URL and LICHESS_TEAM_ID come from .env.local or the
// environment. Running it again for the same tournament changes nothing. Exits with 1 if the tournament is refused or
// ingestion fails, in which case nothing has been stored.
import { db } from "@/lib/db";
import { ingestTournament } from "@/lib/matchdays";

async function main(args: string[]): Promise<number> {
  if (args.length !== 1) {
    console.error("Usage: pnpm ingest <Lichess Swiss tournament id>");
    return 1;
  }
  const ingestion = await ingestTournament(args[0]);
  switch (ingestion.outcome) {
    case "ingested":
      console.log(
        `Ingested the Matchday of ${ingestion.date}: ${ingestion.members} Members and ${ingestion.games} Games. Its Recap is at /recaps/${ingestion.date}.`,
      );
      return 0;
    case "unchanged":
      console.log(`Already ingested as the Matchday of ${ingestion.date}; nothing has changed.`);
      return 0;
    case "refused":
      console.error(`${ingestion.problem} Nothing has been stored.`);
      return 1;
  }
}

main(process.argv.slice(2))
  .catch((error: unknown) => {
    // A LichessError names the request and the status only, never a body.
    console.error("Ingestion failed, so nothing has been stored:", error instanceof Error ? error.message : error);
    return 1;
  })
  .then(async (code) => {
    await db.end();
    process.exit(code);
  });

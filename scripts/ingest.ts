// Ingests one finished Lichess Swiss tournament on the Club's team as a Matchday, by hand:
//   pnpm ingest <tournament id>          stores it; running it again changes nothing
//   pnpm ingest <tournament id> --redo   fetches it again and replaces its Matchday's results and Games, for when a
//                                        Member was missed, such as one who connected Lichess only after playing
// The id is the last part of lichess.org/swiss/<id>. DATABASE_URL and LICHESS_TEAM_ID come from .env.local or the
// environment. Exits with 1 if the tournament is refused or ingestion fails, in which case nothing has been stored.
import { db } from "@/lib/db";
import { ingestTournament } from "@/lib/matchdays";

const USAGE = "Usage: pnpm ingest <Lichess Swiss tournament id> [--redo]";

async function main(args: string[]): Promise<number> {
  // The script runs outside production, where the Lichess client follows LICHESS_URL to a fake Lichess: with the live
  // DATABASE_URL beside it, made-up results would become a real Matchday.
  if (process.env.LICHESS_URL) {
    console.error("LICHESS_URL is set, which would ingest from a fake Lichess instead of lichess.org. Unset it and run again. Nothing has been stored.");
    return 1;
  }
  const redo = args.includes("--redo");
  const [id, ...rest] = args.filter((arg) => arg !== "--redo");
  if (!id || rest.length > 0 || id.startsWith("-")) {
    console.error(USAGE);
    return 1;
  }
  const ingestion = await ingestTournament(id, { redo });
  switch (ingestion.outcome) {
    case "ingested": {
      const { date, participants, members, games, redone } = ingestion;
      console.log(
        `${redone ? "Ingested again" : "Ingested"} the Matchday of ${date}: ${members} of the ${participants} participants are Members and ${participants - members} are not; ${games} Games between Members. Its Recap is at /recaps/${date}.`,
      );
      return 0;
    }
    case "unchanged":
      console.log(
        `Already ingested as the Matchday of ${ingestion.date}; nothing has changed. If a Member was missed, run pnpm ingest ${id} --redo.`,
      );
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

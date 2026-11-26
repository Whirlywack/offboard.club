# Restoring a backup

Every night at 01:07 UTC a scheduled job dumps the whole database and stores the dump in Vercel Blob (`lib/backup.ts`). This is how to bring one back into a new database and point the site at it.

**Tried** means done, twice:

- On 25 November 2026, against local throwaway databases: the job's own code dumped a seeded Club (`pnpm seed club` and `season-over`) to a stand-in for the store, the dump was restored into a fresh database (`pnpm db:start --dir <new folder>`), and every table of the two was compared row by row; `lib/backup.postgres.test.ts` does the same on every CI run.
- On 26 November 2026, against the real store: the first night's dump was listed and downloaded with the two `vercel blob` commands of step 2 (CLI 63.1.2), restored into a local throwaway database with `pnpm restore`, and a new dump of that database matched the downloaded one in every table, sequence and migration. They match only with the local database's time zone set to UTC, as live's is; otherwise the same moments print with another offset. The downloaded dump and the local database were deleted afterwards.

**Not tried** means nobody has done it yet: a new database on Neon, and pointing the site at it.

## 1. Where the dumps are (tried, except the deleting)

In the private Vercel Blob store `offboard-backups` (Frankfurt), connected to the project's Production environment, as `backups/<UTC date and time>.json.gz`, such as `backups/2026-11-29T01-07-12Z.json.gz`. The store deletes each after 12 days by itself, and each night's run deletes any made more than 13 days before, so there are 12 to 14. The Organiser page shows how the last night's went.

## 2. Download one (tried, except pasting the token)

The store's read-write token is the `BLOB_READ_WRITE_TOKEN` among the project's Production environment variables on Vercel, which can be shown there. (On 26 November 2026 it was read through Vercel's API into a shell variable instead of pasted; the `list` and `get` commands below are as run.) From the [Vercel CLI docs](https://vercel.com/docs/cli/blob), in a new folder outside the repository, `~/offboard-restore`, with the token read without showing it:

```sh
mkdir ~/offboard-restore && cd ~/offboard-restore
read -rs BLOB_READ_WRITE_TOKEN    # paste the token, then Enter; nothing is shown
vercel blob list --prefix backups/ --rw-token "$BLOB_READ_WRITE_TOKEN"
vercel blob get backups/2026-11-29T01-07-12Z.json.gz --access private --output ~/offboard-restore/dump.json.gz --rw-token "$BLOB_READ_WRITE_TOKEN"
unset BLOB_READ_WRITE_TOKEN
```

The dump holds every Member's personal data. Delete `~/offboard-restore` once the restore is done.

## 3. Restore it into a new, empty database (tried locally, with a real dump)

1. In the Neon Console (not tried): the project, the default branch, **Databases**, **Add database**, a new name such as `offboard_restored`, owner the same as the live one's. Copy its connection string from **Connect**, choosing that database.
2. In a checkout of `main`, with the address read without showing it:

   ```sh
   read -rs DATABASE_URL && export DATABASE_URL    # paste the new database's address, then Enter
   pnpm migrate
   pnpm restore ~/offboard-restore/dump.json.gz
   unset DATABASE_URL
   ```

   `pnpm restore` refuses a database with anyone in it, or with anything in a table the dump fills, and one missing a migration the dump's had. It restores every row and sequence in one transaction, or nothing, and lists the rows it restored by table.

## 4. Point the site at it (not tried)

`DATABASE_URL` on Vercel is a secret set by hand, which can't be read back: replace it with the new address, then redeploy production, as a setting takes effect only with a deploy. On your own machine, signed in to the Vercel CLI:

```sh
vercel --scope ketflows-projects env add DATABASE_URL production --project offboard --sensitive --force
```

It asks for the value: paste the new database's address there, never as an argument or through `pbpaste |`. Then redeploy production, `vercel --scope ketflows-projects redeploy <the latest production deployment's address>`. The build migrates the new database, which has every migration already.

## What a restore brings back that should not come back

- **Everyone who left after the dump was taken** is back, with their Profile, results and Lichess connection, and anyone who joined since is gone. The site keeps no list of who left: remove anyone who asks again, from the Organiser page.
- **Nobody is signed in.** Sessions and one-time sign-in values are never in a dump, so everyone signs in again with LinkedIn.
- **Results collected after the dump are missing.** For each Matchday since, run `pnpm ingest <its tournament id>` while Lichess still has it.
- **Posts and alerts the bot sent after the dump** may be sent again, if they had not been sent when it was taken.
- **The Organiser's Lichess permission** comes back as it was then, sealed under `LICHESS_TOKEN_KEY`: it works only while that key is the same, and only if the Organiser has not connected Lichess again since, which revoked it.

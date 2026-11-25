-- What the bot posts to the Club's Telegram group (#13): the reminders on a Matchday Sunday, each Recap, and the notices
-- of a skipped Sunday or a Season's start. Each post is queued here, then sent from here, once (lib/telegram.ts):
-- - "key" says what the post is, so that it is queued once however many runs reach it, such as "recap:2026-11-29". A
--   notice is queued by the statement that changes the schedule, only when it changes something, under a random key.
-- - A run takes a post by setting "claimedAt", and no other run sends it then. "sentAt" is set once Telegram has posted
--   it. When Telegram refused it, or was never reached, the claim is given back and a later run tries again; when it is
--   not known whether Telegram posted it, it stays claimed, so that it is never posted twice.
-- - "until" is when it stops being worth posting, such as a reminder once its Matchday has started.
create table "telegramPost" (
  "key" text not null primary key,
  "text" text not null,
  "until" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "claimedAt" timestamptz,
  "sentAt" timestamptz,
  check ("sentAt" is null or "claimedAt" is not null)
);

-- When each scheduled job last did its work, a run whose outcome was "done" (#17); until it first has, when it first
-- ran, which is when its row was made (a row made before this migration counts from now). The private alerts to the
-- Organiser count from it how long the backup has gone without succeeding, so that a backup that has never once
-- worked, or whose runs die before they can record anything, is noticed too.
alter table "scheduledJob" add column "lastDoneAt" timestamptz not null default now();

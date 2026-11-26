-- Each kind of request that failed on the server (#60), one row however many requests fail: the address by its shape,
-- as Next.js names the route ("/recaps/[date]", so never a Member's id or a query string), the kind of request ("page",
-- "route", "server action" or "proxy"), and why, in words from a fixed list (lib/request-failures.ts) that hold nothing
-- a person sent or an error said; and when one last failed. The Organiser page shows the latest, and the private alerts
-- (#17) tell the Organiser of each kind that failed in the last day, once a day.
create table "requestFailure" (
  "route" text not null,
  "kind" text not null,
  "reason" text not null,
  "lastAt" timestamptz not null default now(),
  primary key ("route", "kind", "reason")
);

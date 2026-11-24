-- When Matchdays happen. Dates are Vilnius calendar days.
-- A Season has a row once its start is fixed: Season 1 when its sixteenth sign-up arrives, and any Season whose
-- start the Organiser sets by hand. Every other Season starts two weeks after the previous one's last Matchday
-- and has no row, so it moves with skipped Sundays.

create table "season" ("number" integer not null primary key check ("number" >= 1), "start" date not null check (extract(isodow from "start") = 7));

-- Sundays with no Matchday. A skipped Sunday is not one of a Season's six.
create table "skippedSunday" ("date" date not null primary key check (extract(isodow from "date") = 7));

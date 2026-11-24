-- The optional Profile fields a person fills in themselves. Null means not given. The LinkedIn link is stored in its normalised form.

alter table "user" add column "position" text, add column "linkedInUrl" text, add column "openTo" text;

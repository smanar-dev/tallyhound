-- Each person chooses which emails Tallyhound sends them (TH-NOT-4). Both are on until they say otherwise.
alter table users add column morning_off boolean not null default false;
alter table users add column urgent_off boolean not null default false;

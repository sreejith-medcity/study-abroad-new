-- Teams, the people on a student's file, and who each service lands on.
--
-- Run this once in the Supabase SQL editor before the code that needs it goes
-- out. It makes four things and adds one column; it drops nothing and changes
-- no existing row. Running it twice is harmless.

create table if not exists teams (
  id text primary key,
  name text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists teams_name_uq on teams (lower(name));

create table if not exists team_members (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  lead boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists team_members_uq on team_members (team_id, user_id);
create index if not exists team_members_user_idx on team_members (user_id);

create table if not exists student_people (
  id text primary key,
  student_id text not null references students(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  part text not null,
  added_by_id text references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists student_people_uq on student_people (student_id, user_id, part);
create index if not exists student_people_student_idx on student_people (student_id);

create table if not exists service_owners (
  id text primary key,
  type service_type not null,
  user_id text not null references users(id) on delete cascade,
  set_by_id text references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists service_owners_type_uq on service_owners (type);

alter table students add column if not exists team_id text references teams(id) on delete set null;

-- What is there now.
select 'teams ' || count(*) from teams
union all select 'people on files ' || count(*) from student_people
union all select 'services with an owner ' || count(*) from service_owners;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  status text not null check (status in ('pending','processing','completed')) default 'pending',
  model text not null check (model in ('gpt','nano_banana')) default 'gpt',
  reference_image_id text not null,
  base_image_ids jsonb not null default '[]'::jsonb,
  current_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.image_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  base_image_id text not null,
  output_image_id text,
  output_temp_url text,
  status text not null check (status in ('pending','generated','approved','rejected')) default 'pending',
  attempts integer not null default 0,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_image_tasks_job_position on public.image_tasks(job_id, position);
create index if not exists idx_image_tasks_job_status on public.image_tasks(job_id, status);

create table if not exists public.app_config (
  id uuid primary key default gen_random_uuid(),
  prompt_positive text,
  prompt_negative text,
  default_model text not null check (default_model in ('gpt','nano_banana')) default 'gpt',
  feature_nano_banana boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_generic()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_jobs on public.jobs;
create trigger trg_set_updated_at_jobs
before update on public.jobs
for each row
execute function public.set_updated_at_generic();

drop trigger if exists trg_set_updated_at_image_tasks on public.image_tasks;
create trigger trg_set_updated_at_image_tasks
before update on public.image_tasks
for each row
execute function public.set_updated_at_generic();

drop trigger if exists trg_set_updated_at_app_config on public.app_config;
create trigger trg_set_updated_at_app_config
before update on public.app_config
for each row
execute function public.set_updated_at_generic();

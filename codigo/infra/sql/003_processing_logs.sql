create table if not exists public.processing_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  task_id uuid references public.image_tasks(id) on delete set null,
  model text,
  processing_time_ms integer,
  attempts integer,
  status text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_processing_logs_job on public.processing_logs(job_id, created_at desc);
create index if not exists idx_processing_logs_task on public.processing_logs(task_id, created_at desc);

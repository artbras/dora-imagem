create table if not exists public.user_google_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  access_token text,
  refresh_token text not null,
  expiry_date timestamptz,
  scope text,
  token_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_user_google_tokens()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_user_google_tokens on public.user_google_tokens;
create trigger trg_set_updated_at_user_google_tokens
before update on public.user_google_tokens
for each row
execute function public.set_updated_at_user_google_tokens();

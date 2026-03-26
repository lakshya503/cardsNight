-- Patch the new-user trigger so anonymous sign-ins (no email, no full_name)
-- don't hit the NOT NULL constraint on profiles.display_name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      new.email,
      'Guest'
    ),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

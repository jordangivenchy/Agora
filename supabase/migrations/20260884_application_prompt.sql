-- Mods can define application questions for their private board:
-- communities.application_prompt is shown in the apply dialog, and when
-- it's set an application must carry an answer (request_to_join
-- enforces it server-side). Editable by mods alongside description and
-- rules via update_community_settings.

alter table public.communities
  add column if not exists application_prompt text;

drop function if exists public.update_community_settings(uuid, text, text, boolean, text, text);
create function public.update_community_settings(
  p_community uuid,
  p_description text default null,
  p_rules text default null,
  p_is_private boolean default null,
  p_banner_url text default null,
  p_avatar_url text default null,
  p_application_prompt text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_is_private is not null and not exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = v_me and role = 'owner'
  ) then
    raise exception 'owner_only: Only the owner can change privacy.' using errcode = '42501';
  end if;
  update public.communities set
    description = case when p_description is null then description
                       when p_description = '' then null
                       else left(p_description, 500) end,
    rules       = case when p_rules is null then rules
                       when p_rules = '' then null
                       else left(p_rules, 4000) end,
    is_private  = coalesce(p_is_private, is_private),
    banner_url  = case when p_banner_url is null then banner_url
                       when p_banner_url = '' then null
                       else left(p_banner_url, 500) end,
    avatar_url  = case when p_avatar_url is null then avatar_url
                       when p_avatar_url = '' then null
                       else left(p_avatar_url, 500) end,
    application_prompt = case when p_application_prompt is null then application_prompt
                              when p_application_prompt = '' then null
                              else left(p_application_prompt, 1000) end
  where id = p_community;
  perform public.log_mod_action(p_community, v_me, 'settings_update', null, null,
    nullif(array_to_string(array_remove(array[
      case when p_description is not null then 'description' end,
      case when p_rules       is not null then 'rules' end,
      case when p_is_private  is not null then 'privacy' end,
      case when p_banner_url  is not null then 'banner' end,
      case when p_avatar_url  is not null then 'avatar' end,
      case when p_application_prompt is not null then 'application_prompt' end
    ], null), ', '), ''));
end;
$$;

grant execute on function public.update_community_settings(uuid, text, text, boolean, text, text, text) to authenticated;

-- Applications must answer the board's questions when there are any.
create or replace function public.request_to_join(p_community uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_prompt text;
  v_mod record;
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 500), '');
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if public.is_community_banned(p_community, v_me) then
    raise exception 'banned: You are banned from this community.' using errcode = 'P0001';
  end if;
  select name, application_prompt into v_name, v_prompt
  from public.communities where id = p_community and is_private;
  if v_name is null then
    raise exception 'not_private: This community is public — just join it.' using errcode = 'P0001';
  end if;
  if public.is_community_member(p_community, v_me) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if v_prompt is not null and v_msg is null then
    raise exception 'application_required: This board asks every applicant a question — answer it to apply.' using errcode = 'P0001';
  end if;

  insert into public.community_join_requests (community_id, user_id, message)
  values (p_community, v_me, v_msg)
  on conflict (community_id, user_id) do update
    set message = excluded.message;

  for v_mod in
    select cm.user_id from public.community_members cm
    where cm.community_id = p_community and cm.role in ('owner', 'moderator')
  loop
    perform public.notif_emit(
      v_mod.user_id, 'join_request', v_me,
      null, null, null,
      jsonb_build_object('community_id', p_community, 'community_name', v_name),
      'jr:' || p_community::text
    );
  end loop;
end;
$$;

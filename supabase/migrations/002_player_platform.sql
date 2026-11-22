-- Apply after 001_club.sql. Adds player accounts, multi-club ownership,
-- role-play passes, owner-approved membership, and vice-owner management.
-- Purchases are deliberately SIMULATED. Never use this as a paid entitlement service.
begin;
create table public.player_profiles(id uuid primary key references auth.users on delete cascade, display_name text not null check(length(display_name) between 1 and 60), onboarding jsonb not null default '{}', created_at timestamptz not null default now());
alter table public.clubs add column owner_id uuid references auth.users;
alter table public.clubs add column tagline text not null default '' check(length(tagline)<=100);
alter table public.clubs add column logo text not null default '' check(length(logo)<=220000);
alter table public.clubs add column created_at timestamptz not null default now();
alter table public.club_members drop constraint club_members_role_check;
alter table public.club_members add constraint club_members_role_check check(role in('organizer','owner','vice','member'));
create table public.owner_passes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,kind text not null default 'prototype' check(kind='prototype'),amount int not null default 0 check(amount=0),club_id uuid unique references public.clubs,created_at timestamptz not null default now());
create unique index one_unused_pass on public.owner_passes(user_id) where club_id is null;
create table public.membership_invites(id uuid primary key default gen_random_uuid(),club_id uuid not null references public.clubs on delete cascade,token_hash text not null unique,expires_at timestamptz not null,revoked boolean not null default false);
create table public.membership_requests(id uuid primary key default gen_random_uuid(),club_id uuid not null references public.clubs on delete cascade,user_id uuid not null references auth.users on delete cascade,invite_id uuid references public.membership_invites,note text not null default '' check(length(note)<=200),status text not null default 'pending' check(status in('pending','accepted','rejected','removed')),reviewed_by uuid references auth.users,created_at timestamptz not null default now(),unique(club_id,user_id));
alter table public.player_profiles enable row level security;
alter table public.owner_passes enable row level security;
alter table public.membership_invites enable row level security;
alter table public.membership_requests enable row level security;
revoke all on public.player_profiles,public.owner_passes,public.membership_invites,public.membership_requests from anon,authenticated;
-- All access is through the narrowly scoped RPCs below.
create or replace function public.is_organizer(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.club_members where club_id=p_club and user_id=auth.uid() and role in('organizer','owner','vice')) $$;
create function public.is_club_member(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.club_members where club_id=p_club and user_id=auth.uid()) $$;
create or replace function public.has_session_access(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
select public.is_club_member(p_club) or exists(select 1 from public.guest_access a join public.club_invites i on i.id=a.invite_id join public.club_revisions r on r.club_id=i.club_id and r.session_id=i.session_id where a.user_id=auth.uid() and i.club_id=p_club and not i.revoked and i.expires_at>now()) $$;
create function public.require_player() returns uuid language plpgsql stable security definer set search_path='' as $$
declare u uuid=auth.uid();
begin
 if u is null or not exists(select 1 from auth.users where id=u and not coalesce(is_anonymous,false)) then raise exception 'A regular player account is required' using errcode='42501';end if;
 return u;
end $$;
create function public.save_player_profile(p_name text,p_onboarding jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare u uuid=public.require_player();
begin
 if length(btrim(p_name)) not between 1 and 60 or p_name is null or jsonb_typeof(p_onboarding) is distinct from 'object' or length(p_onboarding::text)>2000 then raise exception 'Enter a valid player name and introduction';end if;
 insert into public.player_profiles(id,display_name,onboarding) values(u,btrim(p_name),p_onboarding) on conflict(id) do update set display_name=excluded.display_name,onboarding=case when excluded.onboarding='{}'::jsonb then player_profiles.onboarding else excluded.onboarding end;
end $$;
create function public.preview_membership_invite(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.clubs;
begin
 select clubs.* into c from public.membership_invites i join public.clubs on clubs.id=i.club_id where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and not i.revoked and i.expires_at>now();
 if c.id is null then raise exception 'This membership invitation has expired or been revoked';end if;
 return jsonb_build_object('id',c.id,'name',c.name,'tagline',c.tagline,'logo',c.logo);
end $$;
create function public.platform_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid=public.require_player(); joined uuid[]; visible uuid[];
begin
 select coalesce(array_agg(club_id),'{}') into joined from public.club_members where user_id=u;
 select coalesce(array_agg(id),'{}') into visible from public.clubs where id=any(joined) or id in(select club_id from public.membership_requests where user_id=u);
 return jsonb_build_object(
 'version',1,
 'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'onboarding',case when p.id=u then p.onboarding else '{}'::jsonb end)) from public.player_profiles p where p.id=u or p.id in(select user_id from public.club_members where club_id=any(joined)) or p.id in(select r.user_id from public.membership_requests r join public.clubs c on c.id=r.club_id where c.owner_id=u)),'[]'),
 'clubs',coalesce((select jsonb_agg(to_jsonb(c)) from public.clubs c where c.id=any(visible)),'[]'),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.club_members m where m.club_id=any(joined)),'[]'),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)) from public.membership_requests r join public.clubs c on c.id=r.club_id where r.user_id=u or c.owner_id=u),'[]'),
 'passes',coalesce((select jsonb_agg(to_jsonb(p)) from public.owner_passes p where p.user_id=u),'[]'),
 'invites','[]'::jsonb);
end $$;
create function public.new_club_payload(p_name text,p_logo text,p_tagline text,p_courts int) returns jsonb language sql volatile set search_path='' as $$
 select jsonb_build_object('schema',1,'settings',jsonb_build_object('name',p_name,'logo',p_logo,'tagline',p_tagline,'accent','#d5f36b','challengeLimit',2,'openSize',4,'matching','mixed'),'session',jsonb_build_object('id',gen_random_uuid(),'title',p_name||' · Open Play','created',now()),'courts',(select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'name','Court '||i,'status','available','matchId',null)) from generate_series(1,p_courts) i),'players','[]'::jsonb,'open','[]'::jsonb,'mixer','[]'::jsonb,'challenge','[]'::jsonb,'tournament',null,'matches','[]'::jsonb,'events','[]'::jsonb,'round',0)
$$;
create function public.platform_action(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=public.require_player(); c public.clubs; pass public.owner_passes; inv public.membership_invites; req public.membership_requests; cid uuid; target uuid; name text; tagline text; logo text; count int; token text; selected_role text;
begin
 if not exists(select 1 from public.player_profiles where id=u) then raise exception 'Complete your player profile first';end if;
 if p_action='purchase-pass' then
   -- Serialized per player; retries return the same unused, zero-price prototype pass.
   perform 1 from public.player_profiles where id=u for update;
   select * into pass from public.owner_passes where user_id=u and club_id is null;
   if pass.id is null then insert into public.owner_passes(user_id) values(u) returning * into pass;end if;
   return jsonb_build_object('pass',to_jsonb(pass));
 elsif p_action='create-club' then
   select * into pass from public.owner_passes where id=(p_data->>'pass_id')::uuid and user_id=u and club_id is null for update;
   if pass.id is null then raise exception 'Get an unused Club Owner Pass first';end if;
   name=btrim(p_data->>'name');tagline=coalesce(p_data->>'tagline','');logo=coalesce(p_data->>'logo','');count=(p_data->>'courts')::int;
   if name is null or length(name) not between 1 and 60 or length(tagline)>100 or count is null or count not between 1 and 8 or length(logo)>220000 or (logo<>'' and logo!~'^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') then raise exception 'Check the club name, logo, tagline and 1–8 courts';end if;
   cid=gen_random_uuid();insert into public.clubs(id,name,owner_id,tagline,logo) values(cid,name,u,tagline,logo) returning * into c;
   insert into public.club_members values(cid,u,'owner');update public.owner_passes set club_id=cid where id=pass.id;
   insert into public.club_state(club_id,payload) values(cid,public.new_club_payload(name,logo,tagline,count));
   return jsonb_build_object('club',to_jsonb(c));
 elsif p_action='request-membership' then
   select * into inv from public.membership_invites where token_hash=encode(sha256(convert_to(p_data->>'token','UTF8')),'hex') and not revoked and expires_at>now();
   if inv.id is null then raise exception 'This membership invitation has expired or been revoked';end if;
   if exists(select 1 from public.club_members where club_id=inv.club_id and user_id=u) then raise exception 'Already a member';end if;
   if exists(select 1 from public.membership_requests where club_id=inv.club_id and user_id=u and status='pending') then raise exception 'Your request is already pending';end if;
   insert into public.membership_requests(club_id,user_id,invite_id,note) values(inv.club_id,u,inv.id,left(coalesce(p_data->>'note',''),200)) on conflict(club_id,user_id) do update set status='pending',note=excluded.note,invite_id=excluded.invite_id,created_at=now(),reviewed_by=null returning * into req;
   return jsonb_build_object('request',to_jsonb(req));
 end if;
 cid=(p_data->>'club_id')::uuid;select * into c from public.clubs where id=cid for update;
 if c.id is null then raise exception 'Club not found';end if;
 if p_action='membership-invite' then
   if not public.is_organizer(cid) then raise exception 'Club management access required' using errcode='42501';end if;
   token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
   insert into public.membership_invites(club_id,token_hash,expires_at) values(cid,encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '7 days');
   return jsonb_build_object('invite',jsonb_build_object('token',token));
 end if;
 if c.owner_id is distinct from u then raise exception 'Only this club owner can do that' using errcode='42501';end if;
 if p_action='review-request' then
   select * into req from public.membership_requests where id=(p_data->>'request_id')::uuid and club_id=cid and status='pending' for update;
   if req.id is null then raise exception 'Request is no longer pending';end if;
   if p_data->>'decision' not in('accepted','rejected') then raise exception 'Invalid decision';end if;
   update public.membership_requests set status=p_data->>'decision',reviewed_by=u where id=req.id;
   if p_data->>'decision'='accepted' then insert into public.club_members values(cid,req.user_id,'member') on conflict do nothing;end if;
 elsif p_action='member-role' then
   target=(p_data->>'user_id')::uuid;selected_role=p_data->>'role';
   if target=u or selected_role not in('vice','member','remove') then raise exception 'Invalid member role change';end if;
   if not exists(select 1 from public.club_members where club_id=cid and user_id=target) then raise exception 'Approve this member first';end if;
   if selected_role='remove' then
     if exists(select 1 from public.court_players where club_id=cid and player_id=target) then raise exception 'Release this member’s active court first';end if;
     delete from public.club_members where club_id=cid and user_id=target;
     update public.membership_requests set status='removed' where club_id=cid and user_id=target;
   else update public.club_members set role=selected_role where club_id=cid and user_id=target;end if;
 elsif p_action='revoke-membership-invites' then update public.membership_invites set revoked=true where club_id=cid;
 else raise exception 'Unknown platform action';end if;
 return '{}'::jsonb;
end $$;

create function public.public_board_projection(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_set(p-'events','{matches}',coalesce((select jsonb_agg((m-'scoring')||jsonb_build_object('scoring',case when m->'scoring'='null'::jsonb then 'null'::jsonb else (m->'scoring')-'history' end)) from jsonb_array_elements(p->'matches') m where m->>'courtId' is not null or m->>'eventId'=p#>>'{tournament,id}'),'[]'::jsonb))
$$;
create function public.read_member_board(p_club uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare st public.club_state;
begin
 if not public.is_club_member(p_club) then raise exception 'Approved membership required' using errcode='42501';end if;
 select * into st from public.club_state where club_id=p_club;
 return jsonb_build_object('payload',public.public_board_projection(st.payload),'version',st.version);
end $$;
create or replace function public.read_board(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.club_invites; st public.club_state;
begin
 i=public.valid_invite(p_token);
 if auth.uid() is null or not exists(select 1 from public.guest_access where user_id=auth.uid() and invite_id=i.id) then raise exception 'Accept the session invitation first' using errcode='42501';end if;
 select * into st from public.club_state where club_id=i.club_id;
 return jsonb_build_object('payload',public.public_board_projection(st.payload),'version',st.version);
end $$;
-- Shared narrow Open Play mutation. Caller-specific wrappers authorize the identity.
create function public.apply_player_play(p_club uuid,p_user uuid,p_action text,p_data jsonb,p_source text) returns void language plpgsql security definer set search_path='' as $$
declare st public.club_state;p jsonb;entry jsonb;idx int;name text;skill text;partner text;pid uuid;ids jsonb;
begin
 select * into st from public.club_state where club_id=p_club for update;if not found then raise exception 'Club not found';end if;p=st.payload;
 select value,ordinality::int-1 into entry,idx from jsonb_array_elements(p->'open') with ordinality where value->'playerIds' @> jsonb_build_array(p_user::text);
 if p_action='join' then
   if entry is not null then raise exception 'You are already checked in';end if;
   name=btrim(p_data->>'name');skill=p_data->>'skill';partner=btrim(coalesce(p_data->>'partner',''));
   if p_source='member' then select display_name into name from public.player_profiles where id=p_user;end if;
   if name is null or length(name) not between 1 and 60 or skill is null or skill not in('Beginner','Intermediate','Advanced') or length(partner)>60 then raise exception 'Enter a valid name and skill level';end if;
   if partner<>'' and p#>>'{settings,openSize}'='2' then raise exception 'Singles accepts one player';end if;
   if not exists(select 1 from jsonb_array_elements(p->'players') x where x->>'id'=p_user::text) then p=jsonb_set(p,'{players}',p->'players'||jsonb_build_array(jsonb_build_object('id',p_user,'name',name,'skill',skill,'source',p_source,'demo',false)));end if;
   ids=jsonb_build_array(p_user::text);
   if partner<>'' then pid=gen_random_uuid();p=jsonb_set(p,'{players}',p->'players'||jsonb_build_array(jsonb_build_object('id',pid,'name',partner,'skill',skill,'source','visitor','managedBy',p_user,'demo',false)));ids=ids||jsonb_build_array(pid::text);end if;
   entry=jsonb_build_object('id',gen_random_uuid(),'name',name||case when partner<>'' then ' & '||partner else '' end,'playerIds',ids,'arrived',floor(extract(epoch from clock_timestamp())*1000),'status','waiting','readyIds','[]'::jsonb,'streak',0);
   p=jsonb_set(p,'{open}',p->'open'||jsonb_build_array(entry));
 elsif entry is null then raise exception 'No check-in found for this identity';
 elsif p_action='ready' then
   if entry->>'status'<>'called' then raise exception 'Wait for your court call';end if;
   select coalesce(jsonb_agg(distinct id),'[]'::jsonb) into ids from (select value as id from jsonb_array_elements(entry->'readyIds') union select to_jsonb(x->>'id') from jsonb_array_elements(p->'players') x where entry->'playerIds' @> jsonb_build_array(x->>'id') and (x->>'id'=p_user::text or x->>'managedBy'=p_user::text)) owned;
   entry=jsonb_set(entry,'{readyIds}',ids);p=jsonb_set(p,array['open',idx::text],entry);
 elsif p_action in('toggle-pause','leave') then
   if entry->>'status' not in('waiting','paused') then raise exception 'Ask an organizer to release the active game first';end if;
   if p_action='leave' then p=jsonb_set(p,'{open}',(p->'open')-idx);else entry=jsonb_set(entry,'{status}',to_jsonb(case when entry->>'status'='paused' then 'waiting' else 'paused' end));p=jsonb_set(p,array['open',idx::text],entry);end if;
 else raise exception 'Player action is not permitted' using errcode='42501';end if;
 update public.club_state set payload=p,version=version+1,updated_at=now() where club_id=p_club;
 insert into public.club_audit(club_id,actor,action,version) values(p_club,p_user,p_source||':'||p_action,st.version+1);
end $$;
create or replace function public.guest_action(p_token text,p_action text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare i public.club_invites;u uuid=auth.uid();
begin
 if u is null then raise exception 'Anonymous sign-in required' using errcode='42501';end if;
 i=public.valid_invite(p_token);
 if i.role<>'guest' or not exists(select 1 from public.guest_access where user_id=u and invite_id=i.id) then raise exception 'Guest check-in access required' using errcode='42501';end if;
 perform public.apply_player_play(i.club_id,u,p_action,p_data,'visitor');
end $$;
create function public.member_play_action(p_club uuid,p_action text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare u uuid=public.require_player();
begin
 if not public.is_club_member(p_club) then raise exception 'Approved membership required' using errcode='42501';end if;
 perform public.apply_player_play(p_club,u,p_action,p_data,'member');
end $$;
revoke all on function public.is_club_member(uuid),public.require_player(),public.save_player_profile(text,jsonb),public.preview_membership_invite(text),public.platform_snapshot(),public.new_club_payload(text,text,text,int),public.platform_action(text,jsonb),public.public_board_projection(jsonb),public.read_member_board(uuid),public.apply_player_play(uuid,uuid,text,jsonb,text),public.member_play_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.preview_membership_invite(text) to anon,authenticated;
grant execute on function public.is_club_member(uuid),public.save_player_profile(text,jsonb),public.platform_snapshot(),public.platform_action(text,jsonb),public.read_member_board(uuid),public.member_play_action(uuid,text,jsonb) to authenticated;
commit;

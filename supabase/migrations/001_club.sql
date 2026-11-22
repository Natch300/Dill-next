-- Dill Next. Run once in Supabase SQL Editor as postgres, then run 002_player_platform.sql.
-- seed.sql and demo-seed.sql are optional legacy examples, not needed for player-created clubs.
-- A versioned club aggregate makes court assignment + queue + score + bracket atomic.
-- Relational projections add unique booking constraints and useful SQL query surfaces.
begin;
create table public.clubs (id uuid primary key, name text not null);
create table public.club_members (club_id uuid references public.clubs on delete cascade, user_id uuid references auth.users on delete cascade, role text not null check (role in ('organizer')), primary key (club_id,user_id));
create table public.club_state (club_id uuid primary key references public.clubs on delete cascade, version bigint not null default 0, payload jsonb not null, updated_at timestamptz not null default now());
create table public.club_revisions (club_id uuid primary key references public.clubs on delete cascade, session_id uuid not null, version bigint not null default 0);
create table public.club_invites (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs on delete cascade, session_id uuid not null, token_hash text unique not null, role text not null check(role in ('guest','display')), expires_at timestamptz not null, revoked boolean not null default false);
create table public.guest_access (user_id uuid references auth.users on delete cascade, invite_id uuid references public.club_invites on delete cascade, primary key(user_id,invite_id));
create table public.club_audit (id bigint generated always as identity primary key, club_id uuid references public.clubs on delete cascade, actor uuid, action text not null, version bigint not null, created_at timestamptz not null default now());
create table public.courts (club_id uuid references public.clubs on delete cascade, id uuid, name text not null, status text not null check(status in ('available','called','playing','reserved','closed')), primary key(club_id,id));
create table public.players (club_id uuid references public.clubs on delete cascade, id uuid, display_name text not null check(length(display_name) between 1 and 60), skill text not null check(skill in ('Beginner','Intermediate','Advanced')), demo boolean not null default false, primary key(club_id,id));
create table public.matches (club_id uuid references public.clubs on delete cascade, id uuid, mode text not null check(mode in ('open','tournament','mixer','challenge')), status text not null, court_id uuid, data jsonb not null, primary key(club_id,id), foreign key(club_id,court_id) references public.courts(club_id,id));
create unique index one_match_per_court on public.matches(club_id,court_id) where court_id is not null;
create table public.court_players (club_id uuid, player_id uuid, match_id uuid, primary key(club_id,player_id), foreign key(club_id,player_id) references public.players(club_id,id), foreign key(club_id,match_id) references public.matches(club_id,id) on delete cascade);

create function public.is_organizer(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.club_members where club_id=p_club and user_id=auth.uid())
$$;
create function public.has_session_access(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_organizer(p_club) or exists(select 1 from public.guest_access a join public.club_invites i on i.id=a.invite_id join public.club_revisions r on r.club_id=i.club_id and r.session_id=i.session_id where a.user_id=auth.uid() and i.club_id=p_club and not i.revoked and i.expires_at>now())
$$;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_state enable row level security;
alter table public.club_revisions enable row level security;
alter table public.club_invites enable row level security;
alter table public.guest_access enable row level security;
alter table public.club_audit enable row level security;
alter table public.courts enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.court_players enable row level security;
create policy club_member_read on public.clubs for select to authenticated using (public.is_organizer(id));
create policy member_read on public.club_members for select to authenticated using (user_id=auth.uid());
create policy organizer_state on public.club_state for select to authenticated using (public.is_organizer(club_id));
create policy scoped_revision on public.club_revisions for select to authenticated using (public.has_session_access(club_id));
create policy organizer_audit on public.club_audit for select to authenticated using (public.is_organizer(club_id));
create policy organizer_courts on public.courts for select to authenticated using (public.is_organizer(club_id));
create policy organizer_players on public.players for select to authenticated using (public.is_organizer(club_id));
create policy organizer_matches on public.matches for select to authenticated using (public.is_organizer(club_id));
create policy organizer_court_players on public.court_players for select to authenticated using (public.is_organizer(club_id));
-- No client insert/update/delete policy. All writes pass through restricted RPCs.
revoke all on public.clubs,public.club_members,public.club_state,public.club_revisions,public.club_invites,public.guest_access,public.club_audit,public.courts,public.players,public.matches,public.court_players from anon,authenticated;
grant select on public.clubs,public.club_members,public.club_state,public.club_revisions,public.club_audit,public.courts,public.players,public.matches,public.court_players to authenticated;

create function public.validate_club(p jsonb) returns void language plpgsql set search_path='' as $$
declare m jsonb; c jsonb; side jsonb; e jsonb; ids text[]; active_ids text[]='{}'; cid text; court_ids text[]='{}'; a int; b int; target int; margin int;
begin
  if p->>'schema' is distinct from '1' or jsonb_typeof(p->'players') is distinct from 'array' or jsonb_typeof(p->'courts') is distinct from 'array' or jsonb_typeof(p->'matches') is distinct from 'array' or jsonb_typeof(p->'open') is distinct from 'array' or jsonb_typeof(p->'mixer') is distinct from 'array' or jsonb_typeof(p->'challenge') is distinct from 'array' or jsonb_typeof(p->'events') is distinct from 'array' or jsonb_typeof(p->'settings') is distinct from 'object' then raise exception 'Invalid club payload'; end if;
  if jsonb_array_length(p->'courts') not between 1 and 8 then raise exception 'Court count must be 1–8'; end if;
  if p#>>'{settings,accent}' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid accent'; end if;
  if (p#>>'{settings,challengeLimit}')::int not between 1 and 5 or (p#>>'{settings,openSize}')::int not in (2,4) then raise exception 'Invalid play settings'; end if;
  if (select count(*) from jsonb_array_elements(p->'players')) <> (select count(distinct x->>'id') from jsonb_array_elements(p->'players') x) then raise exception 'Duplicate player identity'; end if;
  for e in select value from jsonb_array_elements(p->'players') loop
    if length(btrim(e->>'name')) not between 1 and 60 or e->>'skill' not in ('Beginner','Intermediate','Advanced') then raise exception 'Invalid player'; end if;
  end loop;
  for e in select value from jsonb_array_elements(p->'open') loop
    if jsonb_array_length(e->'playerIds') not between 1 and 2 then raise exception 'Invalid queue entry'; end if;
  end loop;
  if exists(select id from jsonb_array_elements(p->'open') q cross join lateral jsonb_array_elements_text(q->'playerIds') id group by id having count(*)>1) then raise exception 'Duplicate active check-in'; end if;
  for m in select value from jsonb_array_elements(p->'matches') loop
    cid=m->>'courtId';
    if cid is not null then
      if m->>'status' not in ('called','assigned','playing') then raise exception 'Inactive match cannot occupy court'; end if;
      if cid=any(court_ids) then raise exception 'Court already booked'; end if; court_ids=array_append(court_ids,cid);
      select value into c from jsonb_array_elements(p->'courts') where value->>'id'=cid;
      if c is null or c->>'matchId' is distinct from m->>'id' or c->>'status' not in ('called','reserved','playing') then raise exception 'Court assignment is inconsistent'; end if;
      if jsonb_array_length(m->'sides')<>2 or m#>>'{sides,0,id}' is null or m#>>'{sides,1,id}' is null then raise exception 'Match requires two sides'; end if;
      for side in select value from jsonb_array_elements(m->'sides') loop
        for e in select value from jsonb_array_elements(side->'playerIds') loop
          if e#>>'{}'=any(active_ids) then raise exception 'Player already on court'; end if;
          if not exists(select 1 from jsonb_array_elements(p->'players') x where x->>'id'=e#>>'{}') then raise exception 'Unknown player'; end if;
          active_ids=array_append(active_ids,e#>>'{}');
        end loop;
      end loop;
    end if;
    if m->>'status'='final' and m->'result'<>'null'::jsonb then
      a=(m#>>'{result,0}')::int; b=(m#>>'{result,1}')::int;
      target=11; margin=2;
      if m->>'mode'='tournament' then
        if m->>'eventId'=p#>>'{tournament,id}' then target=(p#>>'{tournament,target}')::int; margin=(p#>>'{tournament,margin}')::int;
        else select (value->>'target')::int,(value->>'margin')::int into target,margin from jsonb_array_elements(p->'events') where value->>'id'=m->>'eventId'; end if;
      end if;
      if a<0 or b<0 or greatest(a,b)<target or abs(a-b)<margin or (greatest(a,b)<>target and abs(a-b)<>margin) then raise exception 'Invalid final score'; end if;
    end if;
  end loop;
  for c in select value from jsonb_array_elements(p->'courts') loop
    if c->>'matchId' is not null and not exists(select 1 from jsonb_array_elements(p->'matches') x where x->>'id'=c->>'matchId' and x->>'courtId'=c->>'id') then raise exception 'Court has no matching game'; end if;
  end loop;
end $$;

create function public.sync_club_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare p jsonb=new.payload;
begin
  perform public.validate_club(p);
  delete from public.court_players where club_id=new.club_id;
  delete from public.matches where club_id=new.club_id;
  delete from public.courts where club_id=new.club_id;
  delete from public.players where club_id=new.club_id;
  insert into public.courts select new.club_id,(x->>'id')::uuid,x->>'name',x->>'status' from jsonb_array_elements(p->'courts') x;
  insert into public.players select new.club_id,(x->>'id')::uuid,x->>'name',x->>'skill',coalesce((x->>'demo')::boolean,false) from jsonb_array_elements(p->'players') x;
  insert into public.matches select new.club_id,(x->>'id')::uuid,x->>'mode',x->>'status',(x->>'courtId')::uuid,x from jsonb_array_elements(p->'matches') x;
  insert into public.court_players select new.club_id,(pid#>>'{}')::uuid,(m->>'id')::uuid from jsonb_array_elements(p->'matches') m cross join lateral jsonb_array_elements(m->'sides') side cross join lateral jsonb_array_elements(side->'playerIds') pid where m->>'courtId' is not null;
  insert into public.club_revisions values(new.club_id,(p#>>'{session,id}')::uuid,new.version) on conflict(club_id) do update set session_id=excluded.session_id,version=excluded.version;
  return new;
end $$;
create trigger sync_club after insert or update on public.club_state for each row execute function public.sync_club_projection();

create function public.commit_club(p_club uuid,p_expected bigint,p_payload jsonb,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.club_state; next_version bigint;
begin
  if not public.is_organizer(p_club) then raise exception 'Organizer access required' using errcode='42501'; end if;
  select * into old from public.club_state where club_id=p_club for update;
  if not found then raise exception 'Club not found'; end if;
  if old.version<>p_expected then raise exception 'STALE: Reload the current club state' using errcode='40001'; end if;
  if p_payload#>>'{session,id}' is distinct from old.payload#>>'{session,id}' then raise exception 'Session identity cannot be changed'; end if;
  next_version=old.version+1;
  update public.club_state set payload=p_payload,version=next_version,updated_at=now() where club_id=p_club;
  insert into public.club_audit(club_id,actor,action,version) values(p_club,auth.uid(),left(p_action,80),next_version);
  return jsonb_build_object('payload',p_payload,'version',next_version);
end $$;

create function public.create_invite(p_club uuid,p_role text,p_hours int default 12) returns jsonb language plpgsql security definer set search_path='' as $$
declare token text=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); expiry timestamptz; sid uuid;
begin
  if not public.is_organizer(p_club) then raise exception 'Organizer access required' using errcode='42501'; end if;
  if p_role not in ('guest','display') or p_hours not between 1 and 168 then raise exception 'Invalid invitation'; end if;
  select session_id into sid from public.club_revisions where club_id=p_club;
  expiry=now()+make_interval(hours=>p_hours);
  insert into public.club_invites(club_id,session_id,token_hash,role,expires_at) values(p_club,sid,encode(sha256(convert_to(token,'UTF8')),'hex'),p_role,expiry);
  return jsonb_build_object('token',token,'expires_at',expiry);
end $$;
create function public.valid_invite(p_token text) returns public.club_invites language plpgsql stable security definer set search_path='' as $$
declare invitation public.club_invites;
begin
  select i.* into invitation from public.club_invites i join public.club_revisions r on r.club_id=i.club_id and r.session_id=i.session_id where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and not i.revoked and i.expires_at>now();
  if invitation.id is null then raise exception 'This session link has expired or been revoked' using errcode='42501'; end if;
  return invitation;
end $$;
create function public.accept_invite(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.club_invites;
begin
  if auth.uid() is null then raise exception 'Sign in anonymously first' using errcode='42501'; end if;
  i=public.valid_invite(p_token);
  insert into public.guest_access values(auth.uid(),i.id) on conflict do nothing;
  return jsonb_build_object('role',i.role,'club_id',i.club_id);
end $$;
create function public.revoke_invites(p_club uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_organizer(p_club) then raise exception 'Organizer access required' using errcode='42501'; end if;
  update public.club_invites set revoked=true where club_id=p_club;
end $$;

create function public.read_board(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.club_invites; st public.club_state; p jsonb;
begin
  i=public.valid_invite(p_token);
  if auth.uid() is null or not exists(select 1 from public.guest_access where user_id=auth.uid() and invite_id=i.id) then raise exception 'Accept the session invitation first' using errcode='42501'; end if;
  select * into st from public.club_state where club_id=i.club_id;
  p=st.payload-'events';
  -- No email, auth identifiers, invitation data, audit or historical undo snapshots.
  p=jsonb_set(p,'{matches}',coalesce((select jsonb_agg((m-'scoring')||jsonb_build_object('scoring',case when m->'scoring'='null'::jsonb then 'null'::jsonb else (m->'scoring')-'history' end)) from jsonb_array_elements(p->'matches') m where m->>'courtId' is not null or m->>'eventId'=p#>>'{tournament,id}'),'[]'::jsonb));
  p=jsonb_set(p,'{players}',coalesce((select jsonb_agg(jsonb_build_object('id',e->'id','name',e->'name','skill',e->'skill')) from jsonb_array_elements(p->'players') e),'[]'::jsonb));
  return jsonb_build_object('payload',p,'version',st.version);
end $$;

create function public.guest_action(p_token text,p_action text,p_data jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path='' as $$
declare i public.club_invites; st public.club_state; p jsonb; entry jsonb; idx int; name text; skill text; partner text; partner_id uuid; ids jsonb; entries jsonb; uid uuid=auth.uid();
begin
  if uid is null then raise exception 'Sign in anonymously first' using errcode='42501'; end if;
  i=public.valid_invite(p_token);
  if i.role<>'guest' or not exists(select 1 from public.guest_access where user_id=uid and invite_id=i.id) then raise exception 'Guest check-in access required' using errcode='42501'; end if;
  select * into st from public.club_state where club_id=i.club_id for update; p=st.payload;
  select value,ordinality::int-1 into entry,idx from jsonb_array_elements(p->'open') with ordinality where value->'playerIds' @> jsonb_build_array(uid::text);
  if p_action='join' then
    if entry is not null then raise exception 'You are already checked in'; end if;
    name=btrim(p_data->>'name'); skill=p_data->>'skill'; partner=btrim(coalesce(p_data->>'partner',''));
    if name is null or length(name) not between 1 and 60 or skill is null or skill not in ('Beginner','Intermediate','Advanced') or length(partner)>60 then raise exception 'Enter a name and valid skill level'; end if;
    if partner<>'' and p#>>'{settings,openSize}'='2' then raise exception 'Singles check-in accepts one player'; end if;
    if not exists(select 1 from jsonb_array_elements(p->'players') x where x->>'id'=uid::text) then p=jsonb_set(p,'{players}',p->'players'||jsonb_build_array(jsonb_build_object('id',uid,'name',name,'skill',skill,'demo',false))); end if;
    ids=jsonb_build_array(uid::text);
    if partner<>'' then
      partner_id=gen_random_uuid();
      p=jsonb_set(p,'{players}',p->'players'||jsonb_build_array(jsonb_build_object('id',partner_id,'name',partner,'skill',skill,'demo',false)));
      ids=ids||jsonb_build_array(partner_id::text);
    end if;
    entry=jsonb_build_object('id',gen_random_uuid(),'name',name||case when partner<>'' then ' & '||partner else '' end,'playerIds',ids,'arrived',floor(extract(epoch from clock_timestamp())*1000),'status','waiting','readyIds','[]'::jsonb,'streak',0);
    p=jsonb_set(p,'{open}',p->'open'||jsonb_build_array(entry));
  elsif entry is null then raise exception 'No check-in found for this account';
  elsif p_action='ready' then
    if entry->>'status'<>'called' then raise exception 'Wait for your court call'; end if;
    -- The guest controls their own entry, including a partner checked in on this device.
    entry=jsonb_set(entry,'{readyIds}',entry->'playerIds');
    p=jsonb_set(p,array['open',idx::text],entry);
  elsif p_action in ('toggle-pause','leave') then
    if entry->>'status' not in ('waiting','paused') then raise exception 'Ask an organizer to release your active game first'; end if;
    if p_action='leave' then p=jsonb_set(p,'{open}',(p->'open')-idx);
    else entry=jsonb_set(entry,'{status}',to_jsonb(case when entry->>'status'='paused' then 'waiting' else 'paused' end));p=jsonb_set(p,array['open',idx::text],entry);end if;
  else raise exception 'Guest action is not permitted' using errcode='42501';
  end if;
  update public.club_state set payload=p,version=version+1,updated_at=now() where club_id=i.club_id;
  insert into public.club_audit(club_id,actor,action,version) values(i.club_id,uid,'guest:'||p_action,st.version+1);
end $$;

-- Deny default PUBLIC execution (including internal helpers); expose only intended RPCs.
revoke all on function public.is_organizer(uuid), public.has_session_access(uuid), public.validate_club(jsonb),public.sync_club_projection(),public.commit_club(uuid,bigint,jsonb,text),public.create_invite(uuid,text,int),public.valid_invite(text),public.accept_invite(text),public.revoke_invites(uuid),public.read_board(text),public.guest_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.is_organizer(uuid),public.has_session_access(uuid),public.commit_club(uuid,bigint,jsonb,text),public.create_invite(uuid,text,int),public.accept_invite(text),public.revoke_invites(uuid),public.read_board(text),public.guest_action(text,text,jsonb) to authenticated;
-- Realtime carries only a revision. Clients re-read through their authorized path.
alter publication supabase_realtime add table public.club_revisions;
commit;

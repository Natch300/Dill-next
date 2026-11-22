-- Safe to run again: never overwrites an existing club.
begin;
insert into public.clubs(id,name) values('a1111111-1111-4111-8111-111111111111','Dill Next') on conflict do nothing;
insert into public.club_state(club_id,payload) values('a1111111-1111-4111-8111-111111111111', $seed${"schema":1,"settings":{"name":"Dill Next","accent":"#d5f36b","challengeLimit":2,"openSize":4,"matching":"mixed"},"session":{"id":"777f59ff-1f6d-468e-b586-f178f39fb882","title":"Dill Next club session","created":"2026-11-21T04:12:19.057Z"},"courts":[{"id":"5eb1fa00-2527-4b39-b8b4-3f3db690360e","name":"Court 1","status":"available","matchId":null},{"id":"e5dcd61b-3db1-4c4b-923d-93fd83fe1870","name":"Court 2","status":"available","matchId":null},{"id":"326bf153-ab09-4455-b6f2-3077dcf53aa7","name":"Court 3","status":"available","matchId":null}],"players":[],"open":[],"mixer":[],"challenge":[],"tournament":null,"matches":[],"events":[],"round":0}$seed$::jsonb) on conflict do nothing;
commit;

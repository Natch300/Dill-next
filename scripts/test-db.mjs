import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptyState, dispatch } from '../js/engine.js';
import { demoState } from '../js/demo.js';
import { config } from '../config.js';
const db = new PGlite();
// Emulate Supabase's Auth SQL contract and roles. No remote project is modified.
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; create publication supabase_realtime;`);
await db.exec(await readFile('supabase/migrations/001_club.sql','utf8'));
const club=config.clubId, otherClub='b1111111-1111-4111-8111-111111111111';
const org='11111111-1111-4111-8111-111111111111',guest='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333',viewer='44444444-4444-4444-8444-444444444444';
await db.query('insert into auth.users values ($1),($2),($3),($4)',[org,guest,stranger,viewer]);
await db.query('insert into public.clubs values($1,$2),($3,$4)',[club,'Test club',otherClub,'Other club']);
await db.query('insert into public.club_state(club_id,payload) values($1,$2),($3,$4)',[club,JSON.stringify(emptyState()),otherClub,JSON.stringify(emptyState())]);
await db.query('insert into public.club_members values($1,$2,$3)',[club,org,'organizer']);
const as=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${role}`);};
const rpc=async(name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0]?.result;
process.on('uncaughtException',error=>{console.error('Database verification failed:',error.message,error.where||'');process.exit(1);});
let passed=0;
async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
await check('anonymous direct reads and organizer RPC are denied',async()=>{await as(null,'anon');await assert.rejects(db.query('select * from public.club_state'),/permission denied/);await assert.rejects(rpc('commit_club',[club,0,emptyState(),'attack']),/permission denied/);});
await check('organizer RLS can read own club, cannot read or mutate another club',async()=>{await as(org);assert.equal((await db.query('select * from public.club_state')).rows.length,1);await assert.rejects(rpc('commit_club',[otherClub,0,emptyState(),'attack']),/Organizer/);await assert.rejects(db.query("update public.club_state set version=9"),/permission denied/);});
let payload;
await check('atomic commit accepts valid aggregate and rejects stale revision',async()=>{payload=(await db.query('select payload from public.club_state where club_id=$1',[club])).rows[0].payload;payload=dispatch(payload,'register-and-join',{name:'Test organizer entry',skill:'Intermediate',mode:'open'});const result=await rpc('commit_club',[club,0,payload,'check-in']);assert.equal(result.version,1);await assert.rejects(rpc('commit_club',[club,0,payload,'stale']),/STALE/);});
let token,displayToken;
await check('organizer creates scoped guest and spectator invitations',async()=>{token=(await rpc('create_invite',[club,'guest',12])).token;displayToken=(await rpc('create_invite',[club,'display',12])).token;assert(token.length>=64);});
await check('outsider cannot read club state, invite table, or call organizer mutations',async()=>{await as(stranger);assert.equal((await db.query('select * from public.club_state')).rows.length,0);await assert.rejects(db.query('select * from public.club_invites'),/permission denied/);await assert.rejects(rpc('create_invite',[club,'guest',12]),/Organizer/);await assert.rejects(rpc('commit_club',[club,1,payload,'attack']),/Organizer/);});
await check('guest accepts valid invite; invalid invite denied',async()=>{await as(guest);await assert.rejects(rpc('accept_invite',['bad-token']),/expired/);assert.equal((await rpc('accept_invite',[token])).role,'guest');});
await check('guest can check in with partner; spoofed player identity is ignored',async()=>{await rpc('guest_action',[token,'join',{name:'Guest player',skill:'Beginner',partner:'Partner player',user_id:org,playerIds:[org]}]);const board=await rpc('read_board',[token]);const entry=board.payload.open.find(e=>e.playerIds.includes(guest));assert(entry);assert.equal(entry.playerIds.length,2);assert(!entry.playerIds.includes(org));assert.equal((await db.query('select * from public.club_state')).rows.length,0);assert.equal((await db.query('select * from public.club_revisions')).rows.length,1);});
await check('guest duplicate join, other-player action and organizer actions rejected',async()=>{await assert.rejects(rpc('guest_action',[token,'join',{name:'Again',skill:'Beginner'}]),/already checked/);await assert.rejects(rpc('guest_action',[token,'score',{playerId:org}]),/not permitted/);await assert.rejects(rpc('commit_club',[club,2,payload,'attack']),/Organizer/);const before=await rpc('read_board',[token]);await rpc('guest_action',[token,'toggle-pause',{playerId:org}]);const after=await rpc('read_board',[token]);assert.equal(after.payload.open.find(e=>e.playerIds.includes(guest)).status,'paused');assert.equal(after.payload.open.find(e=>!e.playerIds.includes(guest)).status,before.payload.open.find(e=>!e.playerIds.includes(guest)).status);});
await check('display role receives limited board and cannot check in or mutate',async()=>{await as(viewer);assert.equal((await rpc('accept_invite',[displayToken])).role,'display');const board=await rpc('read_board',[displayToken]);assert(!('events'in board.payload));assert(!JSON.stringify(board).includes('token_hash'));await assert.rejects(rpc('guest_action',[displayToken,'join',{name:'Bad',skill:'Beginner'}]),/Guest check-in/);await assert.rejects(rpc('commit_club',[club,3,payload,'attack']),/Organizer/);});
await check('database rejects double-booked courts and player duplication atomically',async()=>{await as(org);let st=(await db.query('select * from public.club_state where club_id=$1',[club])).rows[0];let next=demoState();next.session=st.payload.session;const good=await rpc('commit_club',[club,st.version,next,'demo']);const bad=structuredClone(next),live=bad.matches.filter(m=>m.courtId);live[1].courtId=live[0].courtId;await assert.rejects(rpc('commit_club',[club,good.version,bad,'bad-booking']),/booked/);assert.equal((await db.query('select version from public.club_state where club_id=$1',[club])).rows[0].version,good.version);const dup=structuredClone(next);dup.matches.filter(m=>m.courtId)[1].sides[0].playerIds[0]=dup.matches[0].sides[0].playerIds[0];await assert.rejects(rpc('commit_club',[club,good.version,dup,'bad-player']),/already on court/);});
await check('revoked invites deny existing sessions and realtime revision access',async()=>{await as(org);await rpc('revoke_invites',[club]);await as(guest);await assert.rejects(rpc('read_board',[token]),/expired/);await assert.rejects(rpc('guest_action',[token,'leave',{}]),/expired/);assert.equal((await db.query('select * from public.club_revisions')).rows.length,0);});
await check('expired invitations are rejected',async()=>{await as(org);const fresh=(await rpc('create_invite',[club,'guest',1])).token;await db.exec('reset role');await db.query('update public.club_invites set expires_at=now()-interval \'1 second\' where club_id=$1',[club]);await as(guest);await assert.rejects(rpc('accept_invite',[fresh]),/expired/);});
await db.exec('reset role; alter table auth.users add column is_anonymous boolean default false;');
await db.exec(await readFile('supabase/migrations/002_player_platform.sql','utf8'));
let ownedClub, secondClub, membershipToken, requestId;
await check('player platform purchases are simulated, idempotent, and single-use',async()=>{
  await as(org);await rpc('save_player_profile',['Owner',{source:'A friend or teammate',level:'Intermediate'}]);
  const pass=(await rpc('platform_action',['purchase-pass',{}])).pass;assert.equal(pass.amount,0);assert.equal(pass.kind,'prototype');assert.equal((await rpc('platform_action',['purchase-pass',{}])).pass.id,pass.id);
  const created=await rpc('platform_action',['create-club',{pass_id:pass.id,name:'First Club',tagline:'Together',courts:3,logo:''}]);ownedClub=created.club.id;
  assert.equal((await rpc('platform_snapshot')).members.find(m=>m.club_id===ownedClub).role,'owner');
  await assert.rejects(rpc('platform_action',['create-club',{pass_id:pass.id,name:'Again',courts:2}]),/unused/);
});
await check('another player cannot steal a pass or gain another owner’s club permissions',async()=>{
  const pass=(await rpc('platform_action',['purchase-pass',{}])).pass;await as(stranger);await rpc('save_player_profile',['Other owner',{}]);
  await assert.rejects(rpc('platform_action',['create-club',{pass_id:pass.id,name:'Stolen',courts:2}]),/unused/);
  const ownPass=(await rpc('platform_action',['purchase-pass',{}])).pass;secondClub=(await rpc('platform_action',['create-club',{pass_id:ownPass.id,name:'Second Club',courts:2}])).club.id;
  await assert.rejects(rpc('platform_action',['membership-invite',{club_id:ownedClub}]),/management/);
  await assert.rejects(rpc('read_member_board',[ownedClub]),/membership/);
  assert.equal((await db.query('select * from public.club_state where club_id=$1',[ownedClub])).rows.length,0);
});
await check('membership links reveal only club preview and never auto-join players',async()=>{
  await as(org);membershipToken=(await rpc('platform_action',['membership-invite',{club_id:ownedClub}])).invite.token;
  await as(null,'anon');const preview=await rpc('preview_membership_invite',[membershipToken]);assert.equal(preview.id,ownedClub);assert(!preview.owner_id);await assert.rejects(rpc('platform_snapshot'),/permission denied/);
  await as(guest);await rpc('save_player_profile',['Applicant',{}]);requestId=(await rpc('platform_action',['request-membership',{token:membershipToken,note:'Membership arranged in person'}])).request.id;
  const snap=await rpc('platform_snapshot');assert.equal(snap.requests.find(r=>r.id===requestId).status,'pending');assert.equal(snap.members.length,0);await assert.rejects(rpc('read_member_board',[ownedClub]),/membership/);
  await assert.rejects(rpc('platform_action',['review-request',{club_id:ownedClub,request_id:requestId,decision:'accepted'}]),/Only/);
});
await check('only the owner can approve; accepted player gets read/check-in but no management',async()=>{
  await as(org);await rpc('platform_action',['review-request',{club_id:ownedClub,request_id:requestId,decision:'accepted'}]);
  await as(guest);const board=await rpc('read_member_board',[ownedClub]);assert.equal(board.payload.settings.name,'First Club');assert.equal(board.payload.courts.length,3);
  await assert.rejects(rpc('commit_club',[ownedClub,board.version,board.payload,'attack']),/Organizer/);
  await rpc('member_play_action',[ownedClub,'join',{name:'Spoofed name',skill:'Intermediate'}]);const now=await rpc('read_member_board',[ownedClub]);assert.equal(now.payload.players[0].name,'Applicant');assert.equal(now.payload.players[0].source,'member');
});
await check('vice owners can manage their own club, but cannot approve or appoint',async()=>{
  await as(org);await rpc('platform_action',['member-role',{club_id:ownedClub,user_id:guest,role:'vice'}]);await as(guest);
  const st=(await db.query('select * from public.club_state where club_id=$1',[ownedClub])).rows[0];assert(st);await rpc('commit_club',[ownedClub,st.version,st.payload,'vice-check']);assert((await rpc('platform_action',['membership-invite',{club_id:ownedClub}])).invite.token);
  await assert.rejects(rpc('platform_action',['member-role',{club_id:ownedClub,user_id:stranger,role:'vice'}]),/Only/);
  await assert.rejects(rpc('platform_action',['review-request',{club_id:ownedClub,request_id:requestId,decision:'accepted'}]),/Only/);
  await assert.rejects(rpc('read_member_board',[secondClub]),/membership/);
});
await check('day visitors need no regular account, stay out of membership, and retain their partner',async()=>{
  await as(org);const day=(await rpc('create_invite',[ownedClub,'guest',12])).token;
  await db.exec('reset role');await db.query('update auth.users set is_anonymous=true where id=$1',[viewer]);await as(viewer);
  await assert.rejects(rpc('platform_action',['purchase-pass',{}]),/regular player/);
  await rpc('accept_invite',[day]);await rpc('guest_action',[day,'join',{name:'Day Visitor',skill:'Beginner',partner:'Visitor Partner'}]);
  const board=await rpc('read_board',[day]),entry=board.payload.open.find(e=>e.playerIds.includes(viewer));assert.equal(entry.playerIds.length,2);assert.equal(board.payload.players.find(p=>p.id===viewer).source,'visitor');assert.equal((await db.query('select * from public.club_members')).rows.length,0);
  await assert.rejects(rpc('accept_invite',[membershipToken]),/expired/);await assert.rejects(rpc('preview_membership_invite',[day]),/expired/);
});
await check('demotion and removal immediately revoke club management and read access',async()=>{
  await as(org);await rpc('platform_action',['member-role',{club_id:ownedClub,user_id:guest,role:'member'}]);await as(guest);assert.equal((await db.query('select * from public.club_state where club_id=$1',[ownedClub])).rows.length,0);
  await as(org);await rpc('platform_action',['member-role',{club_id:ownedClub,user_id:guest,role:'remove'}]);await as(guest);await assert.rejects(rpc('read_member_board',[ownedClub]),/membership/);await assert.rejects(rpc('member_play_action',[ownedClub,'join',{skill:'Beginner'}]),/membership/);
});
await check('manually paired independent visitors confirm only their own readiness',async()=>{
  await as(stranger);const day=(await rpc('create_invite',[secondClub,'guest',12])).token;
  for(const [id,name] of [[viewer,'Visitor A'],[guest,'Visitor B']]){await as(id);await rpc('accept_invite',[day]);await rpc('guest_action',[day,'join',{name,skill:'Intermediate'}]);}
  await as(stranger);let st=(await db.query('select * from public.club_state where club_id=$1',[secondClub])).rows[0];let next=dispatch(st.payload,'pair-entries',{entryIds:st.payload.open.map(e=>e.id)});
  for(const name of ['Opponent A','Opponent B'])next=dispatch(next,'register-and-join',{name,skill:'Intermediate',mode:'open'});
  next=dispatch(next,'call-next');await rpc('commit_club',[secondClub,st.version,next,'test-ready']);
  await as(viewer);await rpc('guest_action',[day,'ready',{}]);let board=await rpc('read_board',[day]);let entry=board.payload.open.find(e=>e.playerIds.includes(viewer));assert.deepEqual(entry.readyIds,[viewer]);
  await as(guest);await rpc('guest_action',[day,'ready',{}]);board=await rpc('read_board',[day]);entry=board.payload.open.find(e=>e.playerIds.includes(viewer));assert.equal(entry.readyIds.length,2);
});
console.log(`${passed} database checks passed against PostgreSQL (PGlite). Remote Supabase was not modified.`);
await db.close();

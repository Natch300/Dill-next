import test from 'node:test';
import assert from 'node:assert/strict';
import { startScore, rally, undo, scoreCall, serviceCourt, validResult } from '../js/scoring.js';
import { emptyState, dispatch, nextGroup, validateState, mixerStandings } from '../js/engine.js';
import { generateTournament, resolveMatches, correctTournament, standings, uid } from '../js/tournament.js';
import { demoState } from '../js/demo.js';
const event = (count, format='single', extra={}) => ({id:uid(),name:'Test',format,division:'Open singles',target:11,margin:2,pools:2,qualify:2,entrants:Array.from({length:count},(_,i)=>({id:uid(),name:`Seed ${i+1}`,playerIds:[uid()]})),...extra});
const finish = (t,matches,m,side=0) => correctTournament(t,matches,m,side===0?[11,5]:[5,11]);
function roster(count) {let s=emptyState();for(let i=0;i<count;i++)s=dispatch(s,'add-player',{name:`Player ${i}`,skill:'Intermediate'});return s;}

test('doubles starts 0–0–2 and service passes through both servers after first side-out',()=>{
  let s=startScore();assert.equal(scoreCall(s),'0–0–2');assert.equal(serviceCourt(s),'Right');
  s=rally(s,0);assert.deepEqual(s.points,[1,0]);assert.equal(serviceCourt(s),'Left');
  s=rally(s,1);assert.equal(scoreCall(s),'0–1–1');assert.equal(s.serverIndex,0);
  s=rally(s,0);assert.equal(scoreCall(s),'0–1–2');assert.equal(s.serverIndex,1);assert.equal(serviceCourt(s),'Left');
  s=rally(s,0);assert.equal(scoreCall(s),'1–0–1');assert.equal(s.serverIndex,1);assert.equal(serviceCourt(s),'Right');
});
test('initial right-player selection and complete undo survive JSON reload',()=>{
  let s=startScore({right:[1,0]});assert.equal(s.serverIndex,1);
  const before=structuredClone(s);s=rally(s,1);s=JSON.parse(JSON.stringify(s));assert.deepEqual(undo(s),before);
  s=rally(before,0);assert.equal(s.serverIndex,1);assert.equal(serviceCourt(s),'Left');
});
test('singles side-out, fixed score order, and win-by-two',()=>{
  let s=startScore({doubles:false});assert.equal(scoreCall(s),'0–0');
  s=rally(s,1);assert.equal(s.serving,1);assert.deepEqual(s.points,[0,0]);
  s.points=[10,10];s.serving=0;s=rally(s,0);assert.equal(s.winner,null);s=rally(s,0);assert.equal(s.winner,0);assert.deepEqual(s.points,[12,10]);
  assert.equal(undo(s).winner,null);assert.throws(()=>rally(s,1),/complete/);
});
test('final-score validation rejects negative, tied, insufficient and overplayed scores',()=>{
  for(const score of [[-1,11],[11,11],[11,10],[14,10],[10,8],[1.5,11]])assert.equal(validResult(...score),false);
  for(const score of [[11,0],[12,10],[15,13],[10,12]])assert.equal(validResult(...score),true);
  assert.equal(validResult(15,13,15,2),true);assert.equal(validResult(21,20,21,1),true);
});
test('six-player round robin has fifteen unique matches, five per player',()=>{
  const t=event(6,'round'), ms=generateTournament(t);assert.equal(ms.length,15);
  assert.equal(new Set(ms.map(m=>m.sides.map(e=>e.id).sort().join(':'))).size,15);
  t.entrants.forEach(e=>assert.equal(ms.filter(m=>m.sides.some(side=>side.id===e.id)).length,5));
  for(const m of ms)finish(t,ms,m);assert.equal(standings(t,ms)[0].played,5);
});
test('odd round robin has each pairing once and no fake bye result',()=>{const t=event(5,'round'),ms=generateTournament(t);assert.equal(ms.length,10);assert(ms.every(m=>m.sides.every(Boolean)));});
test('single elimination supports every entrant count 2–24 with n−1 real games',()=>{
  for(let n=2;n<=24;n++){
    const t=event(n),ms=generateTournament(t);let count=0;
    for(let step=0;step<100;step++){const ready=ms.find(m=>m.status==='ready');if(!ready)break;finish(t,ms,ready);count++;}
    assert.equal(count,n-1,`n=${n}`);assert.equal(ms.at(-1).status,'final');assert(ms.every(m=>['final','bye'].includes(m.status)));
  }
});
test('double elimination: each nonchampion takes exactly two losses, lower winner triggers reset',()=>{
  for(let n=2;n<=24;n++)for(const reset of [false,true]){
    const t=event(n,'double'),ms=generateTournament(t);let count=0;
    for(let step=0;step<100;step++){const m=ms.find(m=>m.status==='ready');if(!m)break;finish(t,ms,m,m.label==='F1.1'&&reset?1:0);count++;}
    assert.equal(count,2*n-2+(reset?1:0),`n=${n}, reset=${reset}`);
    const resetGame=ms.find(m=>m.label==='F2.1');assert.equal(resetGame.status,reset?'final':'void');
    const champion=(reset?resetGame:ms.find(m=>m.label==='F1.1')).winner;
    for(const e of t.entrants) {const losses=ms.filter(m=>m.status==='final'&&m.loser===e.id).length;if(e.id!==champion)assert.equal(losses,2,`n=${n} ${e.name}`);else assert(losses<=1);}
  }
});
test('two pools of three seed four qualifiers and three playoff matches; pool stats stay separate',()=>{
  const t=event(6,'playoffs'),ms=generateTournament(t);assert.equal(ms.length,6);
  for(const m of [...ms])finish(t,ms,m);
  assert.equal(t.qualifiers.length,4);assert.equal(ms.filter(m=>m.section==='Playoffs').length,3);
  const before=standings(t,ms);
  while(ms.some(m=>m.status==='ready'))finish(t,ms,ms.find(m=>m.status==='ready'));
  assert.deepEqual(standings(t,ms),before);assert.deepEqual(t.qualifiers.map(q=>q.finish),[1,1,2,2]);
});
test('pool minimums and qualifiers validated',()=>{
  assert.throws(()=>generateTournament(event(5,'pool')),/at least 3/);
  assert.throws(()=>generateTournament(event(6,'playoffs',{qualify:4})),/qualifiers/);
});
test('score correction requires release/clear of dependent games',()=>{
  const t=event(4),ms=generateTournament(t);finish(t,ms,ms[0]);finish(t,ms,ms[1]);const final=ms.at(-1);final.courtId=uid();final.status='assigned';
  assert.throws(()=>finish(t,ms,ms[0],1),/downstream/);final.courtId=null;final.status='ready';finish(t,ms,final);
  assert.throws(()=>finish(t,ms,ms[0],1),/downstream/);correctTournament(t,ms,final,null);finish(t,ms,ms[0],1);assert.equal(final.sides[0].id,ms[0].winner);
});
test('Open Play keeps partners together, skips paused entries, restores arrivals on cancelled calls',()=>{
  let s=roster(8);for(let i=0;i<8;i+=2)s=dispatch(s,'join',{playerIds:s.players.slice(i,i+2).map(p=>p.id)});
  s.open.forEach((e,i)=>e.arrived=100+i);s=dispatch(s,'queue-action',{id:s.open[0].id,mode:'open',action:'pause'});
  assert.equal(nextGroup(s)[0].id,s.open[1].id);s=dispatch(s,'call-next');const m=s.matches[0];assert.deepEqual(new Set(m.sides[0].playerIds),new Set(s.open[1].playerIds));
  s=dispatch(s,'cancel-match',{matchId:m.id,absentId:s.open[1].playerIds[0]});assert.equal(s.open[1].status,'paused');assert.equal(s.open[2].status,'waiting');assert.equal(s.open[2].arrived,102);
  s=dispatch(s,'queue-action',{id:s.open[0].id,mode:'open',action:'resume'});assert.equal(nextGroup(s)[0].id,s.open[0].id);
});
test('duplicate check-ins and cross-mode player/court bookings fail',()=>{
  let s=roster(8);for(const p of s.players)s=dispatch(s,'join',{playerIds:[p.id]});assert.throws(()=>dispatch(s,'join',{playerIds:[s.players[0].id]}),/already checked/);
  s=dispatch(s,'call-next');assert.throws(()=>dispatch(s,'call-next',{courtId:s.courts[0].id}),/unavailable/);
  for(let i=0;i<4;i+=2)s=dispatch(s,'join',{mode:'challenge',playerIds:s.players.slice(i,i+2).map(p=>p.id)});
  assert.throws(()=>dispatch(s,'challenge-start'),/eligible/);assert.throws(()=>dispatch(s,'court-status',{id:s.courts[0].id,status:'closed'}),/release/);
});
test('mixer prioritizes sit-outs and balances games; paused players are skipped',()=>{
  let s=roster(10);s=dispatch(s,'settings',{courts:2});for(const p of s.players)s=dispatch(s,'mixer-add',{playerId:p.id});s=dispatch(s,'mixer-round');
  const sit=s.mixer.filter(e=>e.lastSat===1).map(e=>e.playerId);assert.equal(sit.length,2);
  for(const m of [...s.matches])s=dispatch(s,'save-result',{matchId:m.id,result:[11,6]});s=dispatch(s,'mixer-round');
  const active=s.matches.filter(m=>m.courtId).flatMap(m=>m.sides.flatMap(e=>e.playerIds));assert(sit.every(id=>active.includes(id)));assert.equal(mixerStandings(s).filter(p=>p.games===1).length,8);
});
test('challenge winner stays once, then rotates at two consecutive wins',()=>{
  let s=roster(6);for(let i=0;i<6;i+=2)s=dispatch(s,'join',{mode:'challenge',playerIds:s.players.slice(i,i+2).map(p=>p.id)});
  s.challenge.forEach((e,i)=>e.arrived=100+i);s=dispatch(s,'challenge-start');const winner=s.matches[0].sides[0].id;
  s=dispatch(s,'save-result',{matchId:s.matches[0].id,result:[11,5]});assert.equal(s.challenge.find(e=>e.id===winner).streak,1);assert.equal(s.matches[1].sides[0].id,winner);
  s=dispatch(s,'save-result',{matchId:s.matches[1].id,result:[11,5]});assert.equal(s.challenge.find(e=>e.id===winner).streak,0);assert.equal(s.courts.filter(c=>c.matchId).length,0);
});
test('full demo is valid, serializable and has all four modes',()=>{const s=demoState();assert(validateState(s));assert.equal(s.courts.length,3);assert.equal(s.players.length,24);assert(s.mixer.length&&s.challenge.length&&s.tournament);assert(validateState(JSON.parse(JSON.stringify(s))));});
test('court removals and date ranges are guarded; demo removal keeps real players',()=>{
  let s=demoState();assert.throws(()=>dispatch(s,'settings',{courts:1}),/active games/);
  assert.throws(()=>dispatch(s,'new-tournament',{confirm:true,start:'2026-12-02T10:00+08:00',end:'2026-12-01T10:00+08:00'}),/End must/);
  for(const m of s.matches.filter(m=>m.courtId))s=dispatch(s,'cancel-match',{matchId:m.id});
  s=dispatch(s,'add-player',{name:'Real member',skill:'Beginner'});s=dispatch(s,'clean-demo');assert.equal(s.players.length,1);assert.equal(s.players[0].name,'Real member');assert.equal(s.matches.length,0);
});

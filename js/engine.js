import { startScore, rally, undo, validResult } from './scoring.js';
import { uid, generateTournament, correctTournament } from './tournament.js';
export const modes = { open: 'Open Play', tournament: 'Tournament', mixer: 'Social Mixer', challenge: 'Challenge Court' };
export const skills = ['Beginner', 'Intermediate', 'Advanced'];
const fail = message => { throw new Error(message); };
export function emptyState() {
  return { schema: 1, settings: { name: 'Dill Next', accent: '#d5f36b', challengeLimit: 2, openSize: 4, matching: 'mixed' },
    session: { id: uid(), title: 'Dill Next club session', created: new Date().toISOString() },
    courts: Array.from({ length: 3 }, (_, i) => ({ id: uid(), name: `Court ${i + 1}`, status: 'available', matchId: null })),
    players: [], open: [], mixer: [], challenge: [], tournament: null, matches: [], events: [], round: 0 };
}
export const player = (s, id) => s.players.find(p => p.id === id);
export const activeMatch = (s, court) => s.matches.find(m => m.id === court.matchId);
const active = s => s.matches.filter(m => m.courtId && !['final', 'cancelled'].includes(m.status));
export const busyPlayers = s => new Set(active(s).flatMap(m => m.sides.flatMap(e => e?.playerIds ?? [])));
export function eligible(s, mode = 'open') {
  const busy = busyPlayers(s);
  return s[mode].filter(e => (e.status === 'waiting' || !e.status) && !e.paused && e.playerIds.every(id => !busy.has(id))).sort((a, b) => a.arrived - b.arrived);
}
export function nextGroup(s) {
  const waiting = eligible(s), size = s.settings.openSize;
  for (const first of waiting) {
    const selected = [first]; let count = first.playerIds.length;
    if (count > size / 2) continue;
    const level = player(s, first.playerIds[0])?.skill;
    if (s.settings.matching === 'same' && first.playerIds.some(id => player(s, id)?.skill !== level)) continue;
    for (const e of waiting) {
      if (e === first || e.playerIds.length > size / 2 || count + e.playerIds.length > size) continue;
      if (s.settings.matching === 'same' && e.playerIds.some(id => player(s, id)?.skill !== level)) continue;
      selected.push(e); count += e.playerIds.length;
      if (count === size) break;
    }
    if (count === size) return selected;
  }
  return [];
}
export function estimateWait(s, index = 0) {
  const games = s.matches.filter(m => m.mode === 'open' && m.status === 'final' && m.started && m.finished);
  if (games.length < 3) return null;
  const average = games.reduce((sum, m) => sum + (new Date(m.finished) - new Date(m.started)), 0) / games.length / 60000;
  const courts = s.courts.filter(c => c.status !== 'closed').length || 1;
  return Math.max(1, Math.round(average * (1 + Math.floor(index / s.settings.openSize)) / courts));
}
function entrySide(s, entries) {
  const ids = entries.flatMap(e => e.playerIds);
  return { id: uid(), name: ids.map(id => player(s, id).name).join(' & '), playerIds: ids, entryIds: entries.map(e => e.id) };
}
function getCourt(s, id) {
  const c = id ? s.courts.find(c => c.id === id) : s.courts.find(c => c.status === 'available');
  if (!c || c.status !== 'available' || c.matchId) fail('That court is unavailable. Choose a free court.');
  return c;
}
function assign(s, m, courtId, called = false) {
  const c = getCourt(s, courtId), busy = busyPlayers(s);
  if (m.sides.some(e => !e)) fail('Both sides must be known before assigning a court.');
  if (m.sides.flatMap(e => e.playerIds).some(id => busy.has(id))) fail('A player is already assigned to another court.');
  c.matchId = m.id; c.status = called ? 'called' : 'reserved';
  m.courtId = c.id; m.status = called ? 'called' : 'assigned'; m.called = new Date().toISOString();
}
function newGame(s, mode, sides, courtId, extras = {}) {
  const m = { id: uid(), mode, sides, status: 'ready', courtId: null, result: null, scoring: null, started: null, ...extras };
  assign(s, m, courtId, mode === 'open'); s.matches.push(m); return m;
}
function release(s, m) {
  const c = s.courts.find(c => c.id === m.courtId);
  if (c) { c.matchId = null; c.status = 'available'; }
  m.courtId = null;
}
export function mixerStandings(s) {
  return s.mixer.map(e => {
    const games = s.matches.filter(m => m.mode === 'mixer' && m.status === 'final' && m.sides.some(side => side.playerIds.includes(e.playerId)));
    return { ...player(s, e.playerId), games: games.length, wins: games.filter(m => m.sides.find(side => side.id === m.winner)?.playerIds.includes(e.playerId)).length,
      points: games.reduce((sum, m) => sum + (m.result?.[m.sides.findIndex(side => side.playerIds.includes(e.playerId))] ?? 0), 0), paused: e.paused };
  }).sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name));
}
export function dispatch(input, command, payload = {}) {
  const s = structuredClone(input), p = payload;
  const m = p.matchId ? s.matches.find(m => m.id === p.matchId) : null;
  if (p.matchId && !m) fail('Match not found. Refresh and try again.');
  switch (command) {
    case 'register-and-join': {
      const ids = [uid()];
      let next = dispatch(s, 'add-player', { id: ids[0], name: p.name, skill: p.skill });
      if (p.partner) { ids.push(uid()); next = dispatch(next, 'add-player', { id: ids[1], name: p.partner, skill: p.skill }); }
      if (p.mode === 'mixer') return dispatch(next, 'mixer-add', { playerId: ids[0] });
      if (p.mode === 'tournament') return next;
      return dispatch(next, 'join', { mode: p.mode === 'challenge' ? 'challenge' : 'open', playerIds: ids, name: p.team });
    }
    case 'add-player': {
      const name = String(p.name ?? '').trim(); if (!name || name.length > 60) fail('Enter a display name of 1–60 characters.');
      if (!skills.includes(p.skill)) fail('Choose a skill level.');
      s.players.push({ id: p.id || uid(), name, skill: p.skill, demo: !!p.demo }); break;
    }
    case 'join': {
      const ids = p.playerIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 || new Set(ids).size !== ids.length || ids.some(id => !player(s, id))) fail('Choose distinct registered players.');
      const list = p.mode === 'challenge' ? s.challenge : s.open;
      if (p.mode === 'challenge' && ids.length !== 2) fail('Register a pair for Challenge Court.');
      if (p.mode !== 'challenge' && s.settings.openSize === 2 && ids.length !== 1) fail('Singles accepts one player per entry.');
      if (list.some(e => e.playerIds.some(id => ids.includes(id)))) fail('A player is already checked in.');
      list.push({ id: uid(), name: p.name || ids.map(id => player(s, id).name).join(' & '), playerIds: ids, arrived: Date.now(), status: 'waiting', readyIds: [], streak: 0 }); break;
    }
    case 'queue-action': {
      if (!['open', 'challenge'].includes(p.mode)) fail('Invalid queue.');
      const list = s[p.mode], e = list.find(e => e.id === p.id); if (!e) fail('Entry not found.');
      if (['called', 'playing'].includes(e.status)) fail('Release the active call before changing this entry.');
      if (p.action === 'remove') list.splice(list.indexOf(e), 1);
      else if (p.action === 'pause') e.status = 'paused';
      else if (p.action === 'resume') e.status = 'waiting';
      else if (p.action === 'back') e.arrived = Date.now();
      else fail('Unknown queue action.'); break;
    }
    case 'pair-entries': {
      const entries=p.entryIds?.map(id=>s.open.find(e=>e.id===id));
      if(!entries||entries.length!==2||entries[0]===entries[1]||entries.some(e=>!e||e.status!=='waiting'||e.playerIds.length!==1))fail('Choose two waiting solo entries to pair.');
      if(s.settings.openSize!==4)fail('Partners are available in doubles.');
      s.open=s.open.filter(e=>!entries.some(x=>x.id===e.id));const ids=entries.flatMap(e=>e.playerIds);
      s.open.push({id:uid(),name:ids.map(id=>player(s,id).name).join(' & '),playerIds:ids,arrived:Math.max(...entries.map(e=>e.arrived)),status:'waiting',readyIds:[],streak:0});break;
    }
    case 'unpair-entry': {
      const e=s.open.find(e=>e.id===p.id);if(!e||!['waiting','paused'].includes(e.status)||e.playerIds.length!==2)fail('Choose an unassigned partner entry.');
      s.open=s.open.filter(x=>x!==e);for(const id of e.playerIds)s.open.push({...e,id:uid(),name:player(s,id).name,playerIds:[id],readyIds:[]});break;
    }
    case 'call-selected':
    case 'call-next': {
      const group=command==='call-selected'?(p.entryIds||[]).map(id=>eligible(s).find(e=>e.id===id)):nextGroup(s);
      if(!group.length||group.some(e=>!e)||new Set(group.map(e=>e.id)).size!==group.length||group.reduce((n,e)=>n+e.playerIds.length,0)!==s.settings.openSize)fail(`Choose eligible entries totaling ${s.settings.openSize} players. Partners stay together.`);
      const size = s.settings.openSize / 2, sides = [[], []];
      // Put intact partner entries first, then fill the remaining side with solo entries.
      for (const e of [...group].sort((a, b) => b.playerIds.length - a.playerIds.length)) {
        const i = sides[0].reduce((n, e) => n + e.playerIds.length, 0) + e.playerIds.length <= size ? 0 : 1; sides[i].push(e);
      }
      newGame(s, 'open', sides.map(e => entrySide(s, e)), p.courtId);
      group.forEach(e => { e.status = 'called'; e.readyIds = []; }); break;
    }
    case 'ready': {
      const e = s.open.find(e => e.id === p.id); if (!e || e.status !== 'called' || !e.playerIds.includes(p.playerId)) fail('No active call for this player.');
      e.readyIds = [...new Set([...e.readyIds, p.playerId])]; break;
    }
    case 'cancel-match': {
      release(s, m); m.status = m.mode === 'tournament' ? 'ready' : 'cancelled'; m.scoring = null;
      if (m.mode === 'open' || m.mode === 'challenge') {
        const ids = m.sides.flatMap(e => e.playerIds);
        s[m.mode].filter(e => e.playerIds.some(id => ids.includes(id))).forEach(e => {
          e.status = e.playerIds.includes(p.absentId) ? 'paused' : 'waiting'; e.readyIds = [];
        });
      }
      break;
    }
    case 'start-score': {
      if (!m.courtId || !['called', 'assigned', 'playing'].includes(m.status)) fail('Assign a court first.');
      if (m.scoring) fail('Scoring has already started.');
      m.scoring = startScore({ doubles: m.sides[0].playerIds.length === 2, serving: Number(p.serving || 0), right: p.right || [0, 0], target: m.mode === 'tournament' ? s.tournament.target : 11, margin: m.mode === 'tournament' ? s.tournament.margin : 2 });
      m.started = new Date().toISOString(); m.status = 'playing'; s.courts.find(c => c.id === m.courtId).status = 'playing';
      if (m.mode === 'open') s.open.filter(e => m.sides.some(side => side.playerIds.some(id => e.playerIds.includes(id)))).forEach(e => e.status = 'playing');
      break;
    }
    case 'rally': if (!m.scoring || m.status !== 'playing') fail('Start scoring first.'); m.scoring = rally(m.scoring, Number(p.side)); break;
    case 'undo': if (!m.scoring || m.status !== 'playing') fail('Start scoring first.'); m.scoring = undo(m.scoring); break;
    case 'save-result': {
      if (m.status === 'final' || m.status === 'cancelled' || m.status === 'bye') fail('This game is no longer active.');
      const result = p.withoutScore ? null : p.result || m.scoring?.points;
      if (!result && (m.mode === 'tournament' || m.mode === 'challenge')) fail('This mode requires a final score.');
      if (result && (!Array.isArray(result) || result.length !== 2 || !validResult(...result, m.mode === 'tournament' ? s.tournament.target : 11, m.mode === 'tournament' ? s.tournament.margin : 2))) fail('Enter a valid final score. Reach the target and win by the required margin.');
      m.finished = new Date().toISOString(); release(s, m);
      if (m.mode === 'tournament') { correctTournament(s.tournament, s.matches, m, result); break; }
      m.result = result; m.status = 'final'; m.winner = result ? m.sides[result[0] > result[1] ? 0 : 1].id : null;
      if (m.mode === 'open') {
        const ids = m.sides.flatMap(e => e.playerIds);
        if (p.requeue !== false) s.open.filter(e => e.playerIds.some(id => ids.includes(id))).forEach((e, i) => { e.arrived = Date.now() + i; e.status = 'waiting'; e.readyIds = []; });
        else s.open = s.open.filter(e => !e.playerIds.some(id => ids.includes(id)));
      }
      if (m.mode === 'challenge') {
        const winning = s.challenge.find(e => e.id === m.winner), losing = s.challenge.find(e => m.sides.some(side => side.id === e.id) && e !== winning);
        winning.streak++; losing.streak = 0; losing.arrived = Date.now(); losing.status = 'waiting';
        winning.status = 'waiting';
        if (winning.streak >= s.settings.challengeLimit) { winning.streak = 0; winning.arrived = Date.now() + 1; }
        else { winning.arrived = 0; }
        // Winner remains on this court, reserved until a challenger is available.
        if (winning.arrived === 0) {
          const next = eligible(s, 'challenge').find(e => e.id !== winning.id);
          const court = input.courts.find(c => c.matchId === m.id);
          if (next) { newGame(s, 'challenge', [structuredClone(winning), structuredClone(next)], court.id); winning.status = 'playing'; next.status = 'playing'; }
        }
      }
      break;
    }
    case 'edit-result': {
      if (m.mode !== 'tournament' || m.status !== 'final') fail('Only completed tournament scores can be corrected here.');
      correctTournament(s.tournament, s.matches, m, p.result); break;
    }
    case 'settings': {
      const count = Number(p.courts ?? s.courts.length);
      if (!Number.isInteger(count) || count < 1 || count > 8) fail('Choose 1–8 courts.');
      if (s.courts.slice(count).some(c => c.matchId)) fail('Finish or release active games before removing their courts.');
      while (s.courts.length < count) s.courts.push({ id: uid(), name: `Court ${s.courts.length + 1}`, status: 'available', matchId: null });
      s.courts = s.courts.slice(0, count);
      if (p.accent && !/^#[\da-f]{6}$/i.test(p.accent)) fail('Use a six-digit hex color.');
      if (p.openSize && ![2, 4].includes(Number(p.openSize))) fail('Choose singles or doubles.');
      if (Number(p.openSize) === 2 && s.open.some(e => e.playerIds.length > 1)) fail('Remove partner entries before switching to singles.');
      if (p.challengeLimit && (!Number.isInteger(Number(p.challengeLimit)) || p.challengeLimit < 1 || p.challengeLimit > 5)) fail('Choose a win limit of 1–5.');
      for (const key of ['accent', 'matching']) if (p[key]) s.settings[key] = p[key];
      for (const key of ['openSize', 'challengeLimit']) if (p[key]) s.settings[key] = Number(p[key]); break;
    }
    case 'court-status': {
      const c = s.courts.find(c => c.id === p.id); if (!c || c.matchId) fail('Finish or release this court first.');
      if (!['closed', 'available'].includes(p.status)) fail('Invalid court status.'); c.status = p.status; break;
    }
    case 'new-tournament': {
      if (active(s).some(m => m.mode === 'tournament')) fail('Release all tournament courts before starting a new event.');
      if (s.tournament && !p.confirm) fail('Confirm before replacing the active event.');
      if (s.tournament) s.events.push(structuredClone(s.tournament));
      s.tournament = { id: uid(), name: String(p.name || 'Dill Next Cup').slice(0, 80), format: p.format || 'single', division: p.division || 'Open doubles', target: Number(p.target || 11), margin: Number(p.margin || 2), start: p.start || '', end: p.end || '', pools: Number(p.pools || 2), qualify: Number(p.qualify || 2), entrants: [], status: 'registration', qualifiers: [] };
      if (s.tournament.start && s.tournament.end && new Date(s.tournament.end) < new Date(s.tournament.start)) fail('End must be on or after start.'); break;
    }
    case 'register-entrant': {
      const t = s.tournament; if (!t || t.status !== 'registration') fail('Registration is closed.');
      const size = t.division.includes('doubles') ? 2 : 1;
      if (p.playerIds.length !== size || new Set(p.playerIds).size !== size || p.playerIds.some(id => !player(s, id))) fail(`Select ${size} distinct registered player${size > 1 ? 's' : ''}.`);
      if (t.entrants.some(e => e.playerIds.some(id => p.playerIds.includes(id)))) fail('A player is already registered in this tournament.');
      if (t.entrants.length >= 24) fail('The tournament is limited to 24 entrants.');
      t.entrants.push({ id: uid(), name: String(p.name || p.playerIds.map(id => player(s, id).name).join(' & ')).slice(0, 80), playerIds: p.playerIds }); break;
    }
    case 'remove-entrant': if (s.tournament?.status !== 'registration') fail('Registration is closed.'); s.tournament.entrants = s.tournament.entrants.filter(e => e.id !== p.id); break;
    case 'generate-tournament': if (s.tournament?.status !== 'registration') fail('Create a tournament first.'); s.matches.push(...generateTournament(s.tournament)); s.tournament.status = 'active'; break;
    case 'assign-match': if (m.status !== 'ready') fail('This match is not ready.'); assign(s, m, p.courtId); break;
    case 'mixer-add': if (!player(s, p.playerId)) fail('Choose a player.'); if (s.mixer.some(e => e.playerId === p.playerId)) fail('Player is already in the mixer.'); s.mixer.push({ playerId: p.playerId, paused: false, lastSat: 0 }); break;
    case 'mixer-pause': if (busyPlayers(s).has(p.playerId)) fail('Wait until this game finishes.'); { const e = s.mixer.find(e => e.playerId === p.playerId); if (!e) fail('Player not found.'); e.paused = !e.paused; } break;
    case 'mixer-round': {
      if (active(s).some(m => m.mode === 'mixer')) fail('Finish the current mixer round first.');
      const free = s.courts.filter(c => c.status === 'available'), busy = busyPlayers(s);
      const stats = mixerStandings(s);
      const available = s.mixer.filter(e => !e.paused && !busy.has(e.playerId)).sort((a, b) => stats.find(p => p.id === a.playerId).games - stats.find(p => p.id === b.playerId).games || b.lastSat - a.lastSat || a.playerId.localeCompare(b.playerId));
      const count = Math.min(free.length, Math.floor(available.length / 4)); if (!count) fail('Need four eligible players and a free court.');
      s.round++; const selected = available.slice(0, count * 4);
      available.slice(count * 4).forEach(e => e.lastSat = s.round);
      const repeats = (a, b) => s.matches.filter(m => m.mode === 'mixer' && m.sides.some(side => side.playerIds.includes(a) && side.playerIds.includes(b))).length;
      for (let i = 0; i < count; i++) {
        const four = selected.slice(i * 4, i * 4 + 4).map(e => e.playerId);
        const combos = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
        combos.sort((a,b) => a.reduce((n,pair) => n + repeats(four[pair[0]],four[pair[1]]),0) - b.reduce((n,pair) => n + repeats(four[pair[0]],four[pair[1]]),0));
        newGame(s, 'mixer', combos[0].map(pair => entrySide(s, pair.map(j => ({ id: four[j], playerIds: [four[j]] })))), free[i].id, { round: s.round });
      }
      break;
    }
    case 'challenge-start': {
      const queue = eligible(s, 'challenge'); if (queue.length < 2) fail('Two eligible pairs are needed.');
      newGame(s, 'challenge', queue.slice(0, 2).map(e => structuredClone(e)), p.courtId);
      queue.slice(0, 2).forEach(e => e.status = 'playing'); break;
    }
    case 'clean-demo': {
      const ids = new Set(s.players.filter(p => p.demo).map(p => p.id));
      if (active(s).some(m => m.sides.some(side => side.playerIds.some(id => ids.has(id))))) fail('Release active demo games first.');
      if (s.tournament?.entrants.some(e => e.playerIds.some(id => ids.has(id)))) { s.events.push(s.tournament); s.tournament = null; }
      s.players = s.players.filter(p => !p.demo); s.open = s.open.filter(e => !e.playerIds.some(id => ids.has(id))); s.challenge = s.challenge.filter(e => !e.playerIds.some(id => ids.has(id))); s.mixer = s.mixer.filter(e => !ids.has(e.playerId));
      s.matches = s.matches.filter(m => !m.sides.some(side => side?.playerIds.some(id => ids.has(id))));
      s.events = s.events.filter(t => !t.entrants.some(e => e.playerIds.some(id => ids.has(id)))); break;
    }
    default: fail('Unknown operation.');
  }
  validateState(s); return s;
}
export function validateState(s) {
  const ids = s.players.map(p => p.id); if (new Set(ids).size !== ids.length) fail('Duplicate player identity.');
  const occupied = new Set(), participants = new Set();
  for (const m of active(s)) {
    if (occupied.has(m.courtId)) fail('Court already booked.'); occupied.add(m.courtId);
    const c = s.courts.find(c => c.id === m.courtId); if (!c || c.matchId !== m.id || ['closed','available'].includes(c.status)) fail('Court assignment is inconsistent.');
    for (const id of m.sides.flatMap(side => side.playerIds)) { if (participants.has(id)) fail('Player is already on a court.'); participants.add(id); }
  }
  return true;
}

import { emptyState, dispatch } from './engine.js';
export function demoState() {
  let s = emptyState(); s.session.title = 'Saturday on court';
  const names = ['Miguel Santos', 'Sofia Reyes', 'Paolo Cruz', 'Isabella Lim', 'Diego Garcia', 'Camille Tan', 'Marco Ramos', 'Andrea Flores', 'Luis Mendoza', 'Bea Navarro', 'Rafael Torres', 'Nina Castillo', 'Javi Aquino', 'Chloe Villanueva', 'Enzo Bautista', 'Mia Dela Cruz', 'Anton Rivera', 'Ella Lopez', 'Gab Santos', 'Sam Ong', 'Nico Yap', 'Kate Go', 'Leo Chua', 'Alex Sy'];
  for (let i = 0; i < names.length; i++) s = dispatch(s, 'add-player', { name: names[i], skill: ['Intermediate', 'Advanced', 'Beginner'][i % 3], demo: true });
  for (let i = 0; i < 16; i++) s = dispatch(s, 'join', { mode: 'open', playerIds: [s.players[i].id] });
  s.open.forEach((e, i) => e.arrived = Date.now() - (35 - i) * 60000);
  s = dispatch(s, 'call-next', {});
  s = dispatch(s, 'start-score', { matchId: s.matches[0].id });
  for (let i = 0; i < 7; i++) s = dispatch(s, 'rally', { matchId: s.matches[0].id, side: 0 });
  s = dispatch(s, 'rally', { matchId: s.matches[0].id, side: 1 });
  for (let i = 0; i < 5; i++) s = dispatch(s, 'rally', { matchId: s.matches[0].id, side: 1 });
  s.matches[0].started = new Date(Date.now() - 12 * 60000).toISOString();
  s = dispatch(s, 'call-next', {});
  s.open.filter(e => e.status === 'called').slice(0, 2).forEach(e => e.readyIds = [...e.playerIds]);
  for (const p of s.players.slice(8)) s = dispatch(s, 'mixer-add', { playerId: p.id });
  for (let i = 16; i < 24; i += 2) s = dispatch(s, 'join', { mode: 'challenge', name: ['Kitchen Kings','Dink Dynasty','Net Set','Court Crew'][(i - 16) / 2], playerIds: s.players.slice(i,i+2).map(p=>p.id) });
  s = dispatch(s, 'new-tournament', { name: 'Dill Next Weekend Cup', format: 'playoffs', division: 'Open doubles', pools: 2, qualify: 2 });
  for (let i = 0; i < 12; i += 2) s = dispatch(s, 'register-entrant', { name: ['The Dinkers','Green Aces','Baseline Club','Kitchen Crew','Match Point','Third Shot'] [i / 2], playerIds: s.players.slice(i, i + 2).map(p => p.id) });
  s = dispatch(s, 'generate-tournament');
  return s;
}

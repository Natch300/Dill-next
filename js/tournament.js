import { validResult } from './scoring.js';
export const formats = { single: 'Single Elimination', double: 'Double Elimination', round: 'Round Robin', pool: 'Pool Play', playoffs: 'Pool Play + Playoffs' };
export const divisions = ['Open singles', 'Men’s singles', 'Women’s singles', 'Open doubles', 'Men’s doubles', 'Women’s doubles', 'Mixed doubles'];
export const uid = () => crypto.randomUUID();
const nextPower = n => 2 ** Math.ceil(Math.log2(n));
const ref = (m, outcome = 'winner') => ({ match: m.id, outcome });
const direct = entrant => ({ entrant: entrant?.id ?? null });

function game(t, label, round, section, sources, pool = null) {
  return { id: uid(), eventId: t.id, mode: 'tournament', label, round, section, pool, sources,
    sides: [null, null], status: 'waiting', courtId: null, result: null, scoring: null, winner: null, loser: null, started: null };
}

function elimination(t, entrants, section = 'Winners', prefix = 'W') {
  const count = nextPower(entrants.length), rounds = [];
  // Give registration-order seeds the available byes before pairing remaining seeds.
  const byes = count - entrants.length, first = [];
  let cursor = byes;
  for (let i = 0; i < count / 2; i++) {
    const a = i < byes ? entrants[i] : entrants[cursor++];
    const b = i < byes ? null : entrants[cursor++];
    first.push(game(t, `${prefix}1.${i + 1}`, 1, section, [direct(a), direct(b)]));
  }
  rounds.push(first);
  for (let r = 2; r <= Math.log2(count); r++) {
    const prev = rounds.at(-1), next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(game(t, `${prefix}${r}.${i / 2 + 1}`, r, section, [ref(prev[i]), ref(prev[i + 1])]));
    rounds.push(next);
  }
  return rounds;
}

export function generateTournament(t) {
  const entrants = t.entrants;
  if (entrants.length < 2 || entrants.length > 24) throw new Error('Register between 2 and 24 entrants.');
  if (!formats[t.format]) throw new Error('Choose a tournament format.');
  if (![11, 15, 21].includes(t.target) || !Number.isInteger(t.margin) || t.margin < 1 || t.margin > 5) throw new Error('Check the game target and win margin.');
  if (t.end && t.start && new Date(t.end) < new Date(t.start)) throw new Error('End must be on or after start.');
  const ids = entrants.flatMap(e => e.playerIds);
  if (new Set(ids).size !== ids.length) throw new Error('Each player can register only once.');
  const size = t.division.includes('doubles') ? 2 : 1;
  if (entrants.some(e => e.playerIds.length !== size)) throw new Error(`Each entrant needs ${size} distinct player${size > 1 ? 's' : ''}.`);
  let matches = [];
  if (['round', 'pool', 'playoffs'].includes(t.format)) {
    const count = t.format === 'round' ? 1 : t.pools;
    if (count > 1 && (count < 2 || count > 6 || entrants.length < count * 3)) throw new Error('Use 2–6 pools with at least 3 entrants per pool.');
    if (t.format === 'playoffs' && (!Number.isInteger(t.qualify) || t.qualify < 1 || t.qualify > 3 || Math.floor(entrants.length / count) < t.qualify)) throw new Error('Choose 1–3 qualifiers, no more than the smallest pool.');
    const groups = Array.from({ length: count }, () => []);
    // Snake seeding balances registration seeds across pools.
    entrants.forEach((e, i) => { const batch = Math.floor(i / count); groups[batch % 2 ? count - 1 - i % count : i % count].push(e); });
    groups.forEach((group, pi) => {
      group.forEach(e => { e.pool = String.fromCharCode(65 + pi); });
      const wheel = [...group]; if (wheel.length % 2) wheel.push(null);
      for (let r = 1; r < wheel.length; r++) {
        for (let i = 0; i < wheel.length / 2; i++) {
          const a = wheel[i], b = wheel[wheel.length - 1 - i];
          if (a && b) matches.push(game(t, `${count === 1 ? 'R' : String.fromCharCode(65 + pi)}${r}.${i + 1}`, r, 'Pool play', [direct(a), direct(b)], String.fromCharCode(65 + pi)));
        }
        wheel.splice(1, 0, wheel.pop());
      }
    });
  } else {
    const winners = elimination(t, entrants);
    matches = winners.flat();
    if (t.format === 'double') {
      let lower = [];
      if (winners.length > 1) {
        for (let i = 0; i < winners[0].length; i += 2) lower.push(game(t, `L1.${i / 2 + 1}`, 1, 'Lower', [ref(winners[0][i], 'loser'), ref(winners[0][i + 1], 'loser')]));
        matches.push(...lower);
        for (let k = 1; k < winners.length; k++) {
          const wr = winners[k];
          lower = lower.map((m, i) => game(t, `L${2 * k}.${i + 1}`, 2 * k, 'Lower', [ref(m), ref(wr[wr.length - 1 - i], 'loser')]));
          matches.push(...lower);
          if (k < winners.length - 1) {
            const reduced = [];
            for (let i = 0; i < lower.length; i += 2) reduced.push(game(t, `L${2 * k + 1}.${i / 2 + 1}`, 2 * k + 1, 'Lower', [ref(lower[i]), ref(lower[i + 1])]));
            lower = reduced; matches.push(...lower);
          }
        }
      }
      const wf = winners.at(-1)[0];
      const gf = game(t, 'F1.1', 1, 'Finals', [ref(wf), lower.length ? ref(lower[0]) : ref(wf, 'loser')]);
      const reset = game(t, 'F2.1', 2, 'Finals', [ref(gf), ref(gf, 'loser')]);
      reset.resetOf = gf.id;
      matches.push(gf, reset);
    }
  }
  resolveMatches(t, matches);
  return matches;
}

export function resolveMatches(t, matches) {
  const entries = new Map(t.entrants.map(e => [e.id, e]));
  for (let pass = 0; pass <= matches.length; pass++) {
    let changed = false;
    for (const m of matches.filter(m => m.eventId === t.id)) {
      if (['final', 'assigned', 'playing'].includes(m.status)) continue;
      if (m.resetOf) {
        const gf = matches.find(g => g.id === m.resetOf);
        if (gf.status !== 'final') { m.status = 'waiting'; continue; }
        if (gf.winner === gf.sides[0]?.id) { m.status = 'void'; continue; }
      }
      const resolved = m.sources.map(s => {
        if ('entrant' in s) return { known: true, id: s.entrant };
        const prev = matches.find(g => g.id === s.match);
        return { known: !!prev && ['final', 'bye'].includes(prev.status), id: prev?.[s.outcome] ?? null };
      });
      m.sides = resolved.map(s => s.id ? structuredClone(entries.get(s.id)) : null);
      const before = m.status;
      if (resolved.every(s => s.known)) {
        if (m.sides.every(Boolean)) { m.status = 'ready'; m.winner = null; m.loser = null; }
        else { m.status = 'bye'; m.winner = m.sides.find(Boolean)?.id ?? null; m.loser = null; }
      } else { m.status = 'waiting'; m.winner = null; m.loser = null; }
      if (before !== m.status) changed = true;
    }
    if (!changed) break;
  }
}

export function standings(t, matches, pool = null) {
  const rows = t.entrants.filter(e => !pool || e.pool === pool).map((e, seed) => ({ ...e, seed: t.entrants.indexOf(e), played: 0, wins: 0, losses: 0, pf: 0, pa: 0 }));
  for (const m of matches.filter(m => m.eventId === t.id && m.status === 'final' && m.section === 'Pool play')) {
    m.sides.forEach((e, i) => { const r = rows.find(r => r.id === e.id); if (r) { r.played++; r.wins += m.winner === e.id ? 1 : 0; r.losses += m.winner === e.id ? 0 : 1; r.pf += m.result[i]; r.pa += m.result[1 - i]; } });
  }
  rows.forEach(r => { r.diff = r.pf - r.pa; });
  return rows.sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.pf - a.pf || a.seed - b.seed);
}

export function seedPlayoffs(t, matches) {
  if (matches.some(m => m.eventId === t.id && m.section === 'Playoffs')) return [];
  const poolGames = matches.filter(m => m.eventId === t.id && m.section === 'Pool play');
  if (!poolGames.length || poolGames.some(m => m.status !== 'final')) return [];
  const qualified = [...new Set(t.entrants.map(e => e.pool))].flatMap(pool => standings(t, matches, pool).slice(0, t.qualify).map((e, i) => ({ ...e, finish: i + 1 })));
  qualified.sort((a, b) => a.finish - b.finish || b.wins / b.played - a.wins / a.played || b.diff / b.played - a.diff / a.played || b.pf / b.played - a.pf / a.played || a.seed - b.seed);
  t.qualifiers = qualified.map((e, i) => ({ id: e.id, pool: e.pool, finish: e.finish, seed: i + 1 }));
  const generated = elimination(t, qualified, 'Playoffs', 'P').flat();
  resolveMatches(t, [...matches, ...generated]);
  return generated;
}

export function descendants(matchId, matches) {
  const ids = new Set([matchId]);
  let changed = true;
  while (changed) { changed = false; for (const m of matches) if (!ids.has(m.id) && m.sources?.some(s => ids.has(s.match))) { ids.add(m.id); changed = true; } }
  ids.delete(matchId); return matches.filter(m => ids.has(m.id));
}

export function correctTournament(t, matches, m, result) {
  const downstream = descendants(m.id, matches);
  if (m.section === 'Pool play') downstream.push(...matches.filter(g => g.eventId === t.id && g.section === 'Playoffs'));
  if (downstream.some(g => g.courtId || g.status === 'final')) throw new Error('Release downstream courts and clear affected later results before correcting this match.');
  if (result && !validResult(...result, t.target, t.margin)) throw new Error(`Enter a valid final score: to ${t.target}, win by ${t.margin}.`);
  if (m.section === 'Pool play') {
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i].eventId === t.id && matches[i].section === 'Playoffs') matches.splice(i, 1);
    t.qualifiers = [];
  }
  for (const g of downstream) { g.status = 'waiting'; g.winner = null; g.loser = null; }
  m.result = result; m.scoring = null;
  m.status = result ? 'final' : 'ready';
  m.winner = result ? m.sides[result[0] > result[1] ? 0 : 1].id : null;
  m.loser = result ? m.sides[result[0] > result[1] ? 1 : 0].id : null;
  resolveMatches(t, matches);
  if (t.format === 'playoffs') matches.push(...seedPlayoffs(t, matches));
}

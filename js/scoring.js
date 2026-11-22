export function validResult(a, b, target = 11, margin = 2) {
  return [a, b, target, margin].every(Number.isInteger) && a >= 0 && b >= 0 &&
    target > 0 && margin > 0 && Math.max(a, b) >= target && Math.abs(a - b) >= margin &&
    (Math.max(a, b) === target || Math.abs(a - b) === margin);
}

export function startScore({ doubles = true, serving = 0, right = [0, 0], target = 11, margin = 2 } = {}) {
  return { points: [0, 0], serving, server: doubles ? 2 : 1, serverIndex: doubles ? right[serving] : 0,
    right: [...right], doubles, target, margin, winner: null, history: [] };
}

export function rally(previous, winningSide) {
  if (![0, 1].includes(winningSide)) throw new Error('Choose the side that won the rally.');
  if (previous.winner !== null) throw new Error('The game is complete. Save the result or undo the last rally.');
  const s = structuredClone(previous);
  const { history, ...snapshot } = structuredClone(previous);
  s.history.push(snapshot);
  if (winningSide === s.serving) {
    s.points[winningSide]++;
  } else if (s.doubles && s.server === 1) {
    s.server = 2;
    s.serverIndex = 1 - s.serverIndex;
  } else {
    s.serving = 1 - s.serving;
    s.server = 1;
    s.serverIndex = s.doubles ? s.right[s.serving] ^ (s.points[s.serving] % 2) : 0;
  }
  if (Math.max(...s.points) >= s.target && Math.abs(s.points[0] - s.points[1]) >= s.margin)
    s.winner = s.points[0] > s.points[1] ? 0 : 1;
  return s;
}

export function undo(s) {
  if (!s.history.length) throw new Error('There are no rallies to undo.');
  const history = structuredClone(s.history);
  return { ...history.pop(), history };
}

export function scoreCall(s) {
  return [s.points[s.serving], s.points[1 - s.serving], ...(s.doubles ? [s.server] : [])].join('–');
}

export function serviceCourt(s) {
  if (!s.doubles) return s.points[s.serving] % 2 ? 'Left' : 'Right';
  return s.serverIndex === (s.right[s.serving] ^ (s.points[s.serving] % 2)) ? 'Right' : 'Left';
}

export function gamePoint(s) {
  const p = [...s.points]; p[s.serving]++;
  return s.winner === null && Math.max(...p) >= s.target && Math.abs(p[0] - p[1]) >= s.margin;
}

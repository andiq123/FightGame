// X-sorted alive lists — O(N log N) build, O(local) neighbor scans for TD (N≈32).
export function aliveByX(creeps, buf = []) {
  buf.length = 0;
  for (const c of creeps) if (c.hp > 0) buf.push(c);
  buf.sort((a, b) => a.x - b.x);
  return buf;
}

export function eachNear(sorted, x, r, fn) {
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].x < x - r) continue;
    for (let j = i; j < sorted.length; j++) {
      if (sorted[j].x > x + r) return;
      fn(sorted[j]);
    }
    return;
  }
}

export function eachXPair(sorted, maxDx, fn) {
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].x - sorted[i].x > maxDx) break;
      fn(sorted[i], sorted[j]);
    }
  }
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('spatial.js')) {
  const cs = [{ x: 0, hp: 1 }, { x: 50, hp: 1 }, { x: 200, hp: 1 }];
  let n = 0;
  eachNear(aliveByX(cs), 50, 60, () => n++);
  console.assert(n === 2, 'eachNear window');
  console.log('spatial ok');
}

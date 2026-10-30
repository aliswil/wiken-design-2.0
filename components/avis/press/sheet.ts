// Position-based paper: Verlet with small fixed substeps, inextensible links
// and a quadratic bending energy. Units: page width = 1, y runs down the page.

const H = 1 / 240;
const MAX_SUBSTEPS = 24;
const GRAVITY = 8;
const KEEP_NORMAL = Math.exp(-7 * H);
const KEEP_TANGENT = Math.exp(-0.5 * H);
const FRICTION = 0.02;
const HAND_PULL = 0.22;
const HAND_STEP = 0.012;
const HAND_SPRING = 220;
const HAND_DAMP = 30;
const HAND_TURN = 2.8;
const HAND_DRIFT = 0.004;
const HAND_SIGMA_ACROSS = 0.12;
const HAND_SIGMA_ALONG = 0.32;
const FLEX_ACROSS = 0.15;
const FLEX_ALONG = 0.14;
const FLEX_FOLD = 0.003;
const FLEX_FOLD_HELD = 0.02;
const FLEX2_ACROSS = 0.05;
const FLEX2_ALONG = 0.08;
const FLEX2_FOLD = 0.0005;
const PASSES = 4;
const MIN_GRIP = 0.45;
const PLANK = 0.4;
const PLANK_PULL = 0.5;
const LAND_BY = 2.5;
const BLEND = 0.12;
const LET_GO_AT = 0.85;

export type Side = 1 | -1;

export interface Sheet {
  readonly cols: number;
  readonly rows: number;
  /** x, y, z per vertex. */
  readonly pos: Float32Array;
  readonly nrm: Float32Array;
  /** How far the ink has come loose, 0..1. Exactly 0 once the sheet has landed. */
  readonly loose: Float32Array;
  /** The side the sheet is heading for. */
  land: Side;
  lay(side: Side): void;
  /** Stands a resting sheet up around the hinge, at this angle. */
  stand(angle: number): void;
  grip(u: number, v: number): void;
  /** Hand position from the cosine of the arc angle. Holds until released. */
  pull(cos: number, dy: number): void;
  /** Sweeps the hand to `side` and lets go on the way down. */
  swing(side: Side, seconds: number): void;
  /** Hand held at a small angle off the sheet's side. */
  lift(angle: number): void;
  letGo(): void;
  /** Mean x of the outer edge: 1 on the right, -1 on the left. */
  edge(): number;
  /** Advances by dt seconds. False once nothing moves: at rest, or held still. */
  tick(dt: number): boolean;
  readonly resting: boolean;
  /** A hand is on the sheet. */
  readonly held: boolean;
  /** Distance from the hinge to the grip. */
  readonly radius: number;
  /** Row of the grip, 0..1. */
  readonly gripV: number;
}

const smoother = (t: number) => t * t * (3 - 2 * t);

export function createSheet(cols: number, rows: number, aspect: number): Sheet {
  const count = cols * rows;
  const pos = new Float32Array(count * 3);
  const old = new Float32Array(count * 3);
  const from = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const loose = new Float32Array(count);
  const mid = (rows - 1) >> 1;
  const plankCols = Math.round(PLANK * cols);
  const dv = aspect / (rows - 1);
  const du = 1 / (cols - 1);

  const links: number[] = [];
  const link = (a: number, b: number, k: number, scale = 1) => {
    const ca = a % cols;
    const cb = b % cols;
    if (ca === 0 && cb === 0) return;
    const ra = (a - ca) / cols;
    const rb = (b - cb) / cols;
    links.push(a, b, k, Math.hypot((ca - cb) * du, (ra - rb) * dv) * scale);
  };
  const crossing = (r0: number, r1: number) => r0 < mid && r1 > mid;
  const at = (c: number, r: number) => r * cols + c;
  for (let c = 0; c + 1 < cols; c++) {
    for (let r = 0; r + 1 < rows; r++) {
      link(at(c, r), at(c + 1, r + 1), 0.7);
      link(at(c, r + 1), at(c + 1, r), 0.7);
    }
  }
  const tight = links.length / 4;
  // Spans only push apart: a two-way span would stretch the links under any curve.
  for (const [span, floor] of [[2, 0.72], [5, 0.45]]) {
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (c + span < cols) link(at(c, r), at(c + span, r), 0.25, floor);
        if (r + span < rows) {
          const fold = crossing(r, r + span);
          link(at(c, r), at(c, r + span), fold ? 0.02 : 0.4, fold ? 0.995 * floor : floor);
        }
      }
    }
  }
  const linkA = Uint16Array.from({ length: links.length / 4 }, (_, i) => links[i * 4]);
  const linkB = Uint16Array.from({ length: links.length / 4 }, (_, i) => links[i * 4 + 1]);
  const linkK = Float32Array.from({ length: links.length / 4 }, (_, i) => links[i * 4 + 2]);
  const linkL = Float32Array.from({ length: links.length / 4 }, (_, i) => links[i * 4 + 3]);
  // Inverse mass: 0 on the hinge, small under the hand so links pull the rest along.
  const inv = new Float32Array(count);
  const longest = Math.max(cols, rows);
  const dirX = new Float64Array(longest);
  const dirY = new Float64Array(longest);
  const dirZ = new Float64Array(longest);
  const rhs = new Float64Array(longest);
  const diag = new Float64Array(longest);
  const off = new Float64Array(longest);

  const handIdx: number[] = [];
  const handW: number[] = [];
  let handOn = false;
  let handAt = 0;
  let radius = 1;
  let baseY = 0;
  let curX = 0;
  let curY = 0;
  let curZ = 0;
  let angle = 0;
  let goalAngle = 0;
  let spin = 0;
  let goalDy = 0;
  let nowDy = 0;
  let sweeping = false;
  let sweepFrom = 0;
  let sweepTo = 0;
  let sweepTime = 1;
  let sweepAt = 0;
  let clock = 0;
  let acc = 0;
  let steps = 0;
  let speed = 0;
  let top = 0;
  let blendAt = -1;
  let resting = true;
  let gripRow = 0;

  const flex = (i: number, s: number, e: number) => {
    const a = i - s;
    const c = i + s;
    const wa = a % cols === 0 ? 0 : e;
    const wi = i % cols === 0 ? 0 : e * 2;
    const wc = e;
    for (let k = 0; k < 3; k++) {
      const pa = a * 3 + k;
      const pi = i * 3 + k;
      const pc = c * 3 + k;
      const d = pos[pa] - 2 * pos[pi] + pos[pc];
      pos[pa] -= wa * d;
      pos[pi] += wi * d;
      pos[pc] -= wc * d;
    }
  };

  const flexAll = (span: number, across: number, along: number, fold: number) => {
    for (let r = 0; r < rows; r++) {
      for (let c = span; c + span < cols; c++) flex(r * cols + c, span, across);
    }
    for (let r = span; r + span < rows; r++) {
      const e = Math.abs(r - mid) < span ? fold : along;
      for (let c = 1; c < cols; c++) flex(r * cols + c, span * cols, e);
    }
  };

  const normals = () => {
    for (let r = 0; r < rows; r++) {
      const r0 = (r > 0 ? r - 1 : r) * cols;
      const r1 = (r + 1 < rows ? r + 1 : r) * cols;
      for (let c = 0; c < cols; c++) {
        const c0 = (r * cols + (c > 0 ? c - 1 : c)) * 3;
        const c1 = (r * cols + (c + 1 < cols ? c + 1 : c)) * 3;
        const a0 = (r0 + c) * 3;
        const a1 = (r1 + c) * 3;
        const ux = pos[c1] - pos[c0];
        const uy = pos[c1 + 1] - pos[c0 + 1];
        const uz = pos[c1 + 2] - pos[c0 + 2];
        const vx = pos[a1] - pos[a0];
        const vy = pos[a1 + 1] - pos[a0 + 1];
        const vz = pos[a1 + 2] - pos[a0 + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        const n = (r * cols + c) * 3;
        nrm[n] = nx / len;
        nrm[n + 1] = ny / len;
        nrm[n + 2] = nz / len;
      }
    }
  };

  const release = () => {
    handOn = sweeping = false;
    for (let i = 0; i < count; i++) inv[i] = i % cols === 0 ? 0 : 1;
  };

  const moveHand = () => {
    if (sweeping) {
      sweepAt += H;
      const e = smoother(Math.min(sweepAt / sweepTime, 1));
      angle = sweepFrom + (sweepTo - sweepFrom) * e;
      if (e >= LET_GO_AT) {
        release();
        return;
      }
    } else {
      spin += ((goalAngle - angle) * HAND_SPRING - spin * HAND_DAMP) * H;
      spin = Math.min(Math.max(spin, -HAND_TURN), HAND_TURN);
      angle += spin * H;
      nowDy += Math.min(Math.max((goalDy - nowDy) * 0.04, -HAND_DRIFT), HAND_DRIFT);
    }
    const tx = radius * Math.cos(angle);
    const tz = 0.85 * radius * Math.sin(angle);
    const ty = baseY + nowDy;
    const ease = sweeping ? 0.5 : 0.1;
    curX += (tx - curX) * ease;
    curY += (ty - curY) * ease;
    curZ += (tz - curZ) * ease;
    const g = handAt * 3;
    const reach = Math.hypot(curX - pos[g], curY - pos[g + 1], curZ - pos[g + 2]);
    const pull = reach > 0 ? Math.min(HAND_PULL, HAND_STEP / reach) : 0;
    const dx = (curX - pos[g]) * pull;
    const dy = (curY - pos[g + 1]) * pull;
    const dz = (curZ - pos[g + 2]) * pull;
    for (let j = 0; j < handIdx.length; j++) {
      const p = handIdx[j] * 3;
      const w = handW[j];
      pos[p] += dx * w;
      pos[p + 1] += dy * w;
      pos[p + 2] += dz * w;
    }
  };

  const solve = (first: number, end: number, by: number, pushOnly: boolean) => {
    for (let j = first; j !== end; j += by) {
      const ia = linkA[j];
      const ib = linkB[j];
      const a = ia * 3;
      const b = ib * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const sum = inv[ia] + inv[ib];
      if (len < 1e-7 || sum === 0 || (pushOnly && len >= linkL[j])) continue;
      const s = (linkK[j] * (len - linkL[j])) / (len * sum);
      const sa = s * inv[ia];
      const sb = s * inv[ib];
      pos[a] += dx * sa;
      pos[a + 1] += dy * sa;
      pos[a + 2] += dz * sa;
      pos[b] -= dx * sb;
      pos[b + 1] -= dy * sb;
      pos[b + 2] -= dz * sb;
    }
  };

  // Solves a whole row or column of links at once, so that a pull reaches the far
  // end within one substep: paper doesn't stretch, however long the chain.
  const chain = (first: number, stride: number, n: number, rest: number) => {
    const m = n - 1;
    for (let j = 0; j < m; j++) {
      const a = (first + j * stride) * 3;
      const b = a + stride * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-7;
      dirX[j] = dx / len;
      dirY[j] = dy / len;
      dirZ[j] = dz / len;
      rhs[j] = rest - len;
      diag[j] = inv[first + j * stride] + inv[first + (j + 1) * stride];
    }
    // Links folded back on each other are left uncoupled: that system is near singular.
    for (let j = 0; j + 1 < m; j++) {
      off[j] = -inv[first + (j + 1) * stride] * Math.max(dirX[j] * dirX[j + 1] + dirY[j] * dirY[j + 1] + dirZ[j] * dirZ[j + 1], 0);
    }
    for (let j = 1; j < m; j++) {
      const f = off[j - 1] / diag[j - 1];
      diag[j] -= f * off[j - 1];
      rhs[j] -= f * rhs[j - 1];
    }
    rhs[m - 1] /= diag[m - 1];
    for (let j = m - 2; j >= 0; j--) rhs[j] = (rhs[j] - off[j] * rhs[j + 1]) / diag[j];
    for (let j = 0; j < n; j++) {
      const w = inv[first + j * stride];
      if (w === 0) continue;
      const v = (first + j * stride) * 3;
      const now = j < m ? rhs[j] : 0;
      const before = j > 0 ? rhs[j - 1] : 0;
      const k = j > 0 ? j - 1 : 0;
      const l = j < m ? j : 0;
      pos[v] += w * (before * dirX[k] - now * dirX[l]);
      pos[v + 1] += w * (before * dirY[k] - now * dirY[l]);
      pos[v + 2] += w * (before * dirZ[k] - now * dirZ[l]);
    }
  };

  // A straight hinge forces the paper beside it to turn as one, or it would have to stretch.
  const plank = () => {
    for (let c = 1; c <= plankCols; c++) {
      const e = PLANK_PULL * (1 - (c - 1) / plankCols);
      let x = 0;
      let z = 0;
      for (let r = 0; r < rows; r++) {
        x += pos[(r * cols + c) * 3];
        z += pos[(r * cols + c) * 3 + 2];
      }
      x /= rows;
      z /= rows;
      for (let r = 0; r < rows; r++) {
        const p = (r * cols + c) * 3;
        pos[p] += (x - pos[p]) * e;
        pos[p + 2] += (z - pos[p + 2]) * e;
      }
    }
  };

  const substep = () => {
    if (steps++ % 4 === 0) normals();
    speed = 0;
    top = 0;
    const gh2 = GRAVITY * H * H;
    for (let i = 0; i < count; i++) {
      if (i % cols === 0) continue;
      const p = i * 3;
      const vx = pos[p] - old[p];
      const vy = pos[p + 1] - old[p + 1];
      const vz = pos[p + 2] - old[p + 2];
      const vn = vx * nrm[p] + vy * nrm[p + 1] + vz * nrm[p + 2];
      const cut = vn * (KEEP_NORMAL - KEEP_TANGENT);
      old[p] = pos[p];
      old[p + 1] = pos[p + 1];
      old[p + 2] = pos[p + 2];
      pos[p] += vx * KEEP_TANGENT + nrm[p] * cut;
      pos[p + 1] += vy * KEEP_TANGENT + nrm[p + 1] * cut;
      pos[p + 2] += vz * KEEP_TANGENT + nrm[p + 2] * cut - gh2;
    }

    if (handOn) moveHand();

    flexAll(1, FLEX_ACROSS, FLEX_ALONG, handOn ? FLEX_FOLD_HELD : FLEX_FOLD);
    flexAll(2, FLEX2_ACROSS, FLEX2_ALONG, FLEX2_FOLD);
    plank();
    solve(tight, linkA.length, 1, true);
    solve(0, tight, 1, false);
    for (let pass = 0; pass < PASSES; pass++) {
      for (let r = 0; r < rows; r++) chain(r * cols, 1, cols, du);
      for (let c = 1; c < cols; c++) chain(c, cols, rows, dv);
      for (let i = 2; i < count * 3; i += 3) if (pos[i] < 0) pos[i] = 0;
    }

    for (let i = 0; i < count; i++) {
      if (i % cols === 0) continue;
      const p = i * 3;
      if (pos[p + 2] <= 0) {
        pos[p + 2] = 0;
        old[p + 2] = 0;
        pos[p] += (old[p] - pos[p]) * FRICTION;
        pos[p + 1] += (old[p + 1] - pos[p + 1]) * FRICTION;
      }
      const vx = pos[p] - old[p];
      const vy = pos[p + 1] - old[p + 1];
      const vz = pos[p + 2] - old[p + 2];
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz) / H;
      if (v > speed) speed = v;
      if (pos[p + 2] > top) top = pos[p + 2];
      const want = Math.min(Math.max((v - 0.3) / 6, 0), 0.6);
      loose[i] += (want - loose[i]) * 0.03;
    }
  };

  const flat = (i: number, k: number) => {
    const c = i % cols;
    if (k === 0) return sheet.land * c * du;
    if (k === 1) return ((i - c) / cols) * dv;
    return 0;
  };

  const sheet: Sheet = {
    cols,
    rows,
    pos,
    nrm,
    loose,
    land: 1,
    get resting() {
      return resting;
    },
    get held() {
      return handOn;
    },
    get radius() {
      return radius;
    },
    get gripV() {
      return gripRow;
    },
    lay(side) {
      sheet.land = side;
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = flat(i, k);
      }
      old.set(pos);
      loose.fill(0);
      normals();
      release();
      blendAt = -1;
      clock = acc = speed = top = 0;
      resting = true;
    },
    stand(a) {
      if (!resting) return;
      for (let i = 0; i < count; i++) {
        const u = (i % cols) * du;
        pos[i * 3] = u * Math.cos(a);
        pos[i * 3 + 2] = u * Math.sin(a);
      }
      old.set(pos);
      normals();
    },
    grip(u, v) {
      const c = Math.min(Math.max(Math.round(Math.max(u, MIN_GRIP) * (cols - 1)), 1), cols - 1);
      const r = Math.min(Math.max(Math.round(v * (rows - 1)), 0), rows - 1);
      handAt = at(c, r);
      handIdx.length = handW.length = 0;
      for (let i = 0; i < count; i++) {
        const ci = i % cols;
        if (ci === 0) continue;
        inv[i] = 1;
        // A hand holds a stretch of the edge: a single point would pinch the sheet into a beak.
        const across = ((ci - c) * du) / HAND_SIGMA_ACROSS;
        const along = (((i - ci) / cols - r) * dv) / HAND_SIGMA_ALONG;
        const w = Math.exp(-(across * across + along * along) / 2);
        if (w > 0.02) {
          handIdx.push(i);
          handW.push(w);
          inv[i] = 1 - 0.9 * w;
        }
      }
      radius = c * du;
      gripRow = r / (rows - 1);
      baseY = r * dv;
      goalDy = nowDy = spin = 0;
      const g = handAt * 3;
      curX = pos[g];
      curY = pos[g + 1];
      curZ = pos[g + 2];
      angle = goalAngle = Math.atan2(Math.max(curZ, 0) / 0.85, curX);
      handOn = true;
      sweeping = false;
      blendAt = -1;
      resting = false;
    },
    pull(cos, dy) {
      goalAngle = Math.acos(Math.min(Math.max(cos, -1), 1));
      goalDy = dy;
    },
    swing(side, seconds) {
      sheet.land = side;
      sweepFrom = angle;
      sweepTo = side > 0 ? 0 : Math.PI;
      const left = Math.abs(sweepTo - sweepFrom) / Math.PI;
      sweepTime = Math.max(seconds * Math.sqrt(left), 0.3);
      sweepAt = 0;
      sweeping = true;
      clock = 0;
    },
    lift(a) {
      goalAngle = sheet.land > 0 ? a : Math.PI - a;
    },
    letGo() {
      release();
      clock = 0;
    },
    edge() {
      let sum = 0;
      for (let r = 0; r < rows; r++) sum += pos[(r * cols + cols - 1) * 3];
      return sum / rows;
    },
    tick(dt) {
      if (resting) return false;
      if (blendAt >= 0) {
        blendAt += dt;
        const t = Math.min(blendAt / BLEND, 1);
        const e = t * t * (3 - 2 * t);
        for (let i = 0; i < count; i++) {
          for (let k = 0; k < 3; k++) {
            pos[i * 3 + k] = from[i * 3 + k] + (flat(i, k) - from[i * 3 + k]) * e;
          }
          loose[i] *= 1 - t;
        }
        normals();
        if (t === 1) {
          sheet.lay(sheet.land);
          return false;
        }
        return true;
      }
      clock += dt;
      acc = Math.min(acc + dt, MAX_SUBSTEPS * H);
      while (acc >= H) {
        substep();
        acc -= H;
      }
      normals();
      if (sweeping && clock >= LAND_BY - BLEND - 0.02) release();
      if (handOn) {
        const still = !sweeping && speed < 0.004 && Math.abs(goalAngle - angle) < 2e-3;
        return !still;
      }
      if ((speed < 0.08 && top < 0.012) || clock >= LAND_BY - BLEND - 0.02) {
        from.set(pos);
        blendAt = 0;
      }
      return true;
    },
  };
  sheet.lay(1);
  return sheet;
}

export const gridFor = (aspect: number): [number, number] => (aspect > 1.3 ? [20, 29] : [30, 23]);

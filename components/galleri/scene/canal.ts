const SAMPLES = 720;
const PAINTING_SPACING = 5.6;
const MIN_LENGTH = 34;

export interface CanalFrame {
  x: number;
  z: number;
  /** Direction of travel. */
  tx: number;
  tz: number;
  /** Points towards the outer wall. */
  nx: number;
  nz: number;
  width: number;
}

export interface CanalLocation {
  s: number;
  /** Signed distance from the centre line, positive towards the outer wall. */
  d: number;
  halfWidth: number;
}

function outline(theta: number) {
  return 1 + 0.1 * Math.cos(2 * theta + 0.6) + 0.035 * Math.cos(3 * theta - 1.1);
}

/** A closed waterway that bends enough to hide what lies ahead. All distances are in metres. */
export class Canal {
  readonly length: number;
  private readonly xs = new Float32Array(SAMPLES);
  private readonly zs = new Float32Array(SAMPLES);
  private readonly step: number;
  private lastIndex = 0;

  constructor(paintingCount: number) {
    this.length = Math.max(MIN_LENGTH, paintingCount * PAINTING_SPACING);
    this.step = this.length / SAMPLES;
    this.sampleEvenly();
  }

  private sampleEvenly() {
    const fine = 4096;
    const fineX = new Float64Array(fine + 1);
    const fineZ = new Float64Array(fine + 1);
    const arc = new Float64Array(fine + 1);
    for (let i = 0; i <= fine; i++) {
      const theta = (i / fine) * Math.PI * 2;
      const radius = outline(theta);
      fineX[i] = radius * Math.cos(theta);
      fineZ[i] = radius * Math.sin(theta);
      if (i > 0) arc[i] = arc[i - 1] + Math.hypot(fineX[i] - fineX[i - 1], fineZ[i] - fineZ[i - 1]);
    }

    const scale = this.length / arc[fine];
    let cursor = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const target = (i / SAMPLES) * arc[fine];
      while (arc[cursor + 1] < target) cursor++;
      const t = (target - arc[cursor]) / (arc[cursor + 1] - arc[cursor]);
      this.xs[i] = (fineX[cursor] + (fineX[cursor + 1] - fineX[cursor]) * t) * scale;
      this.zs[i] = (fineZ[cursor] + (fineZ[cursor + 1] - fineZ[cursor]) * t) * scale;
    }
  }

  wrap(s: number) {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Shortest signed distance along the water from `from` to `to`. */
  delta(from: number, to: number) {
    const raw = this.wrap(to - from);
    return raw > this.length / 2 ? raw - this.length : raw;
  }

  widthAt(s: number) {
    return 5.3 + 0.5 * Math.sin((s / this.length) * Math.PI * 6 + 1);
  }

  at(s: number): CanalFrame {
    const position = this.wrap(s) / this.step;
    const i0 = Math.floor(position) % SAMPLES;
    const i1 = (i0 + 1) % SAMPLES;
    const t = position - Math.floor(position);
    const before = (i0 - 2 + SAMPLES) % SAMPLES;
    const after = (i0 + 3) % SAMPLES;
    let tx = this.xs[after] - this.xs[before];
    let tz = this.zs[after] - this.zs[before];
    const norm = Math.hypot(tx, tz) || 1;
    tx /= norm;
    tz /= norm;
    return {
      x: this.xs[i0] + (this.xs[i1] - this.xs[i0]) * t,
      z: this.zs[i0] + (this.zs[i1] - this.zs[i0]) * t,
      tx,
      tz,
      nx: tz,
      nz: -tx,
      width: this.widthAt(s),
    };
  }

  /** Point on the wall (`side` 1 is outer, -1 is inner), or `inset` metres out from it onto the water. */
  wallPoint(s: number, side: 1 | -1, inset = 0) {
    const frame = this.at(s);
    const offset = side * (frame.width / 2 - inset);
    return { x: frame.x + frame.nx * offset, z: frame.z + frame.nz * offset, frame };
  }

  /** Nearest place on the centre line. Searches near the last answer unless `exhaustive` is set. */
  locate(x: number, z: number, exhaustive = false): CanalLocation {
    const range = exhaustive ? SAMPLES : 60;
    let best = this.lastIndex;
    let bestDistance = Infinity;
    for (let offset = -range; offset <= range; offset++) {
      const i = (this.lastIndex + offset + SAMPLES * 2) % SAMPLES;
      const dx = x - this.xs[i];
      const dz = z - this.zs[i];
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (!exhaustive) this.lastIndex = best;
    const s = best * this.step;
    const frame = this.at(s);
    return {
      s,
      d: (x - frame.x) * frame.nx + (z - frame.z) * frame.nz,
      halfWidth: frame.width / 2,
    };
  }

  /** Whether a world position is on the water, used to test lines of sight. */
  contains(x: number, z: number) {
    const location = this.locate(x, z, true);
    return Math.abs(location.d) < location.halfWidth;
  }
}

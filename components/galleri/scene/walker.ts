import type { FloorPlan, Point } from './floorPlan';

export const EYE_HEIGHT = 1.62;
const MIN_PITCH = -0.42;
const MAX_PITCH = 0.62;
const CORNER_RADIUS = 0.9;
const CORNER_SAMPLES = 8;

export interface WalkInput {
  /** -1 to 1: backwards to forwards. */
  thrust: number;
  /** -1 to 1: right to left. */
  turn: number;
}

export interface Facing {
  yaw: number;
  pitch: number;
}

interface Pilot {
  xs: number[];
  zs: number[];
  /** Distance from the start of the path to each point. */
  lengths: number[];
  /** Metres left to go. */
  remaining: number;
  speed: number;
  smoothTime: number;
  face: Facing | null;
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function yawTowards(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}

function smoothDamp(current: number, target: number, speedOut: { value: number }, smoothTime: number, dt: number, maxSpeed: number) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = Math.max(-maxChange, Math.min(maxChange, current - target));
  const clampedTarget = current - change;
  const temp = (speedOut.value + omega * change) * dt;
  speedOut.value = (speedOut.value - omega * temp) * decay;
  return clampedTarget + (change + temp) * decay;
}

/** Turns waypoints into an even line, with corners rounded off so the visitor swings through them. */
export function roundedPath(points: Point[]) {
  const xs: number[] = [points[0].x];
  const zs: number[] = [points[0].z];
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1];
    const corner = points[i];
    const after = points[i + 1];
    const inLength = Math.hypot(corner.x - before.x, corner.z - before.z) || 1;
    const outLength = Math.hypot(after.x - corner.x, after.z - corner.z) || 1;
    const radius = Math.min(CORNER_RADIUS, inLength * 0.45, outLength * 0.45);
    const startX = corner.x + ((before.x - corner.x) / inLength) * radius;
    const startZ = corner.z + ((before.z - corner.z) / inLength) * radius;
    const endX = corner.x + ((after.x - corner.x) / outLength) * radius;
    const endZ = corner.z + ((after.z - corner.z) / outLength) * radius;
    for (let sample = 0; sample <= CORNER_SAMPLES; sample++) {
      const t = sample / CORNER_SAMPLES;
      const u = 1 - t;
      xs.push(u * u * startX + 2 * u * t * corner.x + t * t * endX);
      zs.push(u * u * startZ + 2 * u * t * corner.z + t * t * endZ);
    }
  }
  const last = points[points.length - 1];
  xs.push(last.x);
  zs.push(last.z);

  const lengths = [0];
  for (let i = 1; i < xs.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  }
  return { xs, zs, lengths };
}

/** The visitor's position on the path, with a slow, unhurried glide. */
export class Walker {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Metres per second over the last step. */
  speed = 0;
  /** Turning left behind by a drag, in radians per second. */
  yawDrift = 0;
  pitchDrift = 0;

  private vx = 0;
  private vz = 0;
  private pilot: Pilot | null = null;

  constructor(
    private readonly plan: FloorPlan,
    start: Point & Facing,
  ) {
    this.x = start.x;
    this.z = start.z;
    this.yaw = start.yaw;
    this.pitch = start.pitch;
  }

  get moving() {
    return (
      this.pilot !== null ||
      this.speed > 0.01 ||
      Math.abs(this.yawDrift) > 0.003 ||
      Math.abs(this.pitchDrift) > 0.003
    );
  }

  /** Walk through waypoints. With a `face`, the visitor ends up turned that way. */
  follow(points: Point[], face: Facing | null, smoothTime = 1.05) {
    const speed = this.speed;
    this.cancelSteering();
    const path = roundedPath(points);
    this.pilot = {
      ...path,
      remaining: path.lengths[path.lengths.length - 1],
      speed: -speed,
      smoothTime,
      face,
    };
  }

  /** Be there at once, for reduced motion and while the dialog covers the room. */
  placeAt(x: number, z: number, yaw: number, pitch: number) {
    this.cancelSteering();
    this.vx = 0;
    this.vz = 0;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  look(dYaw: number, dPitch: number) {
    this.pilot = null;
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + dPitch));
  }

  push(amount: number) {
    this.cancelSteering();
    this.vx += -Math.sin(this.yaw) * amount;
    this.vz += -Math.cos(this.yaw) * amount;
  }

  cancelSteering() {
    this.pilot = null;
    this.yawDrift = 0;
    this.pitchDrift = 0;
  }

  step(dt: number, input: WalkInput) {
    const beforeX = this.x;
    const beforeZ = this.z;

    if (input.thrust !== 0 || input.turn !== 0) this.pilot = null;

    if (this.pilot) this.stepPilot(dt, this.pilot);
    else this.stepFree(dt, input);

    if (this.yawDrift !== 0 || this.pitchDrift !== 0) {
      this.yaw = wrapAngle(this.yaw + this.yawDrift * dt);
      this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + this.pitchDrift * dt));
      const decay = Math.exp(-dt * 3.2);
      this.yawDrift *= decay;
      this.pitchDrift *= decay;
      if (Math.abs(this.yawDrift) < 0.003) this.yawDrift = 0;
      if (Math.abs(this.pitchDrift) < 0.003) this.pitchDrift = 0;
    }

    this.speed = dt > 0 ? Math.hypot(this.x - beforeX, this.z - beforeZ) / dt : 0;
  }

  private stepFree(dt: number, input: WalkInput) {
    this.yaw = wrapAngle(this.yaw + input.turn * 1.15 * dt);
    if (input.thrust !== 0) {
      this.vx += -Math.sin(this.yaw) * input.thrust * 3.4 * dt;
      this.vz += -Math.cos(this.yaw) * input.thrust * 3.4 * dt;
    }
    const damping = Math.exp(-dt * 1.35);
    this.vx *= damping;
    this.vz *= damping;
    if (Math.hypot(this.vx, this.vz) < 0.008) {
      this.vx = 0;
      this.vz = 0;
      return;
    }

    if (input.thrust !== 0) {
      const pull = this.plan.pathPull(this.x, this.z, this.vx, this.vz);
      this.vx += pull.x * 2.2 * dt;
      this.vz += pull.z * 2.2 * dt;
    }
    this.slide(this.vx * dt, this.vz * dt);
  }

  /** Moves as far as the walls allow, sliding along them rather than stopping dead. */
  private slide(stepX: number, stepZ: number) {
    const { plan } = this;
    if (!plan.isClear(this.x, this.z)) {
      const onPath = plan.nearestClear(this.x, this.z);
      this.x = onPath.x;
      this.z = onPath.z;
    }
    const nextX = this.x + stepX;
    const nextZ = this.z + stepZ;
    if (plan.isClear(nextX, nextZ)) {
      this.x = nextX;
      this.z = nextZ;
    } else if (plan.isClear(nextX, this.z)) {
      this.x = nextX;
      this.vz = 0;
    } else if (plan.isClear(this.x, nextZ)) {
      this.z = nextZ;
      this.vx = 0;
    } else {
      this.vx = 0;
      this.vz = 0;
    }
  }

  private stepPilot(dt: number, pilot: Pilot) {
    const speedOut = { value: pilot.speed };
    pilot.remaining = Math.max(0, smoothDamp(pilot.remaining, 0, speedOut, pilot.smoothTime, dt, 3.4));
    pilot.speed = speedOut.value;

    const total = pilot.lengths[pilot.lengths.length - 1];
    const travelled = total - pilot.remaining;
    let index = 1;
    while (index < pilot.lengths.length - 1 && pilot.lengths[index] < travelled) index++;
    const span = pilot.lengths[index] - pilot.lengths[index - 1] || 1;
    const t = Math.min(1, (travelled - pilot.lengths[index - 1]) / span);
    const dirX = pilot.xs[index] - pilot.xs[index - 1];
    const dirZ = pilot.zs[index] - pilot.zs[index - 1];
    this.x = pilot.xs[index - 1] + dirX * t;
    this.z = pilot.zs[index - 1] + dirZ * t;

    const travelYaw = dirX !== 0 || dirZ !== 0 ? yawTowards(dirX, dirZ) : this.yaw;
    if (pilot.face) {
      const nearness = 1 - Math.min(1, Math.max(0, (pilot.remaining - 0.8) / 3));
      const blend = nearness * nearness * (3 - 2 * nearness);
      const yawTarget = wrapAngle(travelYaw + wrapAngle(pilot.face.yaw - travelYaw) * blend);
      this.yaw = wrapAngle(this.yaw + wrapAngle(yawTarget - this.yaw) * (1 - Math.exp(-dt * 2.6)));
      this.pitch += (pilot.face.pitch * blend + 0.06 * (1 - blend) - this.pitch) * (1 - Math.exp(-dt * 2.2));
    } else if (pilot.remaining > 0.4) {
      const ease = (1 - Math.exp(-dt * 1.1)) * Math.min(1, Math.abs(pilot.speed) / 1.2);
      this.yaw = wrapAngle(this.yaw + wrapAngle(travelYaw - this.yaw) * ease);
    }

    const stopped = pilot.remaining < 0.008 && Math.abs(pilot.speed) < 0.02;
    const turned =
      !pilot.face ||
      (Math.abs(wrapAngle(pilot.face.yaw - this.yaw)) < 0.004 && Math.abs(pilot.face.pitch - this.pitch) < 0.004);
    if (stopped && turned) this.pilot = null;
  }
}

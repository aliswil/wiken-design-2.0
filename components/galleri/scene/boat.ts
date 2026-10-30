import type { Canal } from './canal';

export const EYE_HEIGHT = 1.12;
export const WALL_MARGIN = 1;
const MIN_PITCH = -0.42;
const MAX_PITCH = 0.62;

export interface BoatInput {
  /** -1 to 1: backwards to forwards. */
  thrust: number;
  /** -1 to 1: right to left. */
  turn: number;
}

interface Autopilot {
  remaining: number;
  lateral: number;
  faceYaw: number;
  facePitch: number;
  speed: number;
  lateralSpeed: number;
  smoothTime: number;
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

/** The visitor's position on the water, with the inertia of something that floats. */
export class Boat {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Metres per second over the last step. */
  speed = 0;
  /** Heading the current drag left behind, in radians per second. */
  yawDrift = 0;
  pitchDrift = 0;

  private vx = 0;
  private vz = 0;
  private seekX: number | null = null;
  private seekZ = 0;
  private readonly seekVx = { value: 0 };
  private readonly seekVz = { value: 0 };
  private autopilot: Autopilot | null = null;
  private s = 0;
  private d = 0;

  constructor(
    private readonly canal: Canal,
    start: { s: number; d: number; yaw: number; pitch: number },
  ) {
    const frame = canal.at(start.s);
    this.x = frame.x + frame.nx * start.d;
    this.z = frame.z + frame.nz * start.d;
    this.yaw = start.yaw;
    this.pitch = start.pitch;
    const location = canal.locate(this.x, this.z, true);
    canal.locate(this.x, this.z);
    this.s = location.s;
    this.d = location.d;
  }

  get position() {
    return { s: this.s, d: this.d };
  }

  get moving() {
    return (
      this.autopilot !== null ||
      this.seekX !== null ||
      this.speed > 0.01 ||
      Math.abs(this.yawDrift) > 0.003 ||
      Math.abs(this.pitchDrift) > 0.003
    );
  }

  /** Glide along the water to a place, then turn to face the given direction. */
  sailTo(s: number, lateral: number, faceYaw: number, facePitch: number, smoothTime = 1.05) {
    this.cancelSteering();
    this.autopilot = {
      remaining: this.canal.delta(this.s, s),
      lateral,
      faceYaw,
      facePitch,
      speed: 0,
      lateralSpeed: 0,
      smoothTime,
    };
  }

  /** Be there at once, for reduced motion and while the dialog covers the room. */
  placeAt(s: number, lateral: number, yaw: number, pitch: number) {
    this.cancelSteering();
    const frame = this.canal.at(s);
    this.x = frame.x + frame.nx * lateral;
    this.z = frame.z + frame.nz * lateral;
    this.yaw = yaw;
    this.pitch = pitch;
    this.canal.locate(this.x, this.z, true);
    const location = this.canal.locate(this.x, this.z);
    this.s = s;
    this.d = location.d;
  }

  /** Drift towards a point on the water. */
  seek(x: number, z: number) {
    this.cancelSteering();
    this.seekX = x;
    this.seekZ = z;
    this.seekVx.value = this.vx;
    this.seekVz.value = this.vz;
  }

  look(dYaw: number, dPitch: number) {
    this.autopilot = null;
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + dPitch));
  }

  push(amount: number) {
    this.cancelSteering();
    this.vx += -Math.sin(this.yaw) * amount;
    this.vz += -Math.cos(this.yaw) * amount;
  }

  cancelSteering() {
    this.autopilot = null;
    this.seekX = null;
    this.yawDrift = 0;
    this.pitchDrift = 0;
  }

  step(dt: number, input: BoatInput) {
    const beforeX = this.x;
    const beforeZ = this.z;

    if (input.thrust !== 0 || input.turn !== 0) {
      this.autopilot = null;
      this.seekX = null;
    }

    if (this.autopilot) this.stepAutopilot(dt, this.autopilot);
    else if (this.seekX !== null) this.stepSeek(dt);
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

  private stepFree(dt: number, input: BoatInput) {
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
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.keepOffWalls(dt, input.thrust);
  }

  private stepSeek(dt: number) {
    const targetX = this.seekX as number;
    const targetZ = this.seekZ;
    this.x = smoothDamp(this.x, targetX, this.seekVx, 0.95, dt, 3.2);
    this.z = smoothDamp(this.z, targetZ, this.seekVz, 0.95, dt, 3.2);
    this.vx = this.seekVx.value;
    this.vz = this.seekVz.value;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.2) {
      const turn = wrapAngle(yawTowards(this.vx, this.vz) - this.yaw);
      this.yaw = wrapAngle(this.yaw + turn * (1 - Math.exp(-dt * 0.9)) * Math.min(1, speed / 1.5));
    }
    this.keepOffWalls(dt, 0);
    if (speed < 0.012 && Math.hypot(targetX - this.x, targetZ - this.z) < 0.03) {
      this.seekX = null;
      this.vx = 0;
      this.vz = 0;
    }
  }

  private stepAutopilot(dt: number, pilot: Autopilot) {
    const speedOut = { value: pilot.speed };
    const remaining = smoothDamp(pilot.remaining, 0, speedOut, pilot.smoothTime, dt, 3.6);
    this.s = this.canal.wrap(this.s + (pilot.remaining - remaining));
    pilot.remaining = remaining;
    pilot.speed = speedOut.value;

    const lateralOut = { value: pilot.lateralSpeed };
    this.d = smoothDamp(this.d, pilot.lateral, lateralOut, pilot.smoothTime, dt, 2.4);
    pilot.lateralSpeed = lateralOut.value;

    const frame = this.canal.at(this.s);
    this.x = frame.x + frame.nx * this.d;
    this.z = frame.z + frame.nz * this.d;
    this.canal.locate(this.x, this.z);

    const direction = remaining > 0 ? 1 : -1;
    const travelYaw = yawTowards(frame.tx * direction, frame.tz * direction);
    const nearness = 1 - Math.min(1, Math.max(0, (Math.abs(remaining) - 1) / 3.2));
    const blend = nearness * nearness * (3 - 2 * nearness);
    const yawTarget = wrapAngle(travelYaw + wrapAngle(pilot.faceYaw - travelYaw) * blend);
    this.yaw = wrapAngle(this.yaw + wrapAngle(yawTarget - this.yaw) * (1 - Math.exp(-dt * 2.6)));
    this.pitch += (pilot.facePitch * blend + 0.08 * (1 - blend) - this.pitch) * (1 - Math.exp(-dt * 2.2));

    const settled =
      Math.abs(remaining) < 0.01 &&
      Math.abs(pilot.speed) < 0.02 &&
      Math.abs(wrapAngle(pilot.faceYaw - this.yaw)) < 0.004 &&
      Math.abs(pilot.facePitch - this.pitch) < 0.004;
    if (settled) this.autopilot = null;
  }

  /** Slides along walls rather than stopping dead, and eases the bow round when pushing against one. */
  private keepOffWalls(dt: number, thrust: number) {
    const location = this.canal.locate(this.x, this.z);
    this.s = location.s;
    this.d = location.d;
    const limit = location.halfWidth - WALL_MARGIN;
    if (Math.abs(location.d) <= limit) return;

    const frame = this.canal.at(location.s);
    const clamped = Math.sign(location.d) * limit;
    this.x = frame.x + frame.nx * clamped;
    this.z = frame.z + frame.nz * clamped;
    this.d = clamped;

    const into = this.vx * frame.nx + this.vz * frame.nz;
    if (Math.sign(into) === Math.sign(location.d)) {
      this.vx -= frame.nx * into;
      this.vz -= frame.nz * into;
    }

    if (thrust !== 0) {
      const along = -Math.sin(this.yaw) * frame.tx + -Math.cos(this.yaw) * frame.tz;
      const direction = along >= 0 ? 1 : -1;
      const parallel = yawTowards(frame.tx * direction, frame.tz * direction);
      this.yaw = wrapAngle(this.yaw + wrapAngle(parallel - this.yaw) * (1 - Math.exp(-dt * 1.5)));
    }
  }
}

import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FloorPlan, Point, WaterEdge } from './floorPlan';
import { FUR_FRAGMENT, FUR_VERTEX, PLAIN_FRAGMENT, WORLD_VERTEX } from './shaders';
import { roundedPath, yawTowards, type Walker } from './walker';
import type { SharedUniforms } from './world';

const SHELLS = 10;
const COARSE_SHELLS = 5;
const MIRROR_SHELLS = 3;
const CAT_SCALE = 1.25;
const DECK_TOP = 0.2;
const WALK_SPEED = 0.62;
const STRIDE = 0.34;
/** How far back from the edge the cat sits, so that a stretched paw reaches over it. */
const SITTING_BACK = 0.46;
const PATS = 3;
const PAT_SECONDS = 0.95;

const GREY_ROOT = new Color(0.42, 0.43, 0.46);
const GREY_TIP = new Color(0.64, 0.65, 0.68);
const PALE_ROOT = new Color(0.62, 0.62, 0.64);
const PALE_TIP = new Color(0.92, 0.92, 0.91);

const TURN_RATE = 2.2;
const NOTICES_VISITOR_WITHIN = 6.5;

type CatState = 'resting' | 'walking' | 'patting';

function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, detail = 14) {
  return new SphereGeometry(1, detail, Math.round(detail * 0.75)).scale(rx, ry, rz).translate(x, y, z);
}

function damp(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** A grey long-haired cat, built from soft shapes. It strolls on the boards and sometimes dabs at the water. */
export class Cat {
  readonly group = new Group();
  private readonly furMeshes: InstancedMesh[] = [];
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly frontLeft = new Group();
  private readonly frontRight = new Group();
  private readonly hindLeft = new Group();
  private readonly hindRight = new Group();
  private readonly tail: Group[] = [];

  private shells = SHELLS;
  private state: CatState = 'resting';
  private sitting = 1;
  private stride = 0;
  private strideAmount = 0;
  private yaw = 0;
  private pose: { xs: number[]; zs: number[]; lengths: number[]; travelled: number; speed: number } | null = null;
  /** The edge the cat is sitting by. */
  private edge: WaterEdge | null = null;
  private patTime = 0;
  private tailTime = 0;
  private headYaw = 0;
  private headDown = 0;
  private reach = 0;
  /** Set for one frame when a paw touches the water. */
  private readonly pawSpot = new Vector3();

  x = 0;
  z = 0;

  constructor(
    private readonly plan: FloorPlan,
    private readonly shared: SharedUniforms,
    private readonly onPawTouch: (x: number, z: number) => void,
  ) {
    this.buildBody();
    this.group.scale.setScalar(CAT_SCALE);
    this.group.position.y = DECK_TOP;
  }

  get busy() {
    return this.state !== 'resting' || this.sitting < 0.995;
  }

  /** Puts the cat straight at a place, for when nobody is looking. */
  sitAt(edge: WaterEdge) {
    this.x = edge.x - edge.dx * SITTING_BACK;
    this.z = edge.z - edge.dz * SITTING_BACK;
    this.yaw = yawTowards(-edge.dx, -edge.dz);
    this.edge = edge;
    this.state = 'resting';
    this.sitting = 1;
    this.pose = null;
    this.applyPose();
  }

  walkTo(edge: WaterEdge) {
    const target: Point = { x: edge.x - edge.dx * SITTING_BACK, z: edge.z - edge.dz * SITTING_BACK };
    const route = this.plan.route({ x: this.x, z: this.z }, target);
    this.pose = { ...roundedPath(route), travelled: 0, speed: 0 };
    this.edge = edge;
    this.state = 'walking';
  }

  /** Reaches over the edge the cat is sitting at. */
  patWater() {
    this.state = 'patting';
    this.patTime = 0;
  }

  setMirrorPass(mirror: boolean) {
    for (const mesh of this.furMeshes) mesh.count = mirror ? MIRROR_SHELLS : this.shells;
  }

  /** Fewer layers of fur for slower devices. */
  setCoarseFur(coarse: boolean) {
    this.shells = coarse ? COARSE_SHELLS : SHELLS;
    for (const mesh of this.furMeshes) (mesh.material as ShaderMaterial).uniforms.uShells.value = this.shells;
  }

  update(dt: number, walker: Walker) {
    this.tailTime += dt;
    if (this.state === 'walking' && this.pose) this.stepWalking(dt, this.pose);
    if (this.state === 'patting') this.stepPatting(dt);
    if (this.state === 'resting') this.turnTowardsVisitor(dt, walker);

    const wantSit = this.state === 'walking' ? 0 : 1;
    this.sitting = damp(this.sitting, wantSit, 4.5, dt);
    if (this.sitting > 0.995 && wantSit === 1) this.sitting = 1;
    this.strideAmount = damp(this.strideAmount, this.state === 'walking' ? 1 : 0, 6, dt);
    this.reach = damp(this.reach, this.state === 'patting' ? 1 : 0, 6, dt);
    this.applyPose();
    this.lookAtVisitor(dt, walker);
  }

  private stepWalking(dt: number, pose: NonNullable<Cat['pose']>) {
    const total = pose.lengths[pose.lengths.length - 1];
    const remaining = total - pose.travelled;
    const targetSpeed = Math.min(WALK_SPEED, 0.12 + remaining * 1.1);
    pose.speed = damp(pose.speed, targetSpeed, 5, dt);
    pose.travelled = Math.min(total, pose.travelled + pose.speed * dt);
    this.stride += (pose.speed * dt) / STRIDE;

    let index = 1;
    while (index < pose.lengths.length - 1 && pose.lengths[index] < pose.travelled) index++;
    const span = pose.lengths[index] - pose.lengths[index - 1] || 1;
    const t = Math.min(1, (pose.travelled - pose.lengths[index - 1]) / span);
    const dirX = pose.xs[index] - pose.xs[index - 1];
    const dirZ = pose.zs[index] - pose.zs[index - 1];
    this.x = pose.xs[index - 1] + dirX * t;
    this.z = pose.zs[index - 1] + dirZ * t;
    if (dirX !== 0 || dirZ !== 0) {
      this.yaw = wrapAngle(this.yaw + wrapAngle(yawTowards(dirX, dirZ) - this.yaw) * (1 - Math.exp(-dt * 5)));
    }

    if (remaining < 0.015) {
      this.pose = null;
      this.state = 'resting';
    }
  }

  private turnTowardsVisitor(dt: number, walker: Walker) {
    const dx = walker.x - this.x;
    const dz = walker.z - this.z;
    if (Math.hypot(dx, dz) > NOTICES_VISITOR_WITHIN) return;
    this.yaw = wrapAngle(this.yaw + wrapAngle(yawTowards(dx, dz) - this.yaw) * (1 - Math.exp(-dt * TURN_RATE * 0.6)));
  }

  private stepPatting(dt: number) {
    // First round to face the water, then the paw.
    if (this.edge) {
      const off = wrapAngle(yawTowards(this.edge.dx, this.edge.dz) - this.yaw);
      this.yaw = wrapAngle(this.yaw + off * (1 - Math.exp(-dt * TURN_RATE * 2)));
      if (Math.abs(off) > 0.12) return;
    }
    const before = this.patTime;
    this.patTime += dt;
    // The paw comes down at the middle of each pat.
    const touchAt = Math.floor(before / PAT_SECONDS) + 0.52;
    if (before / PAT_SECONDS < touchAt && this.patTime / PAT_SECONDS >= touchAt) {
      this.frontRight.updateWorldMatrix(true, false);
      this.pawSpot.set(0, -0.215 * 2, 0).applyMatrix4(this.frontRight.matrixWorld);
      this.onPawTouch(this.pawSpot.x, this.pawSpot.z);
    }
    if (this.patTime >= PAT_SECONDS * PATS) this.state = 'resting';
  }

  private applyPose() {
    const sit = this.sitting;
    const patting = this.state === 'patting';
    const lean = this.reach;

    const walkBob = Math.abs(Math.sin(this.stride * Math.PI)) * 0.012 * this.strideAmount;
    const hipY = 0.205 - 0.055 * sit - 0.02 * lean + walkBob;
    const tilt = (0.5 * sit) * (1 - lean * 0.62);
    this.body.position.y = hipY;
    this.body.rotation.x = tilt;

    this.group.position.x = this.x;
    this.group.position.z = this.z;
    this.group.rotation.y = this.yaw;

    const shoulderY = hipY + Math.sin(tilt) * 0.33 - 0.01;
    const legStretch = shoulderY / 0.215;
    const swing = Math.sin(this.stride * Math.PI) * 0.5 * this.strideAmount;

    this.frontLeft.rotation.x = -tilt + swing;
    this.frontLeft.scale.y = legStretch;
    this.hindLeft.rotation.x = -tilt - swing + 0.45 * sit;
    this.hindRight.rotation.x = -tilt + swing + 0.45 * sit;
    this.hindLeft.scale.y = 1 - 0.32 * sit;
    this.hindRight.scale.y = 1 - 0.32 * sit;

    if (patting) {
      // Up and forward, then a long reach down to the water.
      const phase = (this.patTime / PAT_SECONDS) % 1;
      const down = Math.sin(Math.min(1, Math.max(0, (phase - 0.25) / 0.5)) * Math.PI);
      this.frontRight.rotation.x = -tilt + 1.05 - 0.5 * down;
      this.frontRight.scale.y = legStretch * (1 + 1.05 * down);
    } else {
      this.frontRight.rotation.x = -tilt - swing;
      this.frontRight.scale.y = legStretch;
    }

    const flick = Math.sin(this.tailTime * (patting ? 3.4 : 1.6));
    this.tail.forEach((segment, index) => {
      const fromBase = index / (this.tail.length - 1);
      segment.rotation.y = flick * (0.1 + 0.2 * fromBase) * (patting ? 1.2 : 0.7);
      segment.rotation.x = -tilt * 0.2 + 0.1 + 0.2 * fromBase - 0.35 * (1 - sit) * (1 - fromBase);
    });
  }

  private lookAtVisitor(dt: number, walker: Walker) {
    const dx = walker.x - this.x;
    const dz = walker.z - this.z;
    const near = Math.hypot(dx, dz) < NOTICES_VISITOR_WITHIN && this.state === 'resting';
    const wanted = near ? wrapAngle(yawTowards(dx, dz) - this.yaw) : 0;
    this.headYaw = damp(this.headYaw, Math.max(-1, Math.min(1, wanted)), 3, dt);
    this.headDown = damp(this.headDown, this.state === 'patting' ? 0.5 : 0, 5, dt);
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = -this.body.rotation.x - this.headDown + 0.04;
  }

  private fur(geometry: BufferGeometry, length: number, root: Color, tip: Color, strands: [number, number]) {
    const material = new ShaderMaterial({
      vertexShader: FUR_VERTEX,
      fragmentShader: FUR_FRAGMENT,
      uniforms: {
        ...this.shared,
        uShells: { value: SHELLS },
        uFurLength: { value: length },
        uRootColor: { value: root },
        uTipColor: { value: tip },
        uStrands: { value: { x: strands[0], y: strands[1] } },
      },
    });
    const mesh = new InstancedMesh(geometry, material, SHELLS);
    mesh.frustumCulled = false;
    this.furMeshes.push(mesh);
    return mesh;
  }

  private plain(geometry: BufferGeometry, color: [number, number, number]) {
    return new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: WORLD_VERTEX,
        fragmentShader: PLAIN_FRAGMENT,
        uniforms: { ...this.shared, uColor: { value: new Color(...color) } },
      }),
    );
  }

  private buildBody() {
    this.group.add(this.body);
    this.body.position.set(0, 0.2, 0.18);

    const trunk = mergeGeometries([
      ellipsoid(0.115, 0.11, 0.23, 0, 0.03, -0.18),
      ellipsoid(0.125, 0.12, 0.13, 0, 0.02, -0.02),
    ]);
    this.body.add(this.fur(trunk, 0.085, GREY_ROOT, GREY_TIP, [260, 90]));
    this.body.add(this.fur(ellipsoid(0.1, 0.115, 0.1, 0, 0.0, -0.36), 0.1, PALE_ROOT, PALE_TIP, [200, 80]));

    this.addHead();
    this.addLegs();
    this.addTail();
  }

  private addHead() {
    // A generous head and big eyes do most of the charm.
    this.head.position.set(0, 0.13, -0.42);
    this.head.scale.setScalar(1.28);
    this.body.add(this.head);

    this.head.add(this.fur(ellipsoid(0.09, 0.08, 0.082, 0, 0.03, -0.04, 16), 0.022, GREY_ROOT, GREY_TIP, [150, 90]));
    const cheeks = mergeGeometries([
      ellipsoid(0.052, 0.04, 0.042, 0.062, 0.0, -0.05, 10),
      ellipsoid(0.052, 0.04, 0.042, -0.062, 0.0, -0.05, 10),
    ]);
    this.head.add(this.fur(cheeks, 0.05, PALE_ROOT, GREY_TIP, [80, 50]));
    this.head.add(this.fur(ellipsoid(0.037, 0.027, 0.03, 0, 0.002, -0.112, 10), 0.008, PALE_ROOT, PALE_TIP, [40, 30]));

    const earShape = (side: number, radius: number, height: number, inset: number) =>
      new ConeGeometry(radius, height, 8).rotateZ(-side * 0.16).translate(side * 0.058, 0.122, -0.03 - inset);
    this.head.add(this.plain(mergeGeometries([earShape(1, 0.036, 0.085, 0), earShape(-1, 0.036, 0.085, 0)]), [0.34, 0.35, 0.38]));
    this.head.add(this.plain(mergeGeometries([earShape(1, 0.022, 0.058, 0.014), earShape(-1, 0.022, 0.058, 0.014)]), [0.82, 0.62, 0.6]));

    const eye = (side: number) => ellipsoid(0.023, 0.025, 0.016, side * 0.039, 0.044, -0.118, 12);
    this.head.add(this.plain(mergeGeometries([eye(1), eye(-1)]), [0.08, 0.09, 0.07]));
    const glint = (side: number) => ellipsoid(0.0065, 0.0065, 0.004, side * 0.044, 0.053, -0.133, 6);
    this.head.add(this.plain(mergeGeometries([glint(1), glint(-1)]), [0.96, 0.96, 0.93]));
    this.head.add(this.plain(ellipsoid(0.012, 0.008, 0.008, 0, 0.018, -0.142, 8), [0.8, 0.52, 0.52]));
  }

  private addLegs() {
    const leg = () =>
      mergeGeometries([ellipsoid(0.034, 0.11, 0.036, 0, -0.1, 0, 10), ellipsoid(0.034, 0.022, 0.046, 0, -0.205, -0.012, 10)]);
    const place = (pivot: Group, x: number, y: number, z: number, root: Color, tip: Color) => {
      pivot.position.set(x, y, z);
      pivot.add(this.fur(leg(), 0.032, root, tip, [70, 60]));
      this.body.add(pivot);
    };
    place(this.frontLeft, 0.058, -0.01, -0.33, PALE_ROOT, PALE_TIP);
    place(this.frontRight, -0.058, -0.01, -0.33, PALE_ROOT, PALE_TIP);
    place(this.hindLeft, 0.088, -0.01, -0.02, GREY_ROOT, GREY_TIP);
    place(this.hindRight, -0.088, -0.01, -0.02, GREY_ROOT, GREY_TIP);
  }

  private addTail() {
    let parent: Group = this.body;
    for (let i = 0; i < 6; i++) {
      const segment = new Group();
      segment.position.set(0, i === 0 ? 0.05 : 0, i === 0 ? 0.1 : 0.065);
      const radius = 0.046 - i * 0.003;
      segment.add(this.fur(ellipsoid(radius, radius, 0.058, 0, 0, 0.03, 10), 0.085, GREY_ROOT, GREY_TIP, [110, 56]));
      parent.add(segment);
      parent = segment;
      this.tail.push(segment);
    }
  }
}

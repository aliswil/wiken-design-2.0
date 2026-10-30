import {
  ConeGeometry,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type IUniform,
  type PerspectiveCamera,
  type Scene,
  type Vector4,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Cat } from './cat';
import type { FloorPlan, Point } from './floorPlan';
import { FISH_FRAGMENT, MAX_FISH, WORLD_VERTEX } from './shaders';
import { yawTowards, type Walker } from './walker';
import type { SharedUniforms } from './world';

const FISH_PER_ROOM = 2;
const FISH_LENGTH = 0.3;
const SWIM_SPEED = 0.24;
const JUMP_SECONDS = 1.05;
const JUMP_DISTANCE = 1.15;
const JUMP_HEIGHT = 0.82;

interface Swimmer extends Point {
  room: number;
  heading: number;
  turning: number;
  hidden: boolean;
}

interface Jump {
  swimmer: Swimmer;
  time: number;
  dirX: number;
  dirZ: number;
  fromX: number;
  fromZ: number;
}

function buildFishMesh(shared: SharedUniforms) {
  const body = new SphereGeometry(1, 14, 10);
  const position = body.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    // Fuller towards the head (-z), narrowing to the tail.
    const taper = z > 0 ? 1 - z * 0.72 : 1 - z * z * 0.25;
    position.setXYZ(i, position.getX(i) * 0.042 * taper, position.getY(i) * 0.062 * taper, z * 0.2);
  }
  body.computeVertexNormals();
  const tail = new ConeGeometry(0.058, 0.11, 4).rotateX(-Math.PI / 2).scale(0.25, 1, 1).translate(0, 0, 0.235);
  return new Mesh(
    mergeGeometries([body, tail]),
    new ShaderMaterial({ vertexShader: WORLD_VERTEX, fragmentShader: FISH_FRAGMENT, uniforms: { ...shared } }),
  );
}

/** The animals in the rooms: fish under the surface that jump now and then, and the cat on the boards. */
export class RoomLife {
  private readonly cat: Cat;
  private readonly swimmers: Swimmer[] = [];
  private readonly flyingFish: Mesh;
  private readonly fishUniform: Vector4[];
  private jump: Jump | null = null;
  private swimLeft = 0;
  private catHasPatted = false;

  constructor(
    private readonly plan: FloorPlan,
    scene: Scene,
    shared: SharedUniforms,
    private readonly waterUniforms: Record<string, IUniform>,
    private readonly addRipple: (x: number, z: number, strength: number) => void,
  ) {
    this.fishUniform = waterUniforms.uFish.value;

    plan.rooms.forEach((_, room) => {
      for (let i = 0; i < FISH_PER_ROOM; i++) {
        const spot = this.randomWater(room);
        this.swimmers.push({ ...spot, room, heading: Math.random() * Math.PI * 2, turning: 0, hidden: false });
      }
    });

    this.flyingFish = buildFishMesh(shared);
    this.flyingFish.visible = false;
    this.flyingFish.scale.setScalar(1.35);
    this.flyingFish.rotation.order = 'YXZ';
    scene.add(this.flyingFish);

    this.cat = new Cat(plan, shared, (x, z) => addRipple(x, z, 0.6));
    this.cat.sitAt(plan.waterEdges(0).find((edge) => edge.dz < 0) ?? plan.waterEdges(0)[0]);
    scene.add(this.cat.group);
    this.fillFishUniform(0);
  }

  get busy() {
    return this.cat.busy || this.jump !== null || this.swimLeft > 0;
  }

  setMirrorPass(mirror: boolean) {
    this.cat.setMirrorPass(mirror);
  }

  setCoarseFur(coarse: boolean) {
    this.cat.setCoarseFur(coarse);
  }

  private randomWater(room: number): Point {
    const { x0, x1, z0, z1 } = this.plan.rooms[room];
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = x0 + Math.random() * (x1 - x0);
      const z = z0 + Math.random() * (z1 - z0);
      if (this.plan.isOpenWater(room, x, z)) return { x, z };
    }
    return { x: x0 + 1, z: z0 + 1 };
  }

  /** Something small happens. The cat comes along to whichever room the visitor is in. */
  startEpisode(walker: Walker, camera: PerspectiveCamera) {
    const room = this.plan.roomAt(walker.x, walker.z);
    const catRoom = this.plan.roomAt(this.cat.x, this.cat.z);

    if (!this.plan.areNeighbours(room, catRoom)) {
      const nearby = (room + 1) % this.plan.rooms.length;
      this.cat.sitAt(this.pick(this.plan.waterEdges(nearby)));
      this.cat.walkTo(this.pick(this.plan.waterEdges(room)));
      this.swimLeft = 3;
      return;
    }

    const roll = Math.random();
    if (!this.catHasPatted || roll < 0.3) {
      this.catHasPatted = true;
      this.cat.patWater();
    } else if (roll < 0.62) {
      this.jumpFish(room, walker, camera);
    } else {
      this.cat.walkTo(this.pick(this.plan.waterEdges(room)));
    }
    this.swimLeft = Math.max(this.swimLeft, 3);
  }

  private pick<T>(items: T[]) {
    return items[Math.floor(Math.random() * items.length)];
  }

  private jumpFish(room: number, walker: Walker, camera: PerspectiveCamera) {
    const lookX = -Math.sin(walker.yaw);
    const lookZ = -Math.cos(walker.yaw);
    const halfFov = ((camera.fov * camera.aspect) / 2) * (Math.PI / 180);
    const inView = Math.cos(Math.min(halfFov, 0.7));
    const swimmer = this.swimmers.filter((candidate) => candidate.room === room && !candidate.hidden)[0];
    if (!swimmer) return;

    // A jump nobody sees is wasted, so the fish is one that is in view.
    for (let attempt = 0; attempt < 24; attempt++) {
      const spot = this.randomWater(room);
      const dx = spot.x - walker.x;
      const dz = spot.z - walker.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1.6 || distance > 6.5 || (dx * lookX + dz * lookZ) / distance < inView) continue;
      const heading = Math.random() * Math.PI * 2;
      const endX = spot.x + Math.cos(heading) * JUMP_DISTANCE;
      const endZ = spot.z + Math.sin(heading) * JUMP_DISTANCE;
      if (!this.plan.isOpenWater(room, endX, endZ)) continue;
      swimmer.x = spot.x;
      swimmer.z = spot.z;
      swimmer.heading = heading;
      swimmer.hidden = true;
      this.jump = {
        swimmer,
        time: 0,
        dirX: Math.cos(heading),
        dirZ: Math.sin(heading),
        fromX: spot.x,
        fromZ: spot.z,
      };
      this.flyingFish.visible = true;
      this.addRipple(spot.x, spot.z, 0.9);
      return;
    }
  }

  private stepJump(dt: number, jump: Jump) {
    jump.time += dt;
    const t = Math.min(1, jump.time / JUMP_SECONDS);
    const along = JUMP_DISTANCE * t;
    const y = 4 * JUMP_HEIGHT * t * (1 - t) - 0.08;
    const slope = 4 * JUMP_HEIGHT * (1 - 2 * t) / JUMP_DISTANCE;
    this.flyingFish.position.set(jump.fromX + jump.dirX * along, y, jump.fromZ + jump.dirZ * along);
    this.flyingFish.rotation.y = yawTowards(jump.dirX, jump.dirZ);
    this.flyingFish.rotation.x = Math.atan(slope);

    if (t >= 1) {
      const { swimmer } = jump;
      swimmer.x = this.flyingFish.position.x;
      swimmer.z = this.flyingFish.position.z;
      swimmer.hidden = false;
      this.flyingFish.visible = false;
      this.addRipple(swimmer.x, swimmer.z, 1.1);
      this.jump = null;
    }
  }

  private swim(dt: number, room: number) {
    for (const fish of this.swimmers) {
      if (fish.hidden || !this.plan.areNeighbours(room, fish.room)) continue;
      fish.turning += (Math.random() - 0.5) * dt * 2.4;
      fish.turning *= Math.exp(-dt * 0.8);
      fish.heading += fish.turning * dt;
      const nextX = fish.x + Math.cos(fish.heading) * SWIM_SPEED * dt;
      const nextZ = fish.z + Math.sin(fish.heading) * SWIM_SPEED * dt;
      if (this.plan.isOpenWater(fish.room, nextX, nextZ)) {
        fish.x = nextX;
        fish.z = nextZ;
      } else {
        fish.heading += dt * 2.6;
      }
    }
  }

  private fillFishUniform(room: number) {
    let count = 0;
    for (const fish of this.swimmers) {
      if (count === MAX_FISH) break;
      if (!this.plan.areNeighbours(room, fish.room)) continue;
      this.fishUniform[count++].set(fish.x, fish.z, fish.heading, fish.hidden ? 0 : FISH_LENGTH);
    }
    this.waterUniforms.uFishCount.value = count;
  }

  /** Call once per rendered frame. */
  update(dt: number, walker: Walker) {
    const room = this.plan.roomAt(walker.x, walker.z);
    this.cat.group.visible = this.plan.areNeighbours(room, this.plan.roomAt(this.cat.x, this.cat.z));
    this.cat.update(dt, walker);
    if (this.jump) this.stepJump(dt, this.jump);
    this.swim(dt, room);
    this.swimLeft = Math.max(0, this.swimLeft - dt);
    this.fillFishUniform(room);
  }
}

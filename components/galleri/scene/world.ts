import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  type IUniform,
  Vector3,
  Vector4,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Painting } from '../types';
import { toWallPigment, type Rgb } from './colors';
import { DOOR_HEIGHT, DOOR_WIDTH, FloorPlan } from './floorPlan';
import {
  FRAME_FRAGMENT,
  MAX_RIPPLES,
  PAINTING_FRAGMENT,
  SHADOW_FRAGMENT,
  WALL_FRAGMENT,
  WALL_VERTEX,
  WATER_FRAGMENT,
  WORLD_VERTEX,
} from './shaders';

const WALL_TOP = 8;
// Walls run on below the water so that a disturbed reflection never samples past their foot.
const WALL_FOOT = -1.5;
const HANG_HEIGHT = 0.62;
const PAINTING_AREA = 4.3;
const MAX_PAINTING_HEIGHT = 3.1;
const MAX_PAINTING_WIDTH = 2.7;
const FRAME_WIDTH = 0.035;
const WALL_CLEARANCE = 0.06;
const BARE_WALL: Rgb = [0.86, 0.87, 0.82];

export type SharedUniforms = Record<'uPaper' | 'uResolution' | 'uEdge', IUniform>;

export interface HungPainting {
  painting: Painting;
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  uniforms: { uFrom: IUniform<Texture>; uTo: IUniform<Texture>; uBlend: IUniform<number> };
  room: number;
  width: number;
  height: number;
  center: Vector3;
  /** Points out of the picture plane, towards the water. */
  normal: Vector3;
}

function paintingSize(painting: Painting) {
  const aspect = painting.width / painting.height;
  let width = Math.sqrt(PAINTING_AREA * aspect);
  let height = width / aspect;
  if (height > MAX_PAINTING_HEIGHT) {
    height = MAX_PAINTING_HEIGHT;
    width = height * aspect;
  }
  if (width > MAX_PAINTING_WIDTH) {
    width = MAX_PAINTING_WIDTH;
    height = width / aspect;
  }
  return { width, height };
}

/** Shares the paintings out in order, so the walk through the rooms follows the collection. */
export function hangPaintings(
  plan: FloorPlan,
  paintings: Painting[],
  shared: SharedUniforms,
  placeholder: (painting: Painting) => Texture,
): HungPainting[] {
  const roomCount = plan.rooms.length;
  const perRoom = Math.floor(paintings.length / roomCount);
  const extra = paintings.length % roomCount;
  const hung: HungPainting[] = [];
  let next = 0;

  for (let room = 0; room < roomCount; room++) {
    const count = perRoom + (room < extra ? 1 : 0);
    const spots = plan.hangingSpots(room);
    for (let i = 0; i < count; i++) {
      const painting = paintings[next++];
      const { wall, along } = spots[i % spots.length];
      const { width, height } = paintingSize(painting);
      const normal = new Vector3(wall.nx, 0, wall.nz);
      const center = new Vector3(
        wall.x + wall.dx * along + wall.nx * WALL_CLEARANCE,
        HANG_HEIGHT + height / 2,
        wall.z + wall.dz * along + wall.nz * WALL_CLEARANCE,
      );
      const texture = placeholder(painting);
      const uniforms = {
        uFrom: { value: texture },
        uTo: { value: texture },
        uBlend: { value: 0 },
      };
      const material = new ShaderMaterial({
        vertexShader: WORLD_VERTEX,
        fragmentShader: PAINTING_FRAGMENT,
        uniforms: { ...shared, ...uniforms },
      });
      const mesh = new Mesh(new PlaneGeometry(width, height), material);
      mesh.position.copy(center);
      mesh.rotation.y = Math.atan2(normal.x, normal.z);
      mesh.updateMatrixWorld();
      hung.push({ painting, mesh, uniforms, room, width, height, center, normal });
    }
  }
  return hung;
}

function placedOnWall(geometry: BufferGeometry, hung: HungPainting, back: number, drop = 0) {
  const matrix = new Matrix4().makeRotationY(hung.mesh.rotation.y);
  matrix.setPosition(hung.center.clone().addScaledVector(hung.normal, -back).setY(hung.center.y - drop));
  return geometry.applyMatrix4(matrix);
}

export function buildFrames(hung: HungPainting[], shared: SharedUniforms) {
  const pieces = hung.map((item) =>
    placedOnWall(new BoxGeometry(item.width + FRAME_WIDTH * 2, item.height + FRAME_WIDTH * 2, 0.05), item, 0.027),
  );
  const material = new ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: FRAME_FRAGMENT,
    uniforms: { ...shared, uColor: { value: new Color(0.17, 0.15, 0.12) } },
  });
  return new Mesh(mergeGeometries(pieces), material);
}

export function buildShadows(hung: HungPainting[]) {
  const pieces = hung.map((item) =>
    placedOnWall(new PlaneGeometry(item.width + 0.55, item.height + 0.55), item, 0.05, 0.07),
  );
  const material = new ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: SHADOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  return new Mesh(mergeGeometries(pieces), material);
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

/** Each room takes its colour from the paintings in it, so the rooms differ when seen through the doors. */
function roomTones(plan: FloorPlan, hung: HungPainting[]) {
  return plan.rooms.map((_, room) => {
    const pigments = hung.filter((item) => item.room === room).map((item) => toWallPigment(item.painting.palette[0]));
    if (pigments.length === 0) return BARE_WALL;
    const sum = pigments.reduce<Rgb>((total, p) => [total[0] + p[0], total[1] + p[1], total[2] + p[2]], [0, 0, 0]);
    return mixRgb(BARE_WALL, [sum[0] / pigments.length, sum[1] / pigments.length, sum[2] / pigments.length], 0.85);
  });
}

class WallBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly along: number[] = [];
  private readonly tones: number[] = [];
  private readonly indices: number[] = [];

  /** One rectangle. `along` is [distance at a, distance at b, wall length, noise offset]. */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    normal: [number, number, number],
    along: [number, number, number, number],
    tone: Rgb,
  ) {
    const first = this.positions.length / 3;
    [a, b, c, d].forEach((corner, i) => {
      this.positions.push(...corner);
      this.normals.push(...normal);
      this.along.push(i === 0 || i === 3 ? along[0] : along[1], along[2], along[3]);
      this.tones.push(...tone);
    });
    this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  build() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(this.along), 3));
    geometry.setAttribute('aTone', new BufferAttribute(new Float32Array(this.tones), 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

export function buildWalls(plan: FloorPlan, hung: HungPainting[], shared: SharedUniforms) {
  const tones = roomTones(plan, hung);
  const builder = new WallBuilder();

  plan.walls.forEach((wall, index) => {
    const seed = index * 37.3;
    const tone = tones[wall.room];
    const normal: [number, number, number] = [wall.nx, 0, wall.nz];
    const pointAt = (distance: number, y: number): [number, number, number] => [
      wall.x + wall.dx * distance,
      y,
      wall.z + wall.dz * distance,
    ];
    const piece = (from: number, to: number, bottom: number) =>
      builder.quad(
        pointAt(from, bottom),
        pointAt(to, bottom),
        pointAt(to, WALL_TOP),
        pointAt(from, WALL_TOP),
        normal,
        [from, to, wall.length, seed],
        tone,
      );

    if (!wall.door) {
      piece(0, wall.length, WALL_FOOT);
      return;
    }
    const [doorFrom, doorTo] = wall.door;
    piece(0, doorFrom, WALL_FOOT);
    piece(doorTo, wall.length, WALL_FOOT);
    piece(doorFrom, doorTo, DOOR_HEIGHT);
  });

  plan.doors.forEach((door, index) => {
    const seed = 700 + index * 11.7;
    const tone = mixRgb(tones[door.rooms[0]], tones[door.rooms[1]], 0.5);
    const reveal: Rgb = [tone[0] * 0.8, tone[1] * 0.8, tone[2] * 0.8];
    const soffit: Rgb = [tone[0] * 0.62, tone[1] * 0.62, tone[2] * 0.62];
    const depth = 0.25;
    const half = DOOR_WIDTH / 2;
    const place = (across: number, side: number, y: number): [number, number, number] =>
      door.crossing === 'x'
        ? [door.plane + across, y, door.center + side]
        : [door.center + side, y, door.plane + across];
    const faceSide = (sign: number): [number, number, number] =>
      door.crossing === 'x' ? [0, 0, sign] : [sign, 0, 0];

    for (const side of [-half, half]) {
      builder.quad(
        place(-depth, side, WALL_FOOT),
        place(depth, side, WALL_FOOT),
        place(depth, side, DOOR_HEIGHT),
        place(-depth, side, DOOR_HEIGHT),
        faceSide(-Math.sign(side)),
        [2, 2.5, 5, seed + side],
        reveal,
      );
    }
    builder.quad(
      place(-depth, -half, DOOR_HEIGHT),
      place(depth, -half, DOOR_HEIGHT),
      place(depth, half, DOOR_HEIGHT),
      place(-depth, half, DOOR_HEIGHT),
      [0, -1, 0],
      [2, 2.5, 5, seed],
      soffit,
    );
  });

  const material = new ShaderMaterial({
    vertexShader: WALL_VERTEX,
    fragmentShader: WALL_FRAGMENT,
    side: DoubleSide,
    uniforms: { ...shared },
  });
  return new Mesh(builder.build(), material);
}

export function buildWater(plan: FloorPlan, shared: SharedUniforms, reflection: Texture) {
  const { x0, x1, z0, z1 } = plan.bounds;
  const geometry = new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const material = new ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      ...shared,
      uReflection: { value: reflection },
      uAgitation: { value: 0 },
      uTime: { value: 0 },
      uRippleCount: { value: MAX_RIPPLES },
      uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
    },
  });
  return new Mesh(geometry, material);
}

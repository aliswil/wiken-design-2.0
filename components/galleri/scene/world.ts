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
import { frameFor, frameReach, type FrameStyle } from './frames';
import {
  MAX_FISH,
  DECK_FRAGMENT,
  DECK_VERTEX,
  DOOR_FRAME_FRAGMENT,
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
const MAX_PAINTING_HEIGHT = 2.85;
const MAX_PAINTING_WIDTH = 2.7;
const WALL_CLEARANCE = 0.06;
const BARE_WALL: Rgb = [0.93, 0.92, 0.88];
const DECK_TOP = 0.2;
const DECK_THICKNESS = 0.12;
const DOOR_FRAME_WIDTH = 0.09;

export type SharedUniforms = Record<'uPaper' | 'uResolution' | 'uEdge', IUniform>;

export interface HungPainting {
  painting: Painting;
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  uniforms: { uFrom: IUniform<Texture>; uTo: IUniform<Texture>; uBlend: IUniform<number> };
  room: number;
  width: number;
  height: number;
  frame: FrameStyle;
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
    const spots = plan.hangingSpots(room, count);
    for (let i = 0; i < count; i++) {
      const painting = paintings[next++];
      const { wall, along } = spots[i % spots.length];
      const { width, height } = paintingSize(painting);
      const frame = frameFor(painting.id, painting.palette);
      const normal = new Vector3(wall.nx, 0, wall.nz);
      const center = new Vector3(
        wall.x + wall.dx * along + wall.nx * WALL_CLEARANCE,
        HANG_HEIGHT + frameReach(frame) + height / 2,
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
      hung.push({ painting, mesh, uniforms, room, width, height, frame, center, normal });
    }
  }
  return hung;
}

function placedOnWall(geometry: BufferGeometry, hung: HungPainting, back: number, drop = 0) {
  const matrix = new Matrix4().makeRotationY(hung.mesh.rotation.y);
  matrix.setPosition(hung.center.clone().addScaledVector(hung.normal, -back).setY(hung.center.y - drop));
  return geometry.applyMatrix4(matrix);
}

export function buildShadows(hung: HungPainting[]) {
  const pieces = hung.map((item) =>
    placedOnWall(
      new PlaneGeometry(item.width + frameReach(item.frame) * 2 + 0.5, item.height + frameReach(item.frame) * 2 + 0.5),
      item,
      0.05,
      0.07,
    ),
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
    return mixRgb(BARE_WALL, [sum[0] / pigments.length, sum[1] / pigments.length, sum[2] / pigments.length], 0.8);
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
    const reveal: Rgb = [tone[0] * 0.88, tone[1] * 0.88, tone[2] * 0.88];
    const soffit: Rgb = [tone[0] * 0.72, tone[1] * 0.72, tone[2] * 0.72];
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

/** The boardwalk: one slab per stretch, with the boards drawn by the shader. */
export function buildDeck(plan: FloorPlan, shared: SharedUniforms) {
  const pieces = plan.deck.map((piece) => {
    const box = new BoxGeometry(piece.x1 - piece.x0, DECK_THICKNESS, piece.z1 - piece.z0);
    box.translate((piece.x0 + piece.x1) / 2, DECK_TOP - DECK_THICKNESS / 2, (piece.z0 + piece.z1) / 2);
    const acrossX = new Float32Array(box.attributes.position.count).fill(piece.walkAlong === 'x' ? 1 : 0);
    box.setAttribute('aAcrossX', new BufferAttribute(acrossX, 1));
    return box;
  });
  const material = new ShaderMaterial({
    vertexShader: DECK_VERTEX,
    fragmentShader: DECK_FRAGMENT,
    uniforms: { ...shared },
  });
  return new Mesh(mergeGeometries(pieces), material);
}

/** Slim oak mouldings round each door opening, on both faces of the wall. */
export function buildDoorFrames(plan: FloorPlan, shared: SharedUniforms) {
  const pieces: BoxGeometry[] = [];
  const half = DOOR_WIDTH / 2 + DOOR_FRAME_WIDTH / 2;
  const depth = 0.03;
  const place = (door: (typeof plan.doors)[number], across: number, side: number, y: number, width: number, height: number) => {
    const box =
      door.crossing === 'x' ? new BoxGeometry(depth, height, width) : new BoxGeometry(width, height, depth);
    box.translate(
      door.crossing === 'x' ? door.plane + across : door.center + side,
      y,
      door.crossing === 'x' ? door.center + side : door.plane + across,
    );
    pieces.push(box);
  };
  for (const door of plan.doors) {
    for (const across of [-0.25, 0.25]) {
      const top = DOOR_HEIGHT + DOOR_FRAME_WIDTH;
      place(door, across, -half, top / 2, DOOR_FRAME_WIDTH, top);
      place(door, across, half, top / 2, DOOR_FRAME_WIDTH, top);
      place(door, across, 0, DOOR_HEIGHT + DOOR_FRAME_WIDTH / 2, DOOR_WIDTH, DOOR_FRAME_WIDTH);
    }
  }
  const material = new ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: DOOR_FRAME_FRAGMENT,
    uniforms: { ...shared, uColor: { value: new Color(0.66, 0.5, 0.33) } },
  });
  return new Mesh(mergeGeometries(pieces), material);
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
      uFishCount: { value: 0 },
      uFish: { value: Array.from({ length: MAX_FISH }, () => new Vector4()) },
    },
  });
  return new Mesh(geometry, material);
}

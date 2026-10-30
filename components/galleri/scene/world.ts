import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  type IUniform,
  Vector3,
  Vector4,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Painting } from '../types';
import { Canal } from './canal';
import { toWallPigment, type Rgb } from './colors';
import {
  FRAME_FRAGMENT,
  MAX_RIPPLES,
  PAINTING_FRAGMENT,
  REED_FRAGMENT,
  REED_VERTEX,
  SHADOW_FRAGMENT,
  WALL_FRAGMENT,
  WALL_VERTEX,
  WATER_FRAGMENT,
  WORLD_VERTEX,
} from './shaders';

const WALL_HEIGHT = 8;
// Walls run on below the water so that a disturbed reflection never samples past their foot.
const WALL_FOOT = -1.5;
const WALL_SEGMENTS = 480;
const HANG_HEIGHT = 0.62;
const PAINTING_AREA = 4.3;
const MAX_PAINTING_HEIGHT = 3.1;
const MAX_PAINTING_WIDTH = 2.7;
const FRAME_WIDTH = 0.035;
const BARE_WALL: Rgb = [0.86, 0.87, 0.82];

export type SharedUniforms = Record<'uPaper' | 'uResolution' | 'uEdge', IUniform>;

export interface HungPainting {
  painting: Painting;
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  uniforms: { uFrom: IUniform<Texture>; uTo: IUniform<Texture>; uBlend: IUniform<number> };
  s: number;
  side: 1 | -1;
  width: number;
  height: number;
  center: Vector3;
  /** Points out of the picture plane, towards the water. */
  normal: Vector3;
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** How far a flat picture must stand off this stretch of curved wall to clear it. */
function standOff(canal: Canal, s: number, side: 1 | -1, halfSpan: number) {
  const center = canal.wallPoint(s, side);
  const inwardX = -side * center.frame.nx;
  const inwardZ = -side * center.frame.nz;
  let furthest = 0;
  for (let i = -6; i <= 6; i++) {
    const point = canal.wallPoint(s + (i / 6) * halfSpan, side);
    furthest = Math.max(furthest, (point.x - center.x) * inwardX + (point.z - center.z) * inwardZ);
  }
  return furthest;
}

export function hangPaintings(
  canal: Canal,
  paintings: Painting[],
  shared: SharedUniforms,
  placeholder: (painting: Painting) => Texture,
): HungPainting[] {
  const spacing = canal.length / paintings.length;
  return paintings.map((painting, index) => {
    const s = (index + 0.5) * spacing;
    const side: 1 | -1 = index % 2 === 0 ? 1 : -1;
    const { width, height } = paintingSize(painting);
    const wall = canal.wallPoint(s, side);
    const normal = new Vector3(-side * wall.frame.nx, 0, -side * wall.frame.nz);
    const clearance = standOff(canal, s, side, width / 2 + 0.4) + 0.06;
    const center = new Vector3(wall.x, HANG_HEIGHT + height / 2, wall.z).addScaledVector(normal, clearance);

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
    return { painting, mesh, uniforms, s, side, width, height, center, normal };
  });
}

function placedOnWall(geometry: BufferGeometry, hung: HungPainting, back: number, drop = 0) {
  const matrix = new Matrix4().makeRotationY(hung.mesh.rotation.y);
  matrix.setPosition(hung.center.clone().addScaledVector(hung.normal, -back).setY(hung.center.y - drop));
  return geometry.applyMatrix4(matrix);
}

export function buildFrames(hung: HungPainting[], shared: SharedUniforms) {
  const pieces = hung.map((item) => {
    const box = new BoxGeometry(item.width + FRAME_WIDTH * 2, item.height + FRAME_WIDTH * 2, 0.05);
    // Without its back face, a frame seen from behind round a bend does not show as a dark slab.
    box.setIndex(Array.from(box.index?.array ?? []).slice(0, 30));
    return placedOnWall(box, item, 0.027);
  });
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

/** Each wall's colour along its length: bare plaster that takes on the pigment of nearby paintings. */
function buildToneTexture(canal: Canal, hung: HungPainting[]) {
  const columns = 256;
  const data = new Uint8Array(columns * 2 * 4);
  const sides: (1 | -1)[] = [1, -1];
  sides.forEach((side, row) => {
    const onWall = hung.filter((item) => item.side === side);
    for (let column = 0; column < columns; column++) {
      const s = (column / columns) * canal.length;
      let weightSum = 0.22;
      const mixed: Rgb = [BARE_WALL[0] * 0.22, BARE_WALL[1] * 0.22, BARE_WALL[2] * 0.22];
      for (const item of onWall) {
        const distance = canal.delta(s, item.s) / 3.4;
        const weight = Math.exp(-distance * distance);
        const pigment = toWallPigment(item.painting.palette[0]);
        weightSum += weight;
        mixed[0] += pigment[0] * weight;
        mixed[1] += pigment[1] * weight;
        mixed[2] += pigment[2] * weight;
      }
      const offset = (row * columns + column) * 4;
      data[offset] = (mixed[0] / weightSum) * 255;
      data[offset + 1] = (mixed[1] / weightSum) * 255;
      data[offset + 2] = (mixed[2] / weightSum) * 255;
      data[offset + 3] = 255;
    }
  });
  const texture = new DataTexture(data, columns, 2, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function buildWalls(canal: Canal, hung: HungPainting[], shared: SharedUniforms) {
  const columns = WALL_SEGMENTS + 1;
  const positions = new Float32Array(columns * 2 * 2 * 3);
  const normals = new Float32Array(columns * 2 * 2 * 3);
  const uvs = new Float32Array(columns * 2 * 2 * 2);
  const sideValues = new Float32Array(columns * 2 * 2);
  const indices: number[] = [];
  let vertex = 0;

  const sides: (1 | -1)[] = [1, -1];
  sides.forEach((side, row) => {
    const first = vertex;
    for (let i = 0; i < columns; i++) {
      const u = i / WALL_SEGMENTS;
      const point = canal.wallPoint(u * canal.length, side);
      for (let level = 0; level < 2; level++) {
        positions.set([point.x, level === 0 ? WALL_FOOT : WALL_HEIGHT, point.z], vertex * 3);
        normals.set([-side * point.frame.nx, 0, -side * point.frame.nz], vertex * 3);
        uvs.set([u, level], vertex * 2);
        sideValues[vertex] = row === 0 ? 0.25 : 0.75;
        vertex++;
      }
    }
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const a = first + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aSide', new BufferAttribute(sideValues, 1));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    vertexShader: WALL_VERTEX,
    fragmentShader: WALL_FRAGMENT,
    side: DoubleSide,
    uniforms: {
      ...shared,
      uTones: { value: buildToneTexture(canal, hung) },
      uLength: { value: canal.length },
    },
  });
  return new Mesh(geometry, material);
}

export function buildWater(canal: Canal, shared: SharedUniforms, reflection: Texture) {
  const positions = new Float32Array((WALL_SEGMENTS + 1) * 2 * 3);
  const uvs = new Float32Array((WALL_SEGMENTS + 1) * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i <= WALL_SEGMENTS; i++) {
    const s = (i / WALL_SEGMENTS) * canal.length;
    const outer = canal.wallPoint(s, 1);
    const inner = canal.wallPoint(s, -1);
    positions.set([outer.x, 0, outer.z, inner.x, 0, inner.z], i * 6);
    uvs.set([i / WALL_SEGMENTS, 1, i / WALL_SEGMENTS, 0], i * 4);
    if (i < WALL_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    side: DoubleSide,
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

const REED_COLORS: Rgb[] = [
  [0.16, 0.3, 0.2],
  [0.24, 0.4, 0.25],
  [0.38, 0.47, 0.25],
  [0.12, 0.25, 0.22],
];

/** Blades of reed along the waterline, drawn as tapered ribbons like the long strokes in the paintings. */
export function buildReeds(canal: Canal, hung: HungPainting[], shared: SharedUniforms) {
  const random = seededRandom(7);
  const segments = 5;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const clumps = Math.round(canal.length / 1.7);
  for (let clump = 0; clump < clumps; clump++) {
    const s = (clump + random() * 0.8) * (canal.length / clumps);
    const side: 1 | -1 = random() > 0.5 ? 1 : -1;
    const blocksPainting = hung.some(
      (item) => item.side === side && Math.abs(canal.delta(s, item.s)) < item.width / 2 + 0.25,
    );
    const blades = 4 + Math.floor(random() * 6);
    for (let blade = 0; blade < blades; blade++) {
      const along = s + (random() - 0.5) * 0.7;
      const base = canal.wallPoint(along, side, 0.1 + random() * 0.45);
      const tallest = blocksPainting ? 0.5 : 0.8 + random() * 0.8;
      const height = tallest * (0.55 + random() * 0.45);
      const width = 0.024 + random() * 0.03;
      const leanX = base.frame.nx * -side * (0.05 + random() * 0.3) + base.frame.tx * (random() - 0.5) * 0.45;
      const leanZ = base.frame.nz * -side * (0.05 + random() * 0.3) + base.frame.tz * (random() - 0.5) * 0.45;
      const sideways = random() * Math.PI;
      const sideX = Math.cos(sideways);
      const sideZ = Math.sin(sideways);
      const color = REED_COLORS[Math.floor(random() * REED_COLORS.length)];
      const first = positions.length / 3;

      for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments;
        const taper = width * Math.pow(1 - t, 0.7);
        const x = base.x + leanX * height * t * t;
        const y = height * t * (1 - 0.18 * t);
        const z = base.z + leanZ * height * t * t;
        positions.push(x - sideX * taper, y, z - sideZ * taper, x + sideX * taper, y, z + sideZ * taper);
        colors.push(...color, ...color);
        uvs.push(0, t, 1, t);
        if (segment < segments) {
          const a = first + segment * 2;
          indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    vertexShader: REED_VERTEX,
    fragmentShader: REED_FRAGMENT,
    side: DoubleSide,
    uniforms: { ...shared },
  });
  return new Mesh(geometry, material);
}

import { BufferAttribute, BufferGeometry, Matrix4, Mesh, ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexToRgb } from './colors';
import { FRAME_FRAGMENT, FRAME_VERTEX } from './shaders';
import type { HungPainting, SharedUniforms } from './world';

export type FrameFinish = 'wood' | 'gold' | 'paint';

export interface FrameStyle {
  finish: FrameFinish;
  color: string;
  /** Width of the frame's visible face, in metres. */
  width: number;
}

/**
 * The works are on canvas, so every frame is a floater: the canvas sits free inside it with a dark
 * shadow gap all round, and the edge of the canvas stays visible. Only the colour and weight differ,
 * chosen along the rules framers work by: look at the overall tone first, echo an accent rather than
 * the dominant colour, let a warm frame answer a cool picture and the other way round, keep a pale
 * work light, and give a dark one a lighter frame so it does not sink into the wall.
 */
const CHOSEN_FRAMES: Record<string, FrameStyle> = {
  // Green bathers: warm oak picks up the skin tones against the cool green.
  'd1fff15f-0c81-4720-a3b4-8e04e1a78045': { finish: 'wood', color: '#b08a58', width: 0.028 },
  // Green water and stones: muted old gold sits beside its yellows.
  '5db25a31-a982-414b-ba7c-8f4b15089fe1': { finish: 'gold', color: '#a98c4a', width: 0.036 },
  // Woman in a room: slim near-black echoes the dark gestural strokes.
  '0d1e5a41-7fa2-405c-aea2-6c09ffc7fa98': { finish: 'paint', color: '#2a2622', width: 0.024 },
  // Jumping girls: sage, from its small landscape, is the complement of the rose ground and makes it glow.
  '284a9aa5-1271-4931-8ff0-5a4dba594a57': { finish: 'paint', color: '#8fa48a', width: 0.03 },
  // Birds: silvered driftwood stays as pale and quiet as the picture.
  '29a8a582-ae20-4c34-a0d6-00bc53f35f04': { finish: 'wood', color: '#a7a08f', width: 0.026 },
  // Child in a red pinafore: pale oak, with a warmth taken from the ochre stroke.
  'bb57c9b2-4b5f-417a-9787-359368f06b74': { finish: 'wood', color: '#c2a273', width: 0.026 },
  // Sunflowers: slate, from the blue-greys at the foot, answers the yellow.
  'fe8e2166-7ea2-413d-bf1d-43026081e575': { finish: 'paint', color: '#4e5a66', width: 0.034 },
  // Girls in folk costume: dark and saturated, so a broader warm gold lifts it off the wall and answers its blues.
  '390a544f-5d38-4d4b-a6fa-d0c47ac2a413': { finish: 'gold', color: '#b4924e', width: 0.042 },
  // Sleeping child: only a slim pale ash, as light as the line drawing.
  '6a77cdea-5f51-4034-b0ad-a657e48aa886': { finish: 'wood', color: '#d3c5ab', width: 0.024 },
  // Tall pale girl: limed wood, the slightest of them, for the faintest of the pictures.
  'd0fe023c-505d-4323-9055-33f418c238a9': { finish: 'wood', color: '#cfc7b4', width: 0.022 },
  // Children on the rocks: pale straw repeats the swimming trunks against the cool blue-grey.
  'ee00cce0-ce19-4d0d-a9c8-48cf6d328eee': { finish: 'wood', color: '#d6c48f', width: 0.028 },
  // Figures on a beach: dark teal from its sky band answers the warm yellows.
  '1b724931-83d3-4637-855b-7a519fd322da': { finish: 'paint', color: '#3f6a6a', width: 0.032 },
  // Women in the water: dark walnut from the rocks.
  'be3389c7-ac50-432f-99ad-e3d5cb81ad19': { finish: 'wood', color: '#4a3527', width: 0.036 },
};

function hueAndTone(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return { lightness: (max + min) / 2, chroma: max - min, warm: r >= b };
}

/** For paintings added later: the same rules, worked out from the painting's palette. */
function frameFromPalette(palette: string[]): FrameStyle {
  const { lightness, chroma, warm } = hueAndTone(palette[0]);
  if (lightness > 0.72 && chroma < 0.2) return { finish: 'wood', color: '#c7ad84', width: 0.026 };
  if (lightness < 0.42) return { finish: 'gold', color: '#b4924e', width: 0.04 };
  return warm ? { finish: 'paint', color: '#55686a', width: 0.03 } : { finish: 'wood', color: '#b08a58', width: 0.03 };
}

export function frameFor(id: string, palette: string[]): FrameStyle {
  return CHOSEN_FRAMES[id] ?? frameFromPalette(palette);
}

const SHADOW_GAP = 0.016;

/** How far the frame reaches beyond the canvas, on each side. */
export function frameReach(style: FrameStyle) {
  return style.width + SHADOW_GAP;
}

const FINISH_CODE: Record<FrameFinish, number> = { wood: 0, gold: 1, paint: 2 };
const PLAIN_CODE = 3;
const GAP_COLOR = '#1b1917';
const CANVAS_DEPTH = 0.035;
const GAP_DEPTH = 0.05;
const FRAME_FRONT = 0.004;
const WALL_BEHIND = 0.075;

interface RingEdge {
  halfWidth: number;
  halfHeight: number;
  z: number;
}

class FrameBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly grain: number[] = [];
  private readonly colors: number[] = [];
  private readonly finishes: number[] = [];

  /** A band round the picture between two rectangles, with mitred corners. */
  ring(outer: RingEdge, inner: RingEdge, color: string, finish: number) {
    const [r, g, b] = hexToRgb(color);
    const corners = (edge: RingEdge) => [
      [-edge.halfWidth, -edge.halfHeight, edge.z],
      [edge.halfWidth, -edge.halfHeight, edge.z],
      [edge.halfWidth, edge.halfHeight, edge.z],
      [-edge.halfWidth, edge.halfHeight, edge.z],
    ];
    const out = corners(outer);
    const inn = corners(inner);
    for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4;
      const quad = [out[side], out[next], inn[next], inn[side]];
      const ax = quad[1][0] - quad[0][0];
      const ay = quad[1][1] - quad[0][1];
      const az = quad[1][2] - quad[0][2];
      const bx = quad[3][0] - quad[0][0];
      const by = quad[3][1] - quad[0][1];
      const bz = quad[3][2] - quad[0][2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const along = side % 2 === 0 ? 0 : 1;
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const vertex = quad[index];
        this.positions.push(vertex[0], vertex[1], vertex[2]);
        this.normals.push(nx, ny, nz);
        // Grain runs along the moulding, and differs from side to side.
        this.grain.push(vertex[along] + side * 3.7, index === 0 || index === 1 ? 0 : 1);
        this.colors.push(r, g, b);
        this.finishes.push(finish);
      }
    }
  }

  build() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.grain), 2));
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('aFinish', new BufferAttribute(new Float32Array(this.finishes), 1));
    return geometry;
  }
}

function buildFrame(item: HungPainting) {
  const { frame: style } = item;
  const builder = new FrameBuilder();
  const w = item.width / 2;
  const h = item.height / 2;
  const finish = FINISH_CODE[style.finish];
  const edge = (reach: number, z: number): RingEdge => ({ halfWidth: w + reach, halfHeight: h + reach, z });
  const inner = SHADOW_GAP;
  const outer = SHADOW_GAP + style.width;

  // The turned edge of the canvas, in the painting's own main colour.
  builder.ring(edge(0, -CANVAS_DEPTH), edge(0, 0), item.painting.palette[0], PLAIN_CODE);
  // The shadow gap the canvas floats in.
  builder.ring(edge(inner, -GAP_DEPTH), edge(0, -GAP_DEPTH), GAP_COLOR, PLAIN_CODE);
  // The frame: its inside wall, its slim front, and its outside.
  builder.ring(edge(inner, FRAME_FRONT), edge(inner, -GAP_DEPTH), style.color, finish);
  builder.ring(edge(outer, FRAME_FRONT), edge(inner, FRAME_FRONT), style.color, finish);
  builder.ring(edge(outer, -WALL_BEHIND), edge(outer, FRAME_FRONT), style.color, finish);

  const geometry = builder.build();
  const matrix = new Matrix4().makeRotationY(item.mesh.rotation.y);
  matrix.setPosition(item.center);
  return geometry.applyMatrix4(matrix);
}

export function buildFrames(hung: HungPainting[], shared: SharedUniforms) {
  const material = new ShaderMaterial({
    vertexShader: FRAME_VERTEX,
    fragmentShader: FRAME_FRAGMENT,
    uniforms: { ...shared },
  });
  return new Mesh(mergeGeometries(hung.map(buildFrame)), material);
}

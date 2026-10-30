import {
  DataTexture,
  Frustum,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  Sphere,
  Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import type { Painting } from '../types';
import { hexToRgb } from './colors';
import type { HungPainting } from './world';

const MAX_LARGE = 4;
const MAX_LOADING = 2;
const BLEND_SECONDS = 0.7;

type Tier = 0 | 1 | 2;

interface Slot {
  hung: HungPainting;
  tier: Tier;
  loading: boolean;
  blending: boolean;
  /** A failed upgrade is not tried again until the next visit. */
  failed: boolean;
  textures: Texture[];
  distance: number;
  bounds: Sphere;
}

/** The sharp version is only worth loading once the picture fills a good part of the view. */
function largeRange(slot: Slot) {
  return Math.max(5, slot.hung.height * 2.4);
}

export function createToneTexture(painting: Painting) {
  const [r, g, b] = hexToRgb(painting.palette[0]);
  const texture = new DataTexture(new Uint8Array([r * 255, g * 255, b * 255, 255]), 1, 1, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** Keeps each painting at the lowest resolution that looks right from where the visitor is. */
export class PaintingTextures {
  private readonly slots: Slot[];
  private readonly anisotropy: number;
  private loading = 0;
  private disposed = false;

  constructor(
    hung: HungPainting[],
    private readonly renderer: WebGLRenderer,
    private readonly touch: boolean,
    private readonly instantBlend: boolean,
    private readonly onChange: () => void,
  ) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.slots = hung.map((item) => ({
      hung: item,
      tier: 0,
      loading: false,
      blending: false,
      failed: false,
      textures: [item.uniforms.uFrom.value],
      distance: Infinity,
      bounds: new Sphere(item.center, Math.hypot(item.width, item.height) / 2),
    }));
    this.slots.forEach((slot) => this.loadPreview(slot));
  }

  get busy() {
    return this.slots.some((slot) => slot.blending);
  }

  private loadPreview(slot: Slot) {
    const { lqip } = slot.hung.painting;
    if (!lqip) return;
    const image = new Image();
    image.onload = () => {
      if (this.disposed || slot.tier > 0) return;
      const texture = new Texture(image);
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      slot.textures[0].dispose();
      slot.textures[0] = texture;
      slot.hung.uniforms.uFrom.value = texture;
      slot.hung.uniforms.uTo.value = texture;
      this.onChange();
    };
    image.src = lqip;
  }

  private async load(slot: Slot, tier: 1 | 2) {
    const { texture: urls } = slot.hung.painting;
    const url = tier === 1 ? urls.medium : this.touch ? urls.largeTouch : urls.large;
    slot.loading = true;
    this.loading++;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (this.disposed) return;
      const texture = new Texture(image);
      texture.minFilter = LinearMipmapLinearFilter;
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      this.renderer.initTexture(texture);
      slot.textures[tier] = texture;
      slot.tier = tier;
      slot.hung.uniforms.uTo.value = texture;
      slot.hung.uniforms.uBlend.value = this.instantBlend ? 1 : 0;
      slot.blending = true;
    } catch {
      // The softer version stays on the wall.
      slot.failed = true;
    } finally {
      slot.loading = false;
      this.loading--;
      if (!this.disposed) this.onChange();
    }
  }

  /** Call once per rendered frame. `isNearby` says which rooms can be seen, `settled` that the visitor has come to rest. */
  update(camera: Vector3, frustum: Frustum, isNearby: (hung: HungPainting) => boolean, settled: boolean, dt: number) {
    for (const slot of this.slots) {
      slot.distance = camera.distanceTo(slot.hung.center);
      const visible = isNearby(slot.hung) && frustum.intersectsSphere(slot.bounds);

      if (slot.blending) {
        const uniforms = slot.hung.uniforms;
        uniforms.uBlend.value = Math.min(1, uniforms.uBlend.value + dt / BLEND_SECONDS);
        if (uniforms.uBlend.value >= 1) {
          uniforms.uFrom.value = uniforms.uTo.value;
          uniforms.uBlend.value = 0;
          slot.blending = false;
        }
      }

      if (slot.loading || slot.blending || slot.failed || this.loading >= MAX_LOADING) continue;
      if (slot.tier < 1 && visible) void this.load(slot, 1);
      else if (slot.tier === 1 && settled && visible && slot.distance < largeRange(slot)) void this.load(slot, 2);
    }
    this.evict();
  }

  private evict() {
    const large = this.slots.filter((slot) => slot.tier === 2 && !slot.blending);
    if (large.length <= MAX_LARGE) return;
    const furthest = large.reduce((a, b) => (b.distance > a.distance ? b : a));
    if (furthest.distance < largeRange(furthest)) return;
    furthest.hung.uniforms.uFrom.value = furthest.textures[1];
    furthest.hung.uniforms.uTo.value = furthest.textures[1];
    furthest.textures[2].dispose();
    furthest.textures.length = 2;
    furthest.tier = 1;
  }

  dispose() {
    this.disposed = true;
    this.slots.forEach((slot) => slot.textures.forEach((texture) => texture.dispose()));
  }
}


import {
  Color,
  ColorManagement,
  Frustum,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type Mesh,
  type ShaderMaterial,
} from 'three';
import type { Painting, ScreenRect } from '../types';
import { hexToRgb } from './colors';
import { FloorPlan, type Point } from './floorPlan';
import { MAX_RIPPLES } from './shaders';
import { RoomLife } from './life';
import { createToneTexture, PaintingTextures } from './textures';
import { EYE_HEIGHT, Walker, yawTowards, type Facing } from './walker';
import {
  buildDeck,
  buildDoorFrames,
  buildFrames,
  buildShadows,
  buildWalls,
  buildWater,
  hangPaintings,
  type HungPainting,
  type SharedUniforms,
} from './world';

const PAPER = '#f5f3ed';
const RIPPLE_LIFE = 5.5;
const AGITATION_DECAY = 1.1;
const WAKE_SPACING = 1;
const TAP_SLOP = 8;
const WHEEL_PUSH = 0.0035;
const LIFE_FIRST_EVENT = 4500;
const LIFE_MIN_REST = 9000;
const LIFE_EXTRA_REST = 13000;
const LIFE_IDLE_LIMIT = 120000;
const QUALITY_LEVELS = [
  { pixelRatio: 1.75, reflection: 0.5, ripples: MAX_RIPPLES },
  { pixelRatio: 1.25, reflection: 0.5, ripples: 6 },
  { pixelRatio: 1, reflection: 0.34, ripples: 4 },
];

export interface GalleryScene {
  /** Walk to a painting. */
  walkToPainting(index: number): void;
  /** Stand in front of a painting without drawing anything; the room is out of sight. */
  placeAt(index: number): void;
  /** Where a painting is on screen, in viewport pixels. Null if it is not in view. */
  paintingRect(index: number): ScreenRect | null;
  /** Stops all drawing while the room is covered. */
  setCovered(covered: boolean): void;
  dispose(): void;
}

interface SceneOptions {
  host: HTMLElement;
  paintings: Painting[];
  reducedMotion: boolean;
  onCurrentChange(index: number): void;
  onOpen(index: number): void;
  onFirstMove(): void;
  onReady(): void;
  onFailure(): void;
}

const MOVE_KEYS: Record<string, keyof MoveKeys> = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'back',
  KeyS: 'back',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export function createGalleryScene(options: SceneOptions): GalleryScene {
  const { host, paintings, reducedMotion } = options;
  ColorManagement.enabled = false;

  const canvas = document.createElement('canvas');
  canvas.className = 'absolute inset-0 h-full w-full';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(new Color(PAPER), 1);

  const touch = window.matchMedia('(pointer: coarse)').matches;
  let quality = 0;

  const scene = new Scene();
  const camera = new PerspectiveCamera(52, 1, 0.1, 70);
  const mirrorCamera = new PerspectiveCamera(52, 1, 0.1, 70);
  const reflectionTarget = new WebGLRenderTarget(4, 4, { minFilter: LinearFilter, magFilter: LinearFilter, samples: 4 });

  const shared: SharedUniforms = {
    uPaper: { value: new Vector3(...hexToRgb(PAPER)) },
    uResolution: { value: new Vector2(1, 1) },
    uEdge: { value: 1 },
  };

  const plan = new FloorPlan(paintings.length);
  const hung = hangPaintings(plan, paintings, shared, createToneTexture);
  const water = buildWater(plan, shared, reflectionTarget.texture) as Mesh<never, ShaderMaterial>;
  const shadows = buildShadows(hung);
  scene.add(
    buildWalls(plan, hung, shared),
    buildFrames(hung, shared),
    buildDoorFrames(plan, shared),
    buildDeck(plan, shared),
    shadows,
    water,
  );
  hung.forEach((item) => scene.add(item.mesh));
  const paintingMeshes = hung.map((item) => item.mesh);

  const ripples = water.material.uniforms.uRipples.value as Vector4[];
  let nextRipple = 0;

  // Rendering state: nothing is drawn unless `frameRequested` is set.
  let frameHandle = 0;
  let needsFrame = false;
  let covered = false;
  let offscreen = false;
  let disposed = false;
  let lastTime = 0;
  let clock = 0;
  let agitation = reducedMotion ? 0 : 0.6;
  let wakeBuildUp = 0;
  let slowFrames = 0;
  let measuredFrames = 0;
  let measuredTime = 0;
  let width = 1;
  let height = 1;
  let currentIndex = -1;
  let moved = false;
  let lifeTimer = 0;
  let lastInteraction = performance.now();

  const keys: MoveKeys = { forward: false, back: false, left: false, right: false };
  const frustum = new Frustum();
  const projection = new Matrix4();
  const cameraPosition = new Vector3();

  /** The place on the path with the best view of a painting, and the look that goes with it. */
  function viewingPose(item: HungPainting): Point & Facing {
    const halfVertical = (camera.fov * Math.PI) / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
    const fitHeight = item.height / (0.46 * 2 * Math.tan(halfVertical));
    const fitWidth = item.width / (0.78 * 2 * Math.tan(halfHorizontal));
    const ideal = Math.max(1.8, fitHeight, fitWidth);
    const spot = plan.nearestClear(item.center.x + item.normal.x * ideal, item.center.z + item.normal.z * ideal);
    const distance = Math.hypot(item.center.x - spot.x, item.center.z - spot.z);
    return {
      ...spot,
      yaw: yawTowards(item.center.x - spot.x, item.center.z - spot.z),
      // Looks a little below the picture's centre, so its reflection stays in view.
      pitch: Math.atan2(item.center.y - EYE_HEIGHT, distance) - 0.16,
    };
  }

  /** The first view: from the path, over the water, with a painting ahead and the next door in sight. */
  function openingPose(distanceBack: number): Point & Facing {
    const room = plan.rooms[0];
    const middle = { x: (room.x0 + room.x1) / 2, z: (room.z0 + room.z1) / 2 };
    const spot = plan.nearestClear(middle.x, middle.z + 2.6 + distanceBack);
    const narrow = host.clientWidth < host.clientHeight;
    const target = narrow ? hung[0].center : { x: middle.x + 1.5, z: room.z0 };
    return { ...spot, yaw: yawTowards(target.x - spot.x, target.z - spot.z), pitch: -0.12 };
  }

  /** Walk along the path to a place, then turn the way `face` says. */
  function walkTo(target: Point, face: Facing | null, smoothTime?: number) {
    walker.follow(plan.route({ x: walker.x, z: walker.z }, target), face, smoothTime);
  }

  const walker = new Walker(plan, openingPose(reducedMotion ? 0 : 1));
  const life = new RoomLife(plan, scene, shared, water.material.uniforms, addRipple);
  const textures = new PaintingTextures(hung, renderer, touch, reducedMotion, requestFrame);

  function applyCameraPose() {
    camera.position.set(walker.x, EYE_HEIGHT, walker.z);
    camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    mirrorCamera.position.set(walker.x, -EYE_HEIGHT, walker.z);
    mirrorCamera.rotation.set(-walker.pitch, walker.yaw, 0, 'YXZ');
    mirrorCamera.updateMatrixWorld();
  }

  function resize() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    const level = QUALITY_LEVELS[quality];
    const ratio = Math.min(window.devicePixelRatio || 1, touch ? Math.min(level.pixelRatio, 1.5) : level.pixelRatio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    shared.uResolution.value.set(width * ratio, height * ratio);
    reflectionTarget.setSize(
      Math.max(2, Math.round(width * ratio * level.reflection)),
      Math.max(2, Math.round(height * ratio * level.reflection)),
    );
    water.material.uniforms.uRippleCount.value = level.ripples;

    const aspect = width / height;
    const narrowness = Math.max(0, Math.min(1, (1.3 - aspect) / 0.85));
    camera.fov = 50 + narrowness * 22;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    mirrorCamera.fov = camera.fov;
    mirrorCamera.aspect = aspect;
    mirrorCamera.updateProjectionMatrix();
    requestFrame();
  }

  function addRipple(x: number, z: number, strength: number) {
    if (reducedMotion) return;
    ripples[nextRipple].set(x, z, clock, strength);
    nextRipple = (nextRipple + 1) % ripples.length;
  }

  function ripplesAlive() {
    let alive = false;
    for (const ripple of ripples) {
      if (ripple.w > 0 && clock - ripple.z > RIPPLE_LIFE) ripple.w = 0;
      if (ripple.w > 0) alive = true;
    }
    return alive;
  }

  function reportCurrent() {
    let best = 0;
    let bestScore = Infinity;
    const lookX = -Math.sin(walker.yaw);
    const lookZ = -Math.cos(walker.yaw);
    const room = plan.roomAt(walker.x, walker.z);
    hung.forEach((item, index) => {
      const dx = item.center.x - walker.x;
      const dz = item.center.z - walker.z;
      const distance = Math.hypot(dx, dz);
      const ahead = (dx * lookX + dz * lookZ) / (distance || 1);
      const score = distance + (1 - ahead) * 14 + (item.room === room ? 0 : 8);
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best !== currentIndex) {
      currentIndex = best;
      options.onCurrentChange(best);
    }
  }

  function draw() {
    applyCameraPose();
    water.visible = false;
    shadows.visible = false;
    life.setMirrorPass(true);
    shared.uEdge.value = 0;
    renderer.setRenderTarget(reflectionTarget);
    renderer.render(scene, mirrorCamera);

    life.setMirrorPass(false);
    water.visible = true;
    shadows.visible = true;
    shared.uEdge.value = 1;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    cameraPosition.copy(camera.position);
  }

  function watchFrameRate(dt: number) {
    measuredFrames++;
    measuredTime += dt;
    if (measuredFrames < 24) return;
    const average = measuredTime / measuredFrames;
    measuredFrames = 0;
    measuredTime = 0;
    slowFrames = average > 1 / 28 ? slowFrames + 1 : 0;
    if (slowFrames >= 1 && quality < QUALITY_LEVELS.length - 1) {
      quality++;
      slowFrames = 0;
      life.setCoarseFur(true);
      resize();
    }
  }

  function requestFrame() {
    needsFrame = true;
    schedule();
  }

  function schedule() {
    if (frameHandle || disposed || covered || offscreen || document.hidden) return;
    frameHandle = requestAnimationFrame(onFrame);
  }

  function onFrame(now: number) {
    frameHandle = 0;
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60;
    lastTime = now;
    clock += dt;

    const thrust = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    walker.step(dt, { thrust, turn });

    const speed = walker.speed;
    if (!reducedMotion) {
      agitation = Math.max(agitation * Math.exp(-dt / AGITATION_DECAY), Math.min(speed / 5, 0.45));
      if (agitation < 0.004) agitation = 0;
      wakeBuildUp += speed * dt;
      if (wakeBuildUp > WAKE_SPACING) {
        wakeBuildUp = 0;
        const aheadX = -Math.sin(walker.yaw);
        const aheadZ = -Math.cos(walker.yaw);
        // Each step sends a ring out from beside the boards.
        const across = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 0.6);
        addRipple(walker.x + aheadX * 1.8 - aheadZ * across, walker.z + aheadZ * 1.8 + aheadX * across, 0.32);
      }
    }
    life.update(dt, walker);
    water.material.uniforms.uAgitation.value = agitation;
    water.material.uniforms.uTime.value = clock;

    draw();
    needsFrame = false;
    const room = plan.roomAt(walker.x, walker.z);
    textures.update(cameraPosition, frustum, (item) => plan.areNeighbours(room, item.room), speed < 0.15, dt);
    reportCurrent();
    if (walker.speed > 0.02 || thrust !== 0 || turn !== 0 || life.busy) watchFrameRate(dt);

    const busy =
      walker.moving || agitation > 0 || ripplesAlive() || textures.busy || life.busy || thrust !== 0 || turn !== 0 || dragging;
    if (busy || needsFrame) schedule();
    else lastTime = 0;
  }

  /** Now and then something happens in the room, and only then is it drawn. Long idle stops even this. */
  function scheduleLife(delay = LIFE_MIN_REST + Math.random() * LIFE_EXTRA_REST) {
    lifeTimer = window.setTimeout(() => {
      const watched = !covered && !offscreen && !document.hidden;
      const recentlyActive = performance.now() - lastInteraction < LIFE_IDLE_LIMIT;
      if (watched && recentlyActive && quality < QUALITY_LEVELS.length - 1 && !life.busy) {
        life.startEpisode(walker, camera);
        requestFrame();
      }
      scheduleLife();
    }, delay);
  }

  function noteFirstMove() {
    if (moved) return;
    moved = true;
    options.onFirstMove();
  }

  // ---- Pointer ----

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let dragging = false;
  let pointerDown = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerLastX = 0;
  let pointerLastY = 0;
  let pointerLastTime = 0;
  let lastHoverCheck = 0;
  let tapPending = false;

  function setRay(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    applyCameraPose();
    raycaster.setFromCamera(pointer, camera);
  }

  function clearLineOfSight(x: number, z: number) {
    const dx = x - walker.x;
    const dz = z - walker.z;
    const distance = Math.hypot(dx, dz);
    for (let t = 0.2; t < distance - 0.15; t += 0.2) {
      if (!plan.contains(walker.x + (dx / distance) * t, walker.z + (dz / distance) * t)) return false;
    }
    return true;
  }

  function paintingUnderRay() {
    const hit = raycaster.intersectObjects(paintingMeshes, false)[0];
    if (!hit || !clearLineOfSight(hit.point.x, hit.point.z)) return -1;
    return paintingMeshes.indexOf(hit.object as (typeof paintingMeshes)[number]);
  }

  /** Where a tap lands on the water: the spot itself, or the foot of the wall if it was on a wall. */
  function waterUnderRay() {
    const { origin, direction } = raycaster.ray;
    const flat = Math.hypot(direction.x, direction.z) || 1;
    const dirX = direction.x / flat;
    const dirZ = direction.z / flat;
    const waterDistance = direction.y < -0.001 ? (-origin.y / direction.y) * flat : Infinity;
    let x = origin.x;
    let z = origin.z;
    for (let t = 0.2; t < 45; t += 0.2) {
      if (t > waterDistance) {
        x = origin.x + dirX * waterDistance;
        z = origin.z + dirZ * waterDistance;
        break;
      }
      const nextX = origin.x + dirX * t;
      const nextZ = origin.z + dirZ * t;
      if (!plan.contains(nextX, nextZ)) break;
      x = nextX;
      z = nextZ;
    }
    return { x, z };
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    lastInteraction = performance.now();
    host.focus({ preventScroll: true });
    pointerDown = true;
    dragging = false;
    pointerStartX = pointerLastX = event.clientX;
    pointerStartY = pointerLastY = event.clientY;
    pointerLastTime = event.timeStamp;
    canvas.setPointerCapture(event.pointerId);
    walker.yawDrift = 0;
    walker.pitchDrift = 0;
  }

  function onPointerMove(event: PointerEvent) {
    if (!pointerDown) {
      if (event.pointerType === 'mouse' && event.timeStamp - lastHoverCheck > 40) {
        lastHoverCheck = event.timeStamp;
        setRay(event.clientX, event.clientY);
        canvas.style.cursor = paintingUnderRay() >= 0 ? 'pointer' : 'grab';
      }
      return;
    }
    const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
    if (!dragging && distance < TAP_SLOP) return;
    if (!dragging) {
      dragging = true;
      canvas.style.cursor = 'grabbing';
      noteFirstMove();
    }

    const perPixel = ((camera.fov * Math.PI) / 180 / height) * 1.05;
    const dx = event.clientX - pointerLastX;
    const dy = event.clientY - pointerLastY;
    const elapsed = Math.max((event.timeStamp - pointerLastTime) / 1000, 0.004);
    walker.look(dx * perPixel, dy * perPixel);
    if (!reducedMotion) {
      walker.yawDrift = walker.yawDrift * 0.6 + ((dx * perPixel) / elapsed) * 0.4;
      walker.pitchDrift = walker.pitchDrift * 0.6 + ((dy * perPixel) / elapsed) * 0.4;
    }
    pointerLastX = event.clientX;
    pointerLastY = event.clientY;
    pointerLastTime = event.timeStamp;
    requestFrame();
  }

  function onPointerUp(event: PointerEvent) {
    if (!pointerDown) return;
    pointerDown = false;
    canvas.style.cursor = 'grab';
    if (dragging) {
      dragging = false;
      if (event.timeStamp - pointerLastTime > 90) {
        walker.yawDrift = 0;
        walker.pitchDrift = 0;
      }
      requestFrame();
      return;
    }

    tapPending = true;
  }

  // Taps are acted on at `click`, the last event of the gesture, so a dialog that opens
  // here cannot receive the rest of the gesture and close again.
  function onClick(event: MouseEvent) {
    if (!tapPending) return;
    tapPending = false;
    setRay(event.clientX, event.clientY);
    const index = paintingUnderRay();
    if (index >= 0) {
      noteFirstMove();
      options.onOpen(index);
      return;
    }
    const spot = waterUnderRay();
    noteFirstMove();
    addRipple(spot.x, spot.z, 1);
    const target = plan.nearestClear(spot.x, spot.z);
    if (reducedMotion) walker.placeAt(target.x, target.z, walker.yaw, walker.pitch);
    else walkTo(target, null);
    requestFrame();
  }

  function onWheel(event: WheelEvent) {
    if (event.ctrlKey || covered) return;
    lastInteraction = performance.now();
    if (host.getBoundingClientRect().top < -4) return;
    event.preventDefault();
    noteFirstMove();
    const scale = event.deltaMode === 1 ? 24 : 1;
    walker.push(-event.deltaY * scale * WHEEL_PUSH);
    requestFrame();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    lastInteraction = performance.now();
    if (event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault();
      if (currentIndex >= 0) options.onOpen(currentIndex);
      return;
    }
    const key = MOVE_KEYS[event.code];
    if (!key) return;
    event.preventDefault();
    keys[key] = true;
    noteFirstMove();
    requestFrame();
  }

  function onKeyUp(event: KeyboardEvent) {
    const key = MOVE_KEYS[event.code];
    if (!key) return;
    keys[key] = false;
    requestFrame();
  }

  function releaseKeys() {
    keys.forward = keys.back = keys.left = keys.right = false;
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      lastTime = 0;
      releaseKeys();
    } else {
      requestFrame();
    }
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    options.onFailure();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('webglcontextlost', onContextLost);
  host.addEventListener('keydown', onKeyDown);
  host.addEventListener('keyup', onKeyUp);
  host.addEventListener('blur', releaseKeys);
  document.addEventListener('visibilitychange', onVisibility);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      offscreen = !entry.isIntersecting;
      if (offscreen) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        lastTime = 0;
      } else {
        requestFrame();
      }
    },
    { threshold: 0.02 },
  );
  intersectionObserver.observe(host);

  resize();
  applyCameraPose();
  canvas.style.cursor = 'grab';
  if (!reducedMotion) {
    const settled = openingPose(0);
    walker.follow([{ x: walker.x, z: walker.z }, settled], settled, 2.2);
  }
  if (!reducedMotion) scheduleLife(LIFE_FIRST_EVENT);
  requestFrame();
  options.onReady();

  return {
    walkToPainting(index) {
      const pose = viewingPose(hung[index]);
      noteFirstMove();
      if (reducedMotion) walker.placeAt(pose.x, pose.z, pose.yaw, pose.pitch);
      else walkTo(pose, pose);
      requestFrame();
    },
    placeAt(index) {
      const pose = viewingPose(hung[index]);
      walker.placeAt(pose.x, pose.z, pose.yaw, pose.pitch);
      agitation = 0;
      ripples.forEach((ripple) => ripple.setW(0));
      currentIndex = index;
      options.onCurrentChange(index);
    },
    paintingRect(index) {
      applyCameraPose();
      const item = hung[index];
      const canvasRect = canvas.getBoundingClientRect();
      const corner = new Vector3();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        corner.set((x * item.width) / 2, (y * item.height) / 2, 0).applyMatrix4(item.mesh.matrixWorld);
        corner.project(camera);
        if (corner.z > 1) return null;
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
      }
      if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return null;
      return {
        x: canvasRect.left + ((minX + 1) / 2) * canvasRect.width,
        y: canvasRect.top + ((1 - maxY) / 2) * canvasRect.height,
        width: ((maxX - minX) / 2) * canvasRect.width,
        height: ((maxY - minY) / 2) * canvasRect.height,
      };
    },
    setCovered(next) {
      if (covered === next) return;
      covered = next;
      if (covered) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        lastTime = 0;
        releaseKeys();
      } else {
        draw();
        requestFrame();
      }
    },
    dispose() {
      disposed = true;
      window.clearTimeout(lifeTimer);
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('keyup', onKeyUp);
      host.removeEventListener('blur', releaseKeys);
      document.removeEventListener('visibilitychange', onVisibility);
      textures.dispose();
      reflectionTarget.dispose();
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as ShaderMaterial).dispose();
        if (object instanceof InstancedMesh) object.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

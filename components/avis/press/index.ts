import type { CreatePress, Press } from '../types';
import { bindTexture, byteTexture, emptyTexture, link, locate } from './gl';
import { grainTile } from './paper';
import { loadFonts, paperColor, prepareImages, rasterize } from './rasterize';
import { FLAT_FS, FLAT_VS, PAGE_FS, PAGE_VS } from './shaders';
import { createSheet, gridFor, type Sheet, type Side } from './sheet';

const MAX_IN_AIR = 3;
const STAGGER = 0.16;
const FLICK = 500;
const PRINT_MS = 450;
const SHADE_W = 64;
const SHADE_H = 40;
const SHADOW_X = 0.35;
const SHADOW_Y = 0.45;

interface Leaf {
  recto: HTMLElement;
  verso: HTMLElement | null;
}

interface Face {
  texture: WebGLTexture;
  whole: boolean;
  /** The sheet without its images, while the images print in. */
  old: WebGLTexture | null;
  printAt: number;
}

interface Flight {
  leaf: number;
  sheet: Sheet;
  mesh: Mesh;
  lift: boolean;
  /** Seconds until a hint lets go. */
  until: number;
}

interface Mesh {
  vao: WebGLVertexArrayObject;
  pos: WebGLBuffer;
  nrm: WebGLBuffer;
  loose: WebGLBuffer;
  uv: WebGLBuffer;
  count: number;
}

interface Drag {
  x0: number;
  y0: number;
  flight: Flight | null;
  forward: boolean;
  cos: number;
}

const build: CreatePress = (options) => {
  const { canvas, sheets, mode, force, onReady, onStop, onFail } = options;
  const strip = mode === 'strip';

  const leaves: Leaf[] = [];
  if (strip) {
    sheets.querySelectorAll<HTMLElement>('[data-stop="strip"]').forEach((recto) => leaves.push({ recto, verso: null }));
  } else {
    const pages = sheets.querySelectorAll<HTMLElement>('[data-page]');
    for (let i = 0; i + 1 < pages.length; i += 2) leaves.push({ recto: pages[i], verso: pages[i + 1] });
  }
  const stops = sheets.querySelectorAll<HTMLElement>(`[data-stop="${mode}"]`);
  const lastStop = stops.length - 1;
  if (!leaves.length || lastStop < 0) return null;

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: true,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: !force,
  });
  if (!gl) return null;

  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const scarce = (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true;
  const dpr = Math.min(window.devicePixelRatio || 1, scarce ? 1.5 : 2);
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  const pageProgram = link(gl, PAGE_VS, PAGE_FS);
  const flatProgram = link(gl, FLAT_VS, FLAT_FS);
  const pageU = locate(gl, pageProgram, ['uView', 'uEye', 'uAt', 'uD', 'uF', 'uB', 'uOld', 'uGrain', 'uShade', 'uSize', 'uRes', 'uPaper', 'uPrint', 'uCast'] as const);
  const flatU = locate(gl, flatProgram, ['uView', 'uRect', 'uSoft', 'uShade', 'uTint', 'uRes', 'uUseShade'] as const);
  const grain = byteTexture(gl, 256, 256, grainTile(256), gl.REPEAT);
  const shadeBytes = new Uint8Array(SHADE_W * SHADE_H);
  const shadeField = new Float32Array(SHADE_W * SHADE_H);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const shade = byteTexture(gl, SHADE_W, SHADE_H, shadeBytes, gl.CLAMP_TO_EDGE);
  const emptyVao = gl.createVertexArray();
  const quadVao = gl.createVertexArray();
  const quadBuffer = gl.createBuffer();
  const blank = emptyTexture(gl, gl.CLAMP_TO_EDGE);
  gl.frontFace(gl.CW);
  gl.depthFunc(gl.LEQUAL);

  const paint2d = document.createElement('canvas').getContext('2d');
  if (!paint2d) return null;

  const paper = paperColor(leaves[0].recto, sheets);
  const paperRgb = (paper.match(/[\d.]+/g) ?? ['239', '233', '219']).slice(0, 3).map((v) => Number(v) / 255);

  let viewW = 1;
  let viewH = 1;
  let pw = 1;
  let ph = 1;
  let top = 0;
  let hinges: number[] = [];
  let aspect = 1;

  let at = clamp(options.stop, 0, lastStop);
  let goal = at;
  let leftShown = at - 1;
  let rightShown = at;
  let hinge = 0;
  const flights: Flight[] = [];
  const pool: { sheet: Sheet; mesh: Mesh }[] = [];
  const free: { sheet: Sheet; mesh: Mesh }[] = [];
  const faces = new Map<HTMLElement, Face>();
  const asked = new WeakSet<HTMLElement>();
  const stale = new Set<HTMLElement>();

  let drag: Drag | null = null;
  let gap = 0;
  let raf = 0;
  let last = 0;
  let dirty = true;
  let dead = false;
  let ready = false;
  let idle = 0;
  let turnFrames = 0;
  let turnTime = 0;

  const dropFace = (el: HTMLElement, face: Face) => {
    gl.deleteTexture(face.texture);
    if (face.old) gl.deleteTexture(face.old);
    faces.delete(el);
  };

  const releaseAll = () => {
    faces.forEach((face, el) => dropFace(el, face));
    for (const { mesh } of pool) {
      gl.deleteVertexArray(mesh.vao);
      for (const buffer of [mesh.pos, mesh.nrm, mesh.loose, mesh.uv]) gl.deleteBuffer(buffer);
    }
    pool.length = free.length = 0;
  };

  const measure = () => {
    // A sheet in the air looms past the stage, so the canvas reaches beyond it,
    // though never past the end of the document, which would add a scrollbar.
    canvas.style.top = canvas.style.height = '';
    const stage = canvas.getBoundingClientRect();
    const near = leaves[0].recto.getBoundingClientRect();
    const eyeDistance = 1.8 * Math.max(stage.width, stage.height);
    const reach = Math.ceil((near.height / 2) * (eyeDistance / (eyeDistance - 0.9 * near.width) - 1)) + 8;
    const room = document.documentElement.scrollHeight - stage.bottom - window.scrollY;
    const below = clamp(room, 0, reach);
    canvas.style.top = `${-reach}px`;
    canvas.style.height = `${stage.height + reach + below}px`;
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.max(Math.round(box.width * dpr), 1);
    canvas.height = Math.max(Math.round(box.height * dpr), 1);
    viewW = canvas.width / dpr;
    viewH = canvas.height / dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);

    const scroller = sheets.getBoundingClientRect();
    const slack = sheets.scrollWidth - sheets.clientWidth;
    // Where each stop sits once the scroller is pinned to it, whatever it shows now.
    const pinned = (el: HTMLElement, stop: number) => {
      const target = stops[stop].getBoundingClientRect();
      const center = target.left + target.width / 2 - scroller.left + sheets.scrollLeft;
      return el.getBoundingClientRect().left + sheets.scrollLeft - clamp(center - sheets.clientWidth / 2, 0, slack) - box.left;
    };
    const first = leaves[0].recto.getBoundingClientRect();
    pw = Math.round(first.width * dpr) / dpr;
    ph = Math.round(first.height * dpr) / dpr;
    aspect = ph / pw;
    top = snap(first.top - box.top);
    hinges = Array.from(stops, (_, stop) => {
      if (strip) return snap(pinned(leaves[stop].recto, stop));
      if (stop < leaves.length) return snap(pinned(leaves[stop].recto, stop));
      const verso = leaves[stop - 1].verso as HTMLElement;
      return snap(pinned(verso, stop) + pw);
    });

    paint2d.canvas.width = Math.round(pw * dpr);
    paint2d.canvas.height = Math.round(ph * dpr);

    const quad = new Float32Array(72);
    let o = 0;
    for (const side of [1, -1]) {
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        quad.set([side * u, v * aspect, 0, 0, 0, side, 0, u, v], o);
        o += 9;
      }
    }
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    for (const [index, size, offset] of [[0, 3, 0], [1, 3, 12], [2, 1, 24], [3, 2, 28]]) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 36, offset);
    }
    gl.bindVertexArray(null);

    bindTexture(gl, 0, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.from([...paperRgb.map((v) => v * 255), 255]));

    gl.useProgram(pageProgram);
    gl.uniform2f(pageU.uView, viewW, viewH);
    gl.uniform1f(pageU.uD, eyeDistance);
    gl.uniform2f(pageU.uEye, stage.width / 2, reach + stage.height / 2);
    gl.uniform2f(pageU.uSize, pw, ph);
    gl.uniform2f(pageU.uRes, canvas.width, canvas.height);
    gl.uniform3f(pageU.uPaper, paperRgb[0], paperRgb[1], paperRgb[2]);
    gl.uniform1i(pageU.uF, 0);
    gl.uniform1i(pageU.uB, 1);
    gl.uniform1i(pageU.uOld, 2);
    gl.uniform1i(pageU.uGrain, 3);
    gl.uniform1i(pageU.uShade, 4);
    gl.useProgram(flatProgram);
    gl.uniform2f(flatU.uView, viewW, viewH);
    gl.uniform2f(flatU.uRes, canvas.width, canvas.height);
    gl.uniform1i(flatU.uShade, 4);
    bindTexture(gl, 3, grain);
    bindTexture(gl, 4, shade);

    hinge = hingeAt(at);
  };

  const hingeAt = (q: number) => {
    const c = clamp(q, 0, lastStop);
    const i = Math.min(Math.floor(c), lastStop - 1);
    return i < 0 ? hinges[0] : hinges[i] + (hinges[i + 1] - hinges[i]) * (c - i);
  };

  const isVisible = (el: HTMLElement) =>
    leaves[rightShown]?.recto === el || leaves[leftShown]?.verso === el;

  const paintFace = (el: HTMLElement) => {
    const whole = rasterize(paint2d, el, sheets, dpr, paper);
    gl.activeTexture(gl.TEXTURE5);
    const texture = emptyTexture(gl, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint2d.canvas);
    const before = faces.get(el);
    const face: Face = { texture, whole, old: null, printAt: 0 };
    if (before) {
      if (ready && isVisible(el) && !flights.length) {
        face.old = before.texture;
        face.printAt = performance.now();
        wake();
      } else gl.deleteTexture(before.texture);
      if (before.old) gl.deleteTexture(before.old);
    }
    faces.set(el, face);
    stale.delete(el);
    dirty = true;
    return face;
  };

  const textureOf = (el: HTMLElement | null | undefined) => {
    if (!el) return blank;
    return (faces.get(el) ?? paintFace(el)).texture;
  };

  // Visible first, then what the next turn in either direction will uncover.
  const wanted = () => {
    const a = leaves[at - 2];
    const b = leaves[at - 1];
    const c = leaves[at];
    const d = leaves[at + 1];
    const list = [c?.recto, b?.verso, c?.verso, d?.recto, b?.recto, a?.verso, d?.verso, a?.recto];
    return list.filter((el): el is HTMLElement => !!el);
  };

  const askForImages = (el: HTMLElement) => {
    if (asked.has(el)) return;
    asked.add(el);
    prepareImages(el).then(() => {
      if (dead) return;
      const face = faces.get(el);
      if (face && !face.whole) stale.add(el);
      schedule();
    });
  };

  const work = () => {
    idle = 0;
    if (dead || !ready) return;
    const want = wanted();
    const inAir = (el: HTMLElement) => flights.some((f) => leaves[f.leaf].recto === el || leaves[f.leaf].verso === el);
    for (const [el, face] of faces) {
      if (!want.includes(el) && !inAir(el) && !isVisible(el)) dropFace(el, face);
    }
    for (const el of want) {
      askForImages(el);
      if (!faces.has(el) || stale.has(el)) {
        paintFace(el);
        wake();
        schedule();
        return;
      }
    }
  };

  const schedule = () => {
    if (idle || dead) return;
    idle = typeof window.requestIdleCallback === 'function' ? requestIdleCallback(work, { timeout: 300 }) : window.setTimeout(work, 60);
  };

  const takeSheet = () => {
    const spare = free.pop();
    if (spare) return spare;
    const [cols, rows] = gridFor(aspect);
    const sheet = createSheet(cols, rows, aspect);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attr = (index: number, size: number, data: Float32Array, usage: number) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
      return buffer;
    };
    const pos = attr(0, 3, sheet.pos, gl.DYNAMIC_DRAW);
    const nrm = attr(1, 3, sheet.nrm, gl.DYNAMIC_DRAW);
    const loose = attr(2, 1, sheet.loose, gl.DYNAMIC_DRAW);
    const uvs = new Float32Array(cols * rows * 2);
    const index: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        uvs[i * 2] = c / (cols - 1);
        uvs[i * 2 + 1] = r / (rows - 1);
        if (c + 1 < cols && r + 1 < rows) index.push(i, i + 1, i + cols, i + 1, i + cols + 1, i + cols);
      }
    }
    const uv = attr(3, 2, uvs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint16Array.from(index), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const made = { sheet, mesh: { vao, pos, nrm, loose, uv, count: index.length } };
    pool.push(made);
    return made;
  };

  /** Takes the leaf off its stack. Null when too many are in the air already. */
  const launch = (leaf: number, from: Side, lift: boolean): Flight | null => {
    if (flights.length >= MAX_IN_AIR) return null;
    const { sheet, mesh } = takeSheet();
    sheet.lay(from);
    const flight: Flight = { leaf, sheet, mesh, lift, until: 0 };
    flights.push(flight);
    if (from > 0) rightShown = Math.max(rightShown, leaf + 1);
    else leftShown = Math.min(leftShown, leaf - 1);
    return flight;
  };

  const land = (index: number) => {
    const [f] = flights.splice(index, 1);
    if (f.sheet.land < 0) leftShown = Math.max(leftShown, f.leaf);
    else rightShown = Math.min(rightShown, f.leaf);
    free.push({ sheet: f.sheet, mesh: f.mesh });
    dirty = true;
  };

  const turnSeconds = strip ? 0.55 : 0.85;
  const turningTowards = () => flights.find((f) => !f.lift)?.sheet.land ?? 0;

  /** Launches the next queued turn when it's due. */
  const pump = () => {
    if (drag || at === goal || gap > 0) return;
    const forward = goal > at;
    const heading: Side = forward ? -1 : 1;
    const towards = turningTowards();
    if (towards && towards !== heading) return;
    const leaf = forward ? at : at - 1;
    let flight = flights.find((f) => f.leaf === leaf) ?? null;
    if (flight && !flight.lift) return;
    for (const f of flights) if (f.lift && f !== flight && f.sheet.held) f.sheet.letGo();
    flight ??= launch(leaf, forward ? 1 : -1, false);
    if (!flight) return;
    flight.lift = false;
    flight.until = 0;
    flight.sheet.grip(1, 0.8);
    flight.sheet.swing(heading, turnSeconds);
    at += forward ? 1 : -1;
    if (Math.abs(goal - at) > 2) at = goal + (forward ? -2 : 2);
    if (forward) rightShown = Math.max(rightShown, at);
    else leftShown = Math.min(leftShown, at - 1);
    gap = STAGGER;
    schedule();
  };

  const splatShadows = () => {
    shadeField.fill(0);
    const sx = SHADE_W / viewW;
    const sy = SHADE_H / viewH;
    for (const { sheet } of flights) {
      const { cols, rows, pos } = sheet;
      for (let r = 0; r < rows; r++) {
        for (let c = 1; c < cols; c += 2) {
          const p = (r * cols + c) * 3;
          const z = pos[p + 2] * pw;
          if (z < 0.5) continue;
          const strength = (0.9 * Math.min(z / 12, 1)) / (1 + (z / pw) * 2.4);
          const radius = 44 + z * 0.45;
          const cx = (hinge + pos[p] * pw + z * SHADOW_X) * sx;
          const cy = SHADE_H - (top + pos[p + 1] * pw + z * SHADOW_Y) * sy;
          const rx = radius * sx;
          const ry = radius * sy;
          const y0 = Math.max(Math.ceil(cy - ry), 0);
          const y1 = Math.min(Math.floor(cy + ry), SHADE_H - 1);
          const x0 = Math.max(Math.ceil(cx - rx), 0);
          const x1 = Math.min(Math.floor(cx + rx), SHADE_W - 1);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
              if (d < 1) {
                const v = strength * (1 - d) * (1 - d);
                const i = y * SHADE_W + x;
                if (v > shadeField[i]) shadeField[i] = v;
              }
            }
          }
        }
      }
    }
    // One 1-2-1 pass each way hides the coarse grid.
    for (const [step, lines, length] of [[1, SHADE_H, SHADE_W], [SHADE_W, SHADE_W, SHADE_H]]) {
      const across = step === 1 ? SHADE_W : 1;
      for (let line = 0; line < lines; line++) {
        let before = shadeField[line * across];
        for (let k = 1; k + 1 < length; k++) {
          const i = line * across + k * step;
          const here = shadeField[i];
          shadeField[i] = (before + 2 * here + shadeField[i + step]) / 4;
          before = here;
        }
      }
    }
    for (let i = 0; i < shadeField.length; i++) shadeBytes[i] = shadeField[i] * 255;
    bindTexture(gl, 4, shade);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADE_W, SHADE_H, gl.RED, gl.UNSIGNED_BYTE, shadeBytes);
  };

  const flat = (x0: number, y0: number, x1: number, y1: number, soft: number, r: number, g: number, b: number, a: number, useShade: boolean) => {
    gl.uniform4f(flatU.uRect, x0, y0, x1, y1);
    gl.uniform1f(flatU.uSoft, soft);
    gl.uniform4f(flatU.uTint, r, g, b, a);
    gl.uniform1f(flatU.uUseShade, useShade ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const drawTable = () => {
    const hasLeft = leftShown >= 0;
    const hasRight = rightShown < leaves.length;
    gl.useProgram(flatProgram);
    gl.bindVertexArray(emptyVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const x0 = hinge - (hasLeft ? pw : 0);
    const x1 = hinge + (hasRight ? pw : 0);
    if (x1 > x0) flat(x0 + 1, top + 3, x1 + 1, top + ph + 5, 14, 0.24, 0.2, 0.12, 0.13, false);
    if (flights.length) flat(0, 0, viewW, viewH, 0, 0.24, 0.2, 0.12, 0.22, true);
    const pile = (count: number, side: number) => {
      const layers = Math.min(Math.ceil(count / 4), 3);
      for (let i = layers; i > 0; i--) {
        const k = 1 - 0.018 * i - 0.012;
        const dx = side * i * 1.5;
        const dy = i * 1.5;
        const a = side > 0 ? hinge : hinge - pw;
        flat(a + dx, top + dy, a + pw + dx, top + ph + dy, 0, paperRgb[0] * k, paperRgb[1] * k, paperRgb[2] * k, 1, false);
      }
    };
    if (hasLeft) pile(leftShown, -1);
    if (hasRight) pile(leaves.length - rightShown - 1, 1);
    gl.disable(gl.BLEND);
  };

  const drawPages = (now: number) => {
    gl.useProgram(pageProgram);
    gl.uniform3f(pageU.uAt, hinge, top, pw);
    gl.uniform1f(pageU.uCast, flights.length ? 0.35 : 0);
    gl.bindVertexArray(quadVao);
    const quad = (leaf: Leaf | undefined, first: number, face: HTMLElement | null | undefined) => {
      if (!leaf) return;
      bindTexture(gl, 0, textureOf(leaf.recto));
      bindTexture(gl, 1, textureOf(leaf.verso));
      const state = face ? faces.get(face) : undefined;
      let print = 1;
      if (state?.old) {
        print = (now - state.printAt) / PRINT_MS;
        if (print >= 1) {
          gl.deleteTexture(state.old);
          state.old = null;
          print = 1;
        } else {
          bindTexture(gl, 2, state.old);
          dirty = true;
        }
      }
      gl.uniform1f(pageU.uPrint, print);
      gl.drawArrays(gl.TRIANGLE_STRIP, first, 4);
    };
    const right = leaves[rightShown];
    const left = leaves[leftShown];
    quad(right, 0, right?.recto);
    quad(left, 4, left?.verso);

    gl.uniform1f(pageU.uCast, 0);
    gl.uniform1f(pageU.uPrint, 1);
    gl.enable(gl.DEPTH_TEST);
    for (const f of flights) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      bindTexture(gl, 0, textureOf(leaves[f.leaf].recto));
      bindTexture(gl, 1, textureOf(leaves[f.leaf].verso));
      const { mesh, sheet } = f;
      gl.bindVertexArray(mesh.vao);
      for (const [buffer, data] of [[mesh.pos, sheet.pos], [mesh.nrm, sheet.nrm], [mesh.loose, sheet.loose]] as const) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      }
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  };

  const draw = (now: number) => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (flights.length) splatShadows();
    drawTable();
    drawPages(now);
  };

  const frame = (now: number) => {
    raf = 0;
    if (dead) return;
    const seconds = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    const dt = Math.min(seconds, 0.1);
    const busy = flights.length > 0;
    gap -= dt;
    pump();
    let moving = false;
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      if (f.until > 0) {
        f.until -= dt;
        if (f.until <= 0) f.sheet.letGo();
      }
      if (f.sheet.tick(dt)) moving = true;
      if (f.sheet.resting) land(i);
    }
    if (moving) {
      turnFrames++;
      turnTime += seconds;
    }

    let q = leftShown + 1;
    for (const f of flights) q += clamp((1 - f.sheet.edge()) / 2, 0, 1);
    const target = hingeAt(q);
    hinge += (target - hinge) * (1 - Math.exp(-dt * 16));
    const settling = Math.abs(target - hinge) > 0.2;
    if (!settling && !flights.length) hinge = hingeAt(at);

    dirty = false;
    draw(now);

    if (busy && !flights.length) {
      schedule();
      const slow = turnFrames >= 20 && turnTime / turnFrames > 0.045;
      turnFrames = turnTime = 0;
      if (slow && !force) {
        onFail('too-slow');
        return;
      }
    }

    if (moving || dirty || settling || at !== goal || flights.some((f) => f.until > 0)) wake();
    else last = 0;
  };

  const wake = () => {
    if (!raf && !dead && ready && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      last = 0;
      wake();
    }
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    if (!dead) onFail('context-lost');
  };

  const clientToView = (x: number, y: number) => {
    const box = canvas.getBoundingClientRect();
    return [x - box.left, y - box.top];
  };

  const liftCorner = (leaf: number, from: Side, v: number, angle: number) => {
    const flight = flights.find((f) => f.leaf === leaf && f.lift) ?? launch(leaf, from, true);
    if (!flight) return null;
    if (!flight.sheet.held || Math.abs(flight.sheet.gripV - v) > 0.5) flight.sheet.grip(1, v);
    flight.sheet.lift(angle);
    wake();
    return flight;
  };

  const press: Press = {
    turnTo(stop) {
      const next = clamp(stop, 0, lastStop);
      goal = next;
      if (!ready) {
        at = next;
        leftShown = at - 1;
        rightShown = at;
        hinge = hingeAt(at);
        return;
      }
      wake();
    },

    grab(clientX, clientY) {
      if (!ready || drag) return false;
      const [x, y] = clientToView(clientX, clientY);
      if (y < top || y > top + ph) return false;
      if (strip) {
        if (lastStop < 1) return false;
        drag = { x0: x, y0: y, flight: null, forward: true, cos: 1 };
        return true;
      }
      const forward = x >= hinge;
      if (Math.abs(x - hinge) > pw) return false;
      const leaf = forward ? at : at - 1;
      if (leaf < 0 || leaf >= leaves.length) return false;
      const towards = turningTowards();
      if (towards && towards !== (forward ? -1 : 1)) return false;
      let flight = flights.find((f) => f.leaf === leaf) ?? null;
      if (flight && !flight.lift) return false;
      if (!flight) flight = launch(leaf, forward ? 1 : -1, false);
      if (!flight) return false;
      flight.lift = false;
      flight.until = 0;
      flight.sheet.grip(Math.abs(x - hinge) / pw, (y - top) / ph);
      drag = { x0: x, y0: y, flight, forward, cos: forward ? 1 : -1 };
      wake();
      return true;
    },

    drag(clientX, clientY) {
      if (!drag) return;
      const [x, y] = clientToView(clientX, clientY);
      if (strip && !drag.flight) {
        const dx = x - drag.x0;
        if (Math.abs(dx) < 2) return;
        drag.forward = dx < 0;
        const leaf = drag.forward ? at : at - 1;
        if (leaf < 0 || leaf >= lastStop || flights.length >= MAX_IN_AIR) return;
        const towards = turningTowards();
        if (towards && towards !== (drag.forward ? -1 : 1)) return;
        drag.flight = flights.find((f) => f.leaf === leaf && f.lift) ?? launch(leaf, drag.forward ? 1 : -1, false);
        if (!drag.flight) return;
        drag.flight.lift = false;
        drag.flight.until = 0;
        drag.flight.sheet.grip(0.8, clamp((y - top) / ph, 0, 1));
      }
      const flight = drag.flight;
      if (!flight) return;
      if (strip) {
        drag.cos = (drag.forward ? 1 : -1) + (2 * (x - drag.x0)) / pw;
      } else {
        const r = flight.sheet.radius;
        const low = hinges[flight.leaf + 1] - r * pw;
        const high = hinges[flight.leaf] + r * pw;
        drag.cos = (2 * (x - low)) / (high - low) - 1;
      }
      drag.cos = clamp(drag.cos, -1, 1);
      flight.sheet.pull(drag.cos, clamp((y - drag.y0) / pw, -0.5, 0.5) * 0.25);
      wake();
    },

    release(velocityX) {
      const current = drag;
      drag = null;
      const flight = current?.flight;
      if (!current || !flight) return;
      const flick = Math.abs(velocityX) > FLICK;
      const done = current.forward
        ? flick ? velocityX < 0 : current.cos < 0
        : flick ? velocityX > 0 : current.cos > 0;
      const onLeft = current.forward === done;
      flight.sheet.swing(onLeft ? -1 : 1, turnSeconds);
      if (done) {
        at = current.forward ? flight.leaf + 1 : flight.leaf;
        goal = at;
        schedule();
        onStop(at);
      }
      wake();
    },

    hover(clientX, clientY) {
      if (!ready || drag) return;
      const lifted = flights.find((f) => f.lift);
      if (clientX === null || clientY === null) {
        if (lifted?.sheet.held) lifted.sheet.letGo();
        wake();
        return;
      }
      if (at !== goal || turningTowards()) return;
      wake();
      const [x, y] = clientToView(clientX, clientY);
      const right = strip || x >= hinge;
      const leaf = right ? at : at - 1;
      const turnable = leaf >= 0 && leaf < (strip ? lastStop : leaves.length);
      const u = Math.abs(x - hinge) / pw;
      const v = (y - top) / ph;
      const near = v < 0.5 ? 0 : 1;
      const reach = Math.hypot(1 - u, (near - v) * aspect);
      const onPage = v >= 0 && v <= 1 && u <= 1;
      if (lifted?.sheet.held && (!turnable || !onPage || reach > 0.55 || lifted.leaf !== leaf)) {
        lifted.sheet.letGo();
      }
      if (turnable && onPage && reach <= 0.55) {
        liftCorner(leaf, right ? 1 : -1, near ? 0.98 : 0.02, 0.05 + 0.09 * (1 - reach / 0.55));
      }
    },

    hint() {
      if (!ready || drag || flights.length) return;
      const leaf = at < (strip ? lastStop : leaves.length) ? at : at - 1;
      if (leaf < 0) return;
      const flight = liftCorner(leaf, leaf === at ? 1 : -1, 0.98, 0.17);
      if (flight) flight.until = 0.42;
    },

    resize() {
      if (dead) return;
      drag = null;
      while (flights.length) {
        flights[0].sheet.lay(flights[0].sheet.land);
        land(0);
      }
      at = goal;
      leftShown = at - 1;
      rightShown = at;
      releaseAll();
      measure();
      dirty = true;
      wake();
      schedule();
    },

    dispose() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      releaseAll();
      for (const texture of [grain, shade, blank]) gl.deleteTexture(texture);
      gl.deleteVertexArray(quadVao);
      gl.deleteVertexArray(emptyVao);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(pageProgram);
      gl.deleteProgram(flatProgram);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };

  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);

  measure();

  const boot = async () => {
    const first = [leaves[rightShown]?.recto, leaves[leftShown]?.verso].filter((el): el is HTMLElement => !!el);
    first.forEach((el) => asked.add(el));
    const images = Promise.all(first.map(prepareImages)).then(() => undefined);
    const fonts = loadFonts(sheets);
    // The DOM stays on screen until its drawings can be repainted exactly, however long that takes.
    await Promise.all([images, fonts]);
    if (dead) return;
    ready = true;
    requestAnimationFrame((now) => {
      if (dead) return;
      draw(now);
      if (at !== goal) wake();
      schedule();
      onReady();
    });
  };
  boot();

  return press;
};

const createPress: CreatePress = (options) => {
  try {
    return build(options);
  } catch {
    return null;
  }
};

export default createPress;

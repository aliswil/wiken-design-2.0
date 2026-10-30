export const MAX_RIPPLES = 10;
export const MAX_FISH = 6;

const NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n + 3.1));
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.0) + 0.1 * vnoise(p * 4.3 + 3.0);
  }
`;

/** Shared by everything in the room: mist with distance, and a frame that bleeds into the paper of the page. */
const ATMOSPHERE = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec2 uResolution;
  uniform float uEdge;

  vec3 mist(vec3 color, float distanceToCamera, float start, float density) {
    float amount = max(distanceToCamera - start, 0.0) * density;
    return mix(color, uPaper, 1.0 - exp(-amount * amount));
  }

  vec3 paperBleed(vec3 color) {
    if (uEdge < 0.5) return color;
    vec2 uv = gl_FragCoord.xy / uResolution;
    float rough = vnoise(vec2(uv.x * 22.0, uv.y * 3.0)) * 0.5 + vnoise(vec2(uv.x * 7.0, uv.y * 2.0)) * 0.5;
    float top = smoothstep(0.0, 0.03 + rough * 0.07, 1.0 - uv.y);
    float bottom = smoothstep(0.0, 0.015 + rough * 0.05, uv.y);
    return mix(uPaper, color, top * bottom);
  }
`;

export const WORLD_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const WALL_VERTEX = /* glsl */ `
  attribute vec3 aAlong;
  attribute vec3 aTone;
  varying vec3 vWorld;
  varying vec3 vAlong;
  varying vec3 vTone;
  varying vec3 vNormal;
  void main() {
    vAlong = aAlong;
    vTone = aTone;
    vNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Each wall is a limewash, tinted by the paintings in its room. */
export const WALL_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  varying vec3 vWorld;
  varying vec3 vAlong;
  varying vec3 vTone;
  varying vec3 vNormal;

  // Limewash: soft clouding, faint crossing brushwork and a fine grain, all kept quiet behind the art.
  // x: wash brightness, y: where the damp stops, z: roughness of the top edge.
  vec3 wash(float along, float y) {
    vec2 p = vec2(along, y);
    float cloud = fbm(p * 0.26 + 3.0);
    vec2 up = vec2(p.x * 0.82 + p.y * 0.57, p.y * 0.82 - p.x * 0.57);
    vec2 down = vec2(p.x * 0.82 - p.y * 0.57, p.y * 0.82 + p.x * 0.57);
    float turn = smoothstep(0.4, 0.6, fbm(p * 0.3 + 5.0));
    float brushed = mix(vnoise(vec2(up.x * 0.7, up.y * 6.0)), vnoise(vec2(down.x * 0.7, down.y * 6.0) + 3.0), turn);
    float grain = vnoise(p * 34.0);
    return vec3(
      0.985 + 0.05 * (cloud - 0.5) + 0.026 * (brushed - 0.5) + 0.012 * (grain - 0.5),
      0.22 + fbm(vec2(along * 0.7, 3.0)) * 0.4,
      (fbm(vec2(along * 0.34, y * 0.5)) - 0.5) * 1.8
    );
  }

  void main() {
    // Each wall starts somewhere else in the noise, so no two are brushed alike.
    float along = vAlong.x + vAlong.z;
    float y = vWorld.y;
    vec3 brush = wash(along, y);
    vec3 color = vTone * brush.x;

    float damp = smoothstep(brush.y, 0.0, y);
    color = mix(color, color * vec3(0.72, 0.8, 0.74), damp * 0.6);

    // A slim moulding running round the room, above the tallest paintings.
    float moulding = y - 3.9;
    color *= 1.0 - 0.09 * smoothstep(0.07, 0.0, abs(moulding + 0.07)) + 0.035 * smoothstep(0.03, 0.0, abs(moulding));

    // Directional light and soft corners make the room read as a box.
    float light = 0.975 + 0.035 * dot(normalize(vNormal), normalize(vec3(0.62, 0.2, 0.76)));
    float toCorner = min(vAlong.x, vAlong.y - vAlong.x);
    color *= light * (0.92 + 0.08 * smoothstep(0.0, 1.1, toCorner));

    color = mix(color, uPaper, smoothstep(4.3, 6.2, y + brush.z));

    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 9.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

/** The paintings stay untouched by the brush: only distance softens them. */
export const PAINTING_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform float uBlend;
  varying vec3 vWorld;
  varying vec2 vUv;

  void main() {
    vec3 color = mix(texture2D(uFrom, vUv).rgb, texture2D(uTo, vUv).rgb, uBlend);
    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 13.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

export const FRAME_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aFinish;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vFinish;
  void main() {
    vUv = uv;
    vColor = aColor;
    vFinish = aFinish;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Floater frames in wood, old gold or paint, plus the plain canvas edge and shadow gap. */
export const FRAME_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vFinish;

  void main() {
    vec3 color = vColor;
    vec3 toCamera = normalize(cameraPosition - vWorld);
    float facing = dot(normalize(vNormal), normalize(toCamera + vec3(0.0, 0.5, 0.0)));

    if (vFinish < 0.5) {
      // Wood: fine grain running along the moulding.
      float grain = fbm(vec2(vUv.x * 5.0, vUv.y * 22.0));
      float pores = vnoise(vec2(vUv.x * 30.0, vUv.y * 70.0));
      color *= 0.86 + 0.26 * grain + 0.06 * (pores - 0.5);
    } else if (vFinish < 1.5) {
      // Old gold: worn leaf with a soft sheen, darker where it has rubbed thin.
      float worn = fbm(vec2(vUv.x * 11.0, vUv.y * 6.0));
      float sheen = pow(max(facing, 0.0), 6.0);
      color *= 0.8 + 0.2 * worn + 0.42 * sheen;
    } else if (vFinish < 2.5) {
      // Paint: matt, with faint brush marks.
      color *= 0.95 + 0.1 * vnoise(vec2(vUv.x * 9.0, vUv.y * 30.0));
    }

    if (vFinish < 2.5) color *= 0.76 + 0.3 * max(facing, 0.0);

    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 13.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

/** The slim oak mouldings round the doors. */
export const DOOR_FRAME_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  uniform vec3 uColor;
  varying vec3 vWorld;
  varying vec2 vUv;

  void main() {
    vec3 color = uColor * (0.92 + 0.16 * vnoise(vWorld.xz * 9.0 + vWorld.y * 30.0));
    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 13.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

export const SHADOW_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 p = abs(vUv - 0.5) * 2.0;
    float edge = smoothstep(1.0, 0.72, p.x) * smoothstep(1.0, 0.72, p.y);
    float fade = exp(-length(cameraPosition - vWorld) * 0.05);
    gl_FragColor = vec4(0.13, 0.15, 0.12, edge * 0.36 * fade);
  }
`;

export const DECK_VERTEX = /* glsl */ `
  attribute float aAcrossX;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vAcrossX;
  void main() {
    vNormal = normal;
    vAcrossX = aAcrossX;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Oiled oak boards laid across the direction of walking, each with its own colour and grain. */
export const DECK_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vAcrossX;

  void main() {
    float boardWidth = 0.14;
    float across = mix(vWorld.z, vWorld.x, vAcrossX);
    float along = mix(vWorld.x, vWorld.z, vAcrossX);
    float board = floor(across / boardWidth);
    float inBoard = fract(across / boardWidth);
    float id = hash21(vec2(board, 7.0));

    float grainLine = fbm(vec2(along * 0.9 + id * 40.0, inBoard * 3.0 + id * 9.0));
    float rings = sin((inBoard * 5.0 + grainLine * 7.0 + id * 6.0) * 6.28) * 0.5 + 0.5;
    float pores = vnoise(vec2(along * 7.0, inBoard * 24.0 + id * 30.0));
    vec3 oak = mix(vec3(0.68, 0.55, 0.39), vec3(0.8, 0.68, 0.5), id);
    vec3 color = oak * (0.9 + 0.1 * rings + 0.05 * (pores - 0.5));

    // The gaps between boards fade with distance rather than breaking into dots.
    float gap = smoothstep(0.0, 0.05, inBoard) * smoothstep(1.0, 0.95, inBoard);
    float gapReach = 1.0 - smoothstep(0.08, 0.32, fwidth(across / boardWidth));
    color *= mix(1.0, mix(0.5, 1.0, gap), gapReach);

    float top = smoothstep(0.5, 0.9, vNormal.y);
    color *= mix(0.5, 1.0, top);
    if (vNormal.y < -0.5) color *= 0.55;

    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 9.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;


/** A fish in the air: dark along the back, pale underneath, wet with light. */
export const FISH_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vec3 color = mix(vec3(0.86, 0.84, 0.74), vec3(0.72, 0.42, 0.2), smoothstep(0.3, 0.62, vUv.y));
    color = mix(color, vec3(0.36, 0.25, 0.16), smoothstep(0.72, 0.95, vUv.y));
    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 9.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

/** Long hair, drawn as stacked shells of the same shape where each layer keeps fewer strands. */
export const FUR_VERTEX = /* glsl */ `
  uniform float uShells;
  uniform float uFurLength;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vShell;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vShell = float(gl_InstanceID) / (uShells - 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position + normal * uFurLength * vShell, 1.0);
    world.y -= uFurLength * 0.8 * vShell * vShell;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const FUR_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  uniform vec3 uRootColor;
  uniform vec3 uTipColor;
  uniform vec2 uStrands;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vShell;
  varying vec3 vNormal;

  void main() {
    // Strands lean with height, so the coat lies combed instead of standing on end.
    vec2 grid = vUv * uStrands + vec2(0.0, vShell * vShell * uStrands.y * 0.05);
    vec2 cell = floor(grid);
    vec2 inCell = fract(grid) - 0.5;
    float random = hash21(cell);
    float strandLength = 0.55 + 0.45 * random;
    if (vShell > 0.001) {
      float thickness = (1.0 - vShell / strandLength) * 0.72 + 0.1;
      if (vShell > strandLength || dot(inCell, inCell) > thickness * thickness) discard;
    }
    vec3 color = mix(uRootColor, uTipColor, vShell * 0.7 + random * 0.3);
    color *= mix(0.72, 1.0, vShell);
    color *= 0.82 + 0.18 * (vNormal.y * 0.5 + 0.5);
    float distanceToCamera = length(cameraPosition - vWorld);
    color = mist(color, distanceToCamera, 9.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

/** Eyes, nose and the like: plain colour, softened by mist. */
export const PLAIN_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  uniform vec3 uColor;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    float distanceToCamera = length(cameraPosition - vWorld);
    gl_FragColor = vec4(paperBleed(mist(uColor, distanceToCamera, 9.0, 0.03)), 1.0);
  }
`;

/**
 * The water repaints what it mirrors. Each dab of the surface reflects a slightly different
 * part of the room, so reflections break up into broken colour while the water moves, and
 * close into a clean mirror as it stills.
 */
export const WATER_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  uniform sampler2D uReflection;
  uniform float uAgitation;
  uniform float uTime;
  uniform int uRippleCount;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform int uFishCount;
  uniform vec4 uFish[${MAX_FISH}];
  varying vec3 vWorld;
  varying vec2 vUv;

  // Fish just under the surface, drawn as soft shapes. Each is x, z, heading and length.
  vec4 fishUnderwater(vec2 p) {
    vec4 result = vec4(0.0);
    for (int i = 0; i < uFishCount; i++) {
      vec4 fish = uFish[i];
      if (fish.w <= 0.0) continue;
      vec2 offset = (p - fish.xy) / fish.w;
      if (dot(offset, offset) > 4.0) continue;
      float c = cos(fish.z);
      float s = sin(fish.z);
      float along = offset.x * c + offset.y * s;
      float across = -offset.x * s + offset.y * c + sin(along * 3.0 + uTime * 5.0) * 0.05 * (0.5 - along);
      float bodyWidth = 0.21 * sqrt(max(1.0 - along * along, 0.0)) * (0.82 + 0.18 * along);
      float body = smoothstep(bodyWidth + 0.03, max(bodyWidth - 0.03, 0.0), abs(across)) * step(abs(along), 1.0);
      float tailWidth = (-along - 0.86) * 0.42;
      float tail = smoothstep(tailWidth + 0.02, max(tailWidth - 0.02, 0.0), abs(across)) * step(-1.42, along) * step(along, -0.86);
      float shape = max(body, tail);
      vec3 tone = mod(float(i), 2.0) < 0.5 ? vec3(0.72, 0.42, 0.2) : vec3(0.17, 0.21, 0.18);
      if (shape > result.a) result = vec4(tone, shape);
    }
    return result;
  }

  vec2 rippleSlope(vec2 p) {
    vec2 slope = vec2(0.0);
    for (int i = 0; i < uRippleCount; i++) {
      vec4 ripple = uRipples[i];
      if (ripple.w <= 0.0) continue;
      vec2 offset = p - ripple.xy;
      float radius = length(offset) + 0.001;
      float age = uTime - ripple.z;
      float front = radius - age * 1.5;
      float envelope = ripple.w * exp(-age * 0.85) * exp(-front * front * 1.1);
      slope += offset / radius * cos(front * 8.5) * envelope;
    }
    return slope;
  }

  // Flat-edged streaks of offset: long, soft-cornered dabs lying across the view, like broken colour.
  vec2 dabs(vec2 p, float seed) {
    vec2 scaled = p * vec2(0.9, 6.2) + seed;
    float x = smoothstep(0.34, 0.66, vnoise(scaled)) - 0.5;
    float y = smoothstep(0.3, 0.7, vnoise(scaled * vec2(1.3, 0.8) + 17.0)) - 0.5;
    return vec2(x, y);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec3 toCamera = cameraPosition - vWorld;
    float distanceToCamera = length(toCamera);
    float facing = max(toCamera.y / distanceToCamera, 0.0);

    float angle = (vnoise(p * 0.16) - 0.5) * 1.6;
    float c = cos(angle);
    float s = sin(angle);
    vec2 flowing = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    flowing += (vec2(vnoise(p * 1.1), vnoise(p * 1.1 + 9.0)) - 0.5) * 0.38;

    vec2 dabA = dabs(flowing, 0.0);
    vec2 dabB = dabs(flowing * 0.62, 11.0);
    float layerMask = smoothstep(0.4, 0.6, vnoise(flowing * 1.7));

    vec2 slope = rippleSlope(p);
    float slopeStrength = length(slope);
    float restless = 0.035 + uAgitation * 0.95 + slopeStrength * 1.4;
    float reach = restless / (1.0 + distanceToCamera * 0.42);

    vec2 uv = gl_FragCoord.xy / uResolution;
    uv.y = 1.0 - uv.y;
    vec2 stretch = vec2(0.32, 1.0);
    vec2 slopeShift = vec2(slope.x, abs(slope.y) + slopeStrength * 0.4) * 0.05 / (1.0 + distanceToCamera * 0.25);
    vec2 uvA = uv + dabA * stretch * reach * 0.2 + slopeShift;
    vec2 uvB = uv + dabB * stretch * reach * 0.26 + slopeShift;
    vec3 reflection = mix(texture2D(uReflection, uvA).rgb, texture2D(uReflection, uvB).rgb, layerMask);
    float dabLight = mix(dabA.x, dabB.y, layerMask);

    // Below the mirror: slow winding strokes of deep green.
    float bend = fbm(p * 0.28);
    float currents = sin((p.y * 0.9 + p.x * 0.35 + bend * 9.0) * 5.0 + vnoise(p * 2.4) * 2.4);
    vec3 depths = mix(vec3(0.09, 0.2, 0.16), vec3(0.2, 0.36, 0.27), currents * 0.5 + 0.5);
    depths = mix(depths, vec3(0.44, 0.56, 0.40), smoothstep(0.62, 0.9, fbm(p * 0.9 + bend * 3.0)) * 0.55);

    float fresnel = 0.16 + 0.84 * pow(1.0 - facing, 2.1);
    vec3 color = mix(depths, reflection, fresnel);
    vec4 fish = fishUnderwater(p + slope * 0.12);
    color = mix(color, fish.rgb, fish.a * 0.78 * (1.0 - fresnel * 0.72));
    color *= 1.0 + dabLight * (0.05 + 0.08 * min(restless, 1.0));
    color += slopeStrength * 0.05;

    color = mist(color, distanceToCamera, 9.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

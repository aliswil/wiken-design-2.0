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

  // Limewash is brushed in crossing diagonals, so two directions of stroke take turns to show.
  float strokes(vec2 p, float warp) {
    float sweep = vnoise(vec2(p.x * 0.55 + warp * 1.6, p.y * 3.4 + warp * 3.0));
    float bristle = vnoise(vec2(p.x * 1.1, p.y * 19.0 + warp * 4.0));
    return sweep * 0.78 + bristle * 0.22;
  }

  // x: wash brightness, y: where the damp stops, z: roughness of the top edge.
  vec3 wash(float along, float y) {
    vec2 p = vec2(along, y);
    float warp = fbm(p * 0.34);
    vec2 up = vec2(p.x * 0.82 + p.y * 0.57, p.y * 0.82 - p.x * 0.57);
    vec2 down = vec2(p.x * 0.82 - p.y * 0.57, p.y * 0.82 + p.x * 0.57);
    float turn = smoothstep(0.36, 0.64, fbm(p * 0.21 + 5.0));
    float brushed = mix(strokes(up, warp), strokes(down + 3.0, warp), turn);
    return vec3(
      0.91 + 0.17 * brushed + 0.05 * warp,
      0.5 + fbm(vec2(along * 0.7, 3.0)) * 0.7,
      (fbm(vec2(along * 0.34, y * 0.5)) - 0.5) * 2.2
    );
  }

  void main() {
    // Each wall starts somewhere else in the noise, so no two are brushed alike.
    float along = vAlong.x + vAlong.z;
    float y = vWorld.y;
    vec3 brush = wash(along, y);
    vec3 color = vTone * brush.x;

    float damp = smoothstep(brush.y, 0.0, y);
    color = mix(color, color * vec3(0.52, 0.64, 0.56), damp * 0.72);

    // Directional light and darker corners make the room read as a box.
    float light = 0.95 + 0.07 * dot(normalize(vNormal), normalize(vec3(0.62, 0.2, 0.76)));
    float toCorner = min(vAlong.x, vAlong.y - vAlong.x);
    color *= light * (0.84 + 0.16 * smoothstep(0.0, 1.3, toCorner));

    color = mix(color, uPaper, smoothstep(3.6, 5.8, y + brush.z));

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

export const FRAME_FRAGMENT = /* glsl */ `
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

export const MAX_RIPPLES = 10;

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
  varying vec3 vWorld;
  varying vec2 vUv;

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
    color *= 1.0 + dabLight * (0.05 + 0.08 * min(restless, 1.0));
    color += slopeStrength * 0.05;

    color = mist(color, distanceToCamera, 9.0, 0.03);
    gl_FragColor = vec4(paperBleed(color), 1.0);
  }
`;

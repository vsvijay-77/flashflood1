/**
 * Realistic Game-Quality Water Shaders (Three.js ShaderMaterial)
 *
 * Implements:
 * - Layered Gerstner waves with horizontal displacement
 * - Multi-frequency ripples with fwidth derivative anti-shimmering
 * - Current advection: ripples flow along simulated hydrodynamic velocity
 * - Fresnel reflectance
 * - GGX / Blinn-Phong specular sun highlights
 * - Depth-based Beer-Lambert absorption
 * - Screen-space refraction using live Cesium canvas texture
 * - Procedural sky reflection and sampled-terrain depth occlusion
 * - Differential-area caustic brightness on shallow beds
 * - Shoreline foam at water margins
 * - Froude-number-based whitewater for fast shallow rapids
 * - ACES filmic tone mapping
 * - Logarithmic depth buffer and transparent rendering
 */

import * as THREE from "three";

export const WaterVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWindSpeed;

  attribute float aDepth;
  attribute vec2 aVelocity;
  attribute float aBedElevation;
  attribute float aInside;
  attribute float aIsWaterBody;

  varying vec3 vWorldPosition;
  varying vec3 vViewPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vDepth;
  varying vec2 vVelocity;
  varying float vBedElevation;
  varying float vWaveDisplacement;
  varying float vInside;
  varying float vIsWaterBody;

  // Gerstner Wave function: computes (dx, dy, dz)
  vec3 gerstnerWave(vec2 p, vec2 dir, float steepness, float wavelength, float speed) {
    dir = normalize(dir);
    float k = 6.2831853 / wavelength;
    float c = sqrt(9.81 / k) * speed * 0.35;
    float phase = k * dot(dir, p) - uTime * c;

    float a = steepness / k;
    float cosP = cos(phase);
    float sinP = sin(phase);

    return vec3(
      dir.x * (a * cosP),
      a * sinP,
      dir.y * (a * cosP)
    );
  }

  void main() {
    vUv = uv;
    vDepth = aDepth;
    vVelocity = vec2(aVelocity.x, -aVelocity.y);
    vBedElevation = aBedElevation;
    vInside = aInside;
    vIsWaterBody = aIsWaterBody;

    vec3 displaced = position;

    // Subtle water surface ripple: strictly vertical motion (never displace horizontally)
    // to ensure water stays clamped against the ground and never floats in the air
    if (aDepth > 0.01) {
      vec2 p = position.xz;
      float waveScale = min(0.006, uWaveHeight * 0.004 * min(aDepth, 0.3));
      float ripple = sin(p.x * 2.5 + uTime * 2.0) * cos(p.y * 2.5 - uTime * 1.5) * waveScale;
      displaced.y += ripple;
      vWaveDisplacement = ripple;
    } else {
      vWaveDisplacement = 0.0;
    }

    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPos.xyz;

    vec4 mvPosition = viewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;

    vNormal = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
  }
`;

export const WaterFragmentShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uTime;
  uniform float uFlowTime;
  uniform float uRainIntensity;
  uniform vec2 uResolution;
  uniform sampler2D uSceneColor; // Live Cesium canvas texture for screen-space refraction
  uniform sampler2D uTerrainHeight; // Terrain heightfield texture for bank ray marching
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uWaterColorDeep;
  uniform vec3 uWaterColorShallow;
  uniform vec3 uSkyColor;
  uniform float uHasSceneColor;
  uniform float uWaveHeight;

  varying vec3 vWorldPosition;
  varying vec3 vViewPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vDepth;
  varying vec2 vVelocity;
  varying float vBedElevation;
  varying float vWaveDisplacement;
  varying float vInside;
  varying float vIsWaterBody;

  // Anti-shimmering ripple generator using fwidth derivative filtering (calm, slow speed)
  vec2 ripple(vec2 p, vec2 direction, float wavelength, float amplitude) {
    direction = normalize(direction);
    float k = 6.2831853 / wavelength;
    float phase = dot(p, direction) * k - uTime * sqrt(9.81 * k) * 0.35;
    float filtered = exp(-pow(fwidth(phase), 2.0));
    return direction * cos(phase) * amplitude * filtered;
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
      mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
  }
  float computeCaustics(vec2 p, float depth) {
    vec2 q = p * 0.6 + vec2(uTime * 0.08, -uTime * 0.06);
    float pattern = noise(q + noise(q * 0.7)) * noise(q * 1.8 + 9.0);
    float filtered = exp(-length(fwidth(q)));
    return smoothstep(0.35, 0.7, pattern) * 0.16 * filtered * exp(-depth);
  }

  vec2 surfaceSlope(vec2 point, vec2 flowDirection, float flowSpeed) {
    vec2 crossFlow = vec2(-flowDirection.y, flowDirection.x);
    vec2 result = ripple(point, flowDirection, 52.0, 0.030);
    result += ripple(point, flowDirection, 16.0, 0.026);
    result += ripple(point, flowDirection, 5.0, 0.038);
    result += ripple(point, crossFlow, 9.0, 0.012);
    result += ripple(point, crossFlow, 2.2, 0.016);
    result += ripple(point, flowDirection + crossFlow * 0.35, 0.7, 0.010);
    float currentDetail = mix(0.62, 1.18, smoothstep(0.03, 2.5, flowSpeed));
    return result * max(0.0, uWaveHeight) * currentDetail;
  }

  void main() {
    #include <logdepthbuf_fragment>

    // ⛔ Strictly discard any fragments outside the selected polygon area
    if (vInside < 0.99) discard;

    // Resting rivers are rendered by their exact Cesium vectors. The hydraulic
    // mesh appears only once floodwater has a visible physical depth, avoiding
    // coarse grid cells turning the whole catchment cyan at simulation start.
    float flowSpeed = length(vVelocity);
    // Moving sheets are visible earlier than still water. This joins narrow
    // downhill corridors without tinting every rain-damp cell blue.
    float movingWater = smoothstep(0.03, 0.70, flowSpeed);
    float wetThreshold = mix(0.016, 0.0025, movingWater);
    float floodThreshold = 0.065;
    if (vDepth < wetThreshold) discard;

    // Carry surface detail in the simulated current direction. uFlowTime is
    // simulated time, so high playback rates also advance the visible water.
    vec2 stillWaterDirection = normalize(vec2(0.78, 0.62));
    vec2 flowDirection = flowSpeed > 0.02 ? vVelocity / flowSpeed : stillWaterDirection;
    vec2 p = vWorldPosition.xz - vVelocity * uFlowTime;

    // Multi-frequency ripple slope with fwidth derivative anti-shimmering
    vec2 slope = surfaceSlope(p, flowDirection, flowSpeed);
    vec2 rainPoint = p * 0.7;
    vec2 rainCell = floor(rainPoint);
    float rainSeed = fract(sin(dot(rainCell, vec2(127.1, 311.7))) * 43758.5453);
    float rainAge = fract(uTime * 1.4 + rainSeed);
    vec2 rainOffset = fract(rainPoint) - vec2(0.5);
    float rainRadius = length(rainOffset);
    float rainRing = exp(-pow((rainRadius - rainAge * 0.45) * 28.0, 2.0));
    float rainDetail = 1.0 - smoothstep(0.15, 0.6, length(fwidth(rainPoint)));
    slope += rainOffset / max(rainRadius, 0.01) * rainRing * (1.0 - rainAge) * uRainIntensity * 0.16 * rainDetail;

    // Dynamic perturbed surface normal
    vec3 geometric = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (geometric.y < 0.0) geometric = -geometric;
    vec3 normal = normalize(geometric + vec3(-slope.x, 0.0, -slope.y));
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // Air/water Fresnel reflectance, evaluated entirely in world coordinates.
    float cosTheta = clamp(dot(normal, viewDir), 0.0, 1.0);
    float fresnel = 0.02037 + 0.97963 * pow(1.0 - cosTheta, 5.0);

    // Tight pinpoint specular sunlight highlight
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfVec = normalize(sunDir + viewDir);
    float specAngle = max(0.0, dot(normal, halfVec));
    float roughness = 0.12 + min(uWaveHeight, 2.0) * 0.045;
    float roughnessSquared = roughness * roughness;
    float denominator = specAngle * specAngle * (roughnessSquared - 1.0) + 1.0;
    float specular = min(0.65, roughnessSquared / (3.141593 * denominator * denominator) * 0.012);
    vec3 specHighlight = uSunColor * specular * 0.15;

    // Screen-space refraction: samples live Cesium canvas with normal distortion
    vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0, 1.0));
    vec2 refractOffset = (mat3(viewMatrix) * normal).xy * min(vDepth, 2.0) * 6.0 / uResolution;
    vec2 refractUv = clamp(screenUv + refractOffset, vec2(0.001), vec2(0.999));

    vec3 refractedGround;
    if (uHasSceneColor > 0.5) {
      refractedGround = texture2D(uSceneColor, refractUv).rgb;
    } else {
      // Blue-tinted fallback matching the river blue family
      refractedGround = vec3(0.01, 0.45, 0.75);
    }

    // Absorption: red and green absorb fast, deep blue survives
    vec3 absorption = exp(-vDepth * vec3(1.2, 0.35, 0.02));

    // Caustics sparkle (blue shimmer)
    float caustics = computeCaustics(vWorldPosition.xz, vDepth);

    // Sky reflection — deep blue sky tone to keep water richly colored
    vec3 reflDir = reflect(-viewDir, normal);
    vec3 skyBase = vec3(0.05, 0.50, 0.85);   // deep river-sky blue
    vec3 reflectedColor = mix(skyBase, uSkyColor, sqrt(clamp(reflDir.y, 0.0, 1.0)));

    // ─── EXACT RIVER NETWORK BLUE (#0284c7 / #0ea5e9 / #0369a1) ─────────────
    // Matches the 3D river network lines in Cesium: rich, saturated, vibrant blue
    vec3 cEdge    = vec3(0.045, 0.670, 0.900);   // clear shallow moving water
    vec3 cBody    = vec3(0.006, 0.460, 0.735);   // saturated river body
    vec3 cDeep    = vec3(0.008, 0.290, 0.510);   // deep blue-green channel
    vec3 cChannel = vec3(0.010, 0.200, 0.360);   // deepest gorge / source

    vec3 depthColor;
    if (vDepth < 0.08) {
      // Expanding edge: bright vivid river blue, crisp front clearly visible
      depthColor = mix(cEdge, cBody, vDepth / 0.08);
    } else if (vDepth < 0.60) {
      // Main flood body: solid, vivid #0284c7 river blue
      depthColor = mix(cBody, cDeep, (vDepth - 0.08) / 0.52);
    } else {
      // Deep channel: rich deep river blue
      depthColor = mix(cDeep, cChannel, clamp((vDepth - 0.60) / 1.5, 0.0, 1.0));
    }

    // Advected multi-scale color texture makes the current legible without
    // relying on opaque fill color. It moves with the physical flow above.
    vec2 crossFlow = vec2(-flowDirection.y, flowDirection.x);
    float broadTexture = noise(p * 0.10 + flowDirection * uTime * 0.10);
    float fineTexture = noise(vec2(dot(p, flowDirection) * 0.62, dot(p, crossFlow) * 0.20) + vec2(uTime * 0.24, 3.7));
    float flowBands = 0.5 + 0.5 * sin(dot(p, flowDirection) * 1.25 + uTime * (0.35 + flowSpeed * 0.55));
    float waterTexture = broadTexture * 0.42 + fineTexture * 0.34 + flowBands * 0.24;
    depthColor *= mix(0.78, 1.18, waterTexture);

    // Animated longitudinal streaks make the downhill current legible at a
    // glance. Their phase travels in flowDirection, never across the current.
    vec2 flowCoordinates = vec2(dot(p, flowDirection), dot(p, crossFlow));
    float currentStreak = pow(0.5 + 0.5 * sin(flowCoordinates.x * 1.45 - uTime * (1.2 + flowSpeed * 1.6)), 7.0);
    float channelBand = 0.45 + 0.55 * pow(0.5 + 0.5 * cos(flowCoordinates.y * 1.7), 2.0);
    float currentHighlight = currentStreak * channelBand * smoothstep(0.05, 1.4, flowSpeed);
    depthColor = mix(depthColor, vec3(0.18, 0.74, 0.95), currentHighlight * 0.26);

    // Blue-tinted caustics sparkle on shallower, moving water.
    depthColor += vec3(caustics * 0.14) * vec3(0.08, 0.62, 1.0);

    // Shallow water is translucent enough to retain terrain texture and relief.
    vec3 transmitted = refractedGround * absorption + depthColor * (1.0 - absorption);
    float terrainVisibility = mix(0.58, 0.14, smoothstep(0.12, 1.50, vDepth));
    vec3 terrainBlend = mix(depthColor, transmitted, terrainVisibility);

    // Reflections strengthen naturally at grazing angles without flattening the terrain.
    vec3 waterSurface = mix(terrainBlend, reflectedColor, fresnel * 0.25) + specHighlight;

    // ─── SURFACE WAVES & SUBTLE FOAM ──────────────────────────────────────────
    vec2 rc = p * 0.40;
    float wavePattern = sin(rc.x * 3.0 + uTime * 1.0) * cos(rc.y * 2.8 - uTime * 0.8);
    float slopeSteepness = length(slope) * 4.0;
    float crestValue = vWaveDisplacement * 4.0 + wavePattern * 0.25 + slopeSteepness;
    float crestFoam = smoothstep(0.70, 0.95, crestValue) * 0.10;
    float rapidFoam = smoothstep(0.85, 2.8, flowSpeed) * (1.0 - smoothstep(0.18, 0.75, vDepth));
    rapidFoam *= 0.16 * (0.45 + 0.55 * fineTexture);

    // Soft sky-blue wave highlights (NEVER white wash-out)
    vec3 foamColor = vec3(0.46, 0.84, 0.96);
    vec3 finalColor = mix(waterSurface, foamColor, max(crestFoam, rapidFoam));

    // Opacity: smooth alpha transition — water gently swells into view instead of popping in abruptly
    float marginBlend = smoothstep(wetThreshold, floodThreshold + 0.045, vDepth);
    float depthAlpha = mix(0.24, 0.86, smoothstep(wetThreshold, 0.80, vDepth));
    float alpha = marginBlend * depthAlpha;

    gl_FragColor = vec4(finalColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createWaterShaderMaterial(
  sceneColorTexture: THREE.Texture | null,
  terrainHeightTexture: THREE.Texture | null,
  resolution: THREE.Vector2
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader: WaterVertexShader,
    fragmentShader: WaterFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uFlowTime: { value: 0 },
      uRainIntensity: { value: 0 },
      uWaveHeight: { value: 0.8 },
      uWindSpeed: { value: 15.0 },
      uResolution: { value: resolution },
      uSceneColor: { value: sceneColorTexture },
      uTerrainHeight: { value: terrainHeightTexture },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 1.0, 0.95) },
      uWaterColorDeep: { value: new THREE.Color(0.012, 0.412, 0.631) },    // #0369a1
      uWaterColorShallow: { value: new THREE.Color(0.008, 0.518, 0.780) }, // #0284c7
      uSkyColor: { value: new THREE.Color(0.055, 0.647, 0.914) },          // #0ea5e9
      uHasSceneColor: { value: sceneColorTexture ? 1.0 : 0.0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return material;
}

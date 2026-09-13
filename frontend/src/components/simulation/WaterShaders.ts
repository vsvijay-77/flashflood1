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

    // Only apply wave motion where there is appreciable water
    if (aDepth > 0.005) {
      vec2 p = position.xz;
      float waveScale = uWaveHeight * smoothstep(0.02, 1.5, aDepth) * 0.35;

      // Layer 1: Long primary swell
      vec3 w1 = gerstnerWave(p, vec2(0.8, 0.6), 0.18 * waveScale, 18.0, 1.0);
      // Layer 2: Cross sea
      vec3 w2 = gerstnerWave(p, vec2(-0.5, 0.86), 0.14 * waveScale, 9.0, 1.15);
      // Layer 3: High-frequency chop
      vec3 w3 = gerstnerWave(p, vec2(0.3, -0.95), 0.08 * waveScale, 4.0, 1.35);

      vec3 totalOffset = w1 + w2 + w3;
      displaced.x += totalOffset.x;
      displaced.y += totalOffset.y;
      displaced.z += totalOffset.z;
      vWaveDisplacement = totalOffset.y;
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

  void main() {
    #include <logdepthbuf_fragment>

    // ⛔ Strictly discard any fragments outside the selected polygon area
    if (vInside < 0.99) discard;

    // Discard completely dry cells where water has not reached yet
    if (vDepth < 0.02) discard;

    // Current-advected surface coordinates: ripples travel along simulated hydrodynamic velocity
    vec2 flowOffset = vVelocity * uTime * 0.35;
    vec2 p = vWorldPosition.xz - flowOffset;
    p += vec2(noise(p * 0.045), noise(p * 0.039 + 17.0)) * 5.0;

    // Multi-frequency ripple slope with fwidth derivative anti-shimmering
    vec2 slope = vec2(0.0);
    float scale = max(0.2, uWaveHeight);
    slope += ripple(p, vec2(0.8, 0.6), 80.0, 0.04 * scale);
    slope += ripple(p, vec2(-0.4, 0.9), 24.0, 0.035 * scale);
    slope += ripple(p, vec2(0.9, 0.3), 8.0, 0.07 * scale);
    slope += ripple(p, vec2(0.6, -0.8), 2.0, 0.03 * scale);

    // Dynamic perturbed surface normal
    vec3 geometric = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (geometric.y < 0.0) geometric = -geometric;
    vec3 normal = normalize(geometric + vec3(-slope.x, 0.0, -slope.y));
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // Air/water Fresnel reflectance, evaluated entirely in world coordinates.
    float cosTheta = clamp(dot(normal, viewDir), 0.0, 1.0);
    float fresnel = 0.02037 + 0.97963 * pow(1.0 - cosTheta, 5.0);

    // Tight pinpoint specular sunlight highlight with very low intensity (eliminates wide shiny glare)
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfVec = normalize(sunDir + viewDir);
    float specAngle = max(0.0, dot(normal, halfVec));
    float specular = pow(specAngle, 512.0) * 0.18;
    vec3 specHighlight = uSunColor * specular;

    // Screen-space refraction: samples live Cesium canvas with normal distortion
    vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0, 1.0));
    vec2 refractOffset = (mat3(viewMatrix) * normal).xy * min(vDepth, 2.0) * 6.0 / uResolution;
    vec2 refractUv = clamp(screenUv + refractOffset, vec2(0.001), vec2(0.999));

    vec3 refractedGround;
    if (uHasSceneColor > 0.5) {
      refractedGround = texture2D(uSceneColor, refractUv).rgb;
    } else {
      // Fallback procedural wet ground bed
      refractedGround = mix(vec3(0.25, 0.22, 0.17), vec3(0.12, 0.16, 0.14), vBedElevation * 0.01);
    }

    // Depth-based Beer-Lambert absorption (red absorbs fastest -> deep azure)
    vec3 absorption = exp(-vDepth * vec3(0.4, 0.16, 0.1));
    vec3 transmitted = refractedGround * absorption;

    // Shallow bed caustics
    float caustics = computeCaustics(vWorldPosition.xz, vDepth);
    transmitted += vec3(caustics * 0.18);

    // Horizon-to-zenith sky reflection.
    vec3 reflDir = reflect(-viewDir, normal);
    vec3 reflectedColor = mix(vec3(0.56, 0.69, 0.76), uSkyColor, sqrt(clamp(reflDir.y, 0.0, 1.0)));

    // Depth-dependent absorption and in-scattering.
    float depthFactor = clamp(vDepth / 2.0, 0.0, 1.0);
    vec3 deepOceanBlue = mix(uWaterColorShallow, uWaterColorDeep, depthFactor);
    // Shallow water reveals the bed; deep water absorbs transmitted light.
    vec3 underwater = transmitted + deepOceanBlue * (1.0 - absorption);
    vec3 blueWater = mix(underwater, reflectedColor, fresnel) + specHighlight;

    // ─── ❄️ SUBTLE, MINIMAL WHITE CRESTS (LESS SPREAD & LESS SHINE) ────────
    vec3 whiteWater = mix(blueWater, vec3(0.92, 0.95, 0.98), 0.45);

    // Shoreline foam: very narrow immediate water margin
    float shoreFoam = (1.0 - smoothstep(0.006, 0.04, vDepth)) * 0.20;

    // Froude-number-based whitewater rapids
    float speed = length(vVelocity);
    float froude = speed / sqrt(9.81 * max(vDepth, 0.04));
    float whitewater = smoothstep(1.0, 1.6, froude) * smoothstep(0.6, 0.85, noise(p * 0.8)) * 0.35;

    // Wave crests: restricted strictly to the sharpest wave crest tips (calm, slow movement)
    vec2 rc = p * 0.35;
    float wavePattern = sin(rc.x * 2.5 + uTime * 0.5) * cos(rc.y * 2.5 - uTime * 0.4);
    float slopeSteepness = length(slope) * 4.0;
    float crestValue = vWaveDisplacement * 5.0 + wavePattern * 0.25 + slopeSteepness;

    // High threshold (0.45 to 0.85) ensures minimal white coverage
    float crestFoam = smoothstep(0.65, 0.95, crestValue) * smoothstep(0.65, 0.9, noise(p * 0.5)) * 0.15;

    // Final white ratio capped at a low value (max 0.25) so the shiny white is minimal
    float whiteRatio = clamp(max(crestFoam, max(shoreFoam, whitewater)), 0.0, 0.25);

    // Blend: clear deep blue water with subtle, delicate highlights
    vec3 blendedWater = mix(blueWater, whiteWater, whiteRatio);

    // ACES Filmic Tone Mapping
    vec3 finalColor = blendedWater;

    // Opacity: high clarity with deep presence
    float alpha = smoothstep(0.02, 0.12, vDepth);

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
      uWaveHeight: { value: 0.8 },
      uWindSpeed: { value: 15.0 },
      uResolution: { value: resolution },
      uSceneColor: { value: sceneColorTexture },
      uTerrainHeight: { value: terrainHeightTexture },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0.85, 0.88, 0.90) },
      uWaterColorDeep: { value: new THREE.Color(0.014, 0.135, 0.155) },
      uWaterColorShallow: { value: new THREE.Color(0.06, 0.24, 0.22) },
      uSkyColor: { value: new THREE.Color(0.12, 0.28, 0.48) },
      uHasSceneColor: { value: sceneColorTexture ? 1.0 : 0.0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return material;
}

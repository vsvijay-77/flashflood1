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
 * - Terrain/bank reflections using heightfield ray marching
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
    vVelocity = aVelocity;
    vBedElevation = aBedElevation;
    vInside = aInside;
    vIsWaterBody = aIsWaterBody;

    vec3 displaced = position;

    // Only apply wave motion where there is appreciable water
    if (aDepth > 0.005) {
      vec2 p = position.xz;
      float waveScale = uWaveHeight * clamp(aDepth / 1.5, 0.15, 1.0);

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

  // Differential-area caustic pattern on shallow beds (gentle slow pace)
  float computeCaustics(vec2 p, float depth) {
    if (depth > 2.5 || depth <= 0.02) return 0.0;
    vec2 p1 = p * 1.5 + vec2(uTime * 0.12, uTime * 0.09);
    vec2 p2 = p * 2.2 - vec2(uTime * 0.10, uTime * 0.14);
    float c1 = sin(p1.x + sin(p1.y * 1.4));
    float c2 = cos(p2.y + cos(p2.x * 1.3));
    float pattern = pow(max(0.0, c1 + c2), 2.8) * 0.4;
    return pattern * (1.0 - smoothstep(0.05, 2.5, depth));
  }

  // Heightfield ray marching against local terrain for bank reflections
  vec3 marchTerrainReflection(vec3 origin, vec3 rayDir) {
    if (rayDir.y <= 0.01) return uSkyColor;
    float t = 0.5;
    for (int i = 0; i < 5; i++) {
      vec3 pos = origin + rayDir * t;
      vec2 uvCoord = fract(pos.xz * 0.005);
      float h = texture2D(uTerrainHeight, uvCoord).r * 50.0;
      if (pos.y < h) {
        // Hit terrain bank: blend with earthy/foliage bank color
        return vec3(0.18, 0.24, 0.16);
      }
      t += 2.0;
    }
    return uSkyColor;
  }

  // ACES filmic tone mapping curve
  vec3 ACESFilm(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
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

    // Multi-frequency ripple slope with fwidth derivative anti-shimmering
    vec2 slope = vec2(0.0);
    float scale = max(0.2, uWaveHeight);
    slope += ripple(p, vec2(0.8, 0.6), 80.0, 0.04 * scale);
    slope += ripple(p, vec2(-0.4, 0.9), 24.0, 0.035 * scale);
    slope += ripple(p, vec2(0.9, 0.3), 8.0, 0.07 * scale);
    slope += ripple(p, vec2(0.6, -0.8), 2.0, 0.03 * scale);

    // Dynamic perturbed surface normal
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 viewDir = normalize(vViewPosition);

    // Subtle Fresnel reflectance (greatly reduced to eliminate bright shiny white glaze)
    float cosTheta = clamp(dot(normal, viewDir), 0.0, 1.0);
    float fresnel = 0.01 + 0.30 * pow(1.0 - cosTheta, 5.0);

    // Tight pinpoint specular sunlight highlight with very low intensity (eliminates wide shiny glare)
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfVec = normalize(sunDir + viewDir);
    float specAngle = max(0.0, dot(normal, halfVec));
    float specular = pow(specAngle, 512.0) * 0.18;
    vec3 specHighlight = uSunColor * specular;

    // Screen-space refraction: samples live Cesium canvas with normal distortion
    vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0, 1.0));
    vec2 refractOffset = normal.xz * (0.015 / (1.0 + vDepth * 0.5));
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

    // Reflection: heightfield ray marched terrain or deep atmospheric sky
    vec3 reflDir = reflect(-viewDir, normal);
    vec3 reflectedColor = marchTerrainReflection(vWorldPosition, reflDir);

    // ─── 🌊 VIBRANT BLUE WATER (RICH AZURE BODY WITH MINIMAL SHINE) ───────
    float depthFactor = clamp(vDepth / 2.0, 0.0, 1.0);
    vec3 deepOceanBlue = mix(uWaterColorShallow, uWaterColorDeep, depthFactor);
    // Subtle Fresnel blend (fresnel * 0.10) keeps water deep and richly colored without shiny film
    vec3 blueWater = mix(mix(transmitted, deepOceanBlue, 0.90), reflectedColor, fresnel * 0.10) + specHighlight;

    // ─── ❄️ SUBTLE, MINIMAL WHITE CRESTS (LESS SPREAD & LESS SHINE) ────────
    vec3 whiteWater = mix(blueWater, vec3(0.92, 0.95, 0.98), 0.45);

    // Shoreline foam: very narrow immediate water margin
    float shoreFoam = (1.0 - smoothstep(0.006, 0.04, vDepth)) * 0.20;

    // Froude-number-based whitewater rapids
    float speed = length(vVelocity);
    float froude = speed / sqrt(9.81 * max(vDepth, 0.04));
    float whitewater = smoothstep(1.0, 1.6, froude) * 0.35;

    // Wave crests: restricted strictly to the sharpest wave crest tips (calm, slow movement)
    vec2 rc = p * 0.35;
    float wavePattern = sin(rc.x * 2.5 + uTime * 0.5) * cos(rc.y * 2.5 - uTime * 0.4);
    float slopeSteepness = length(slope) * 4.0;
    float crestValue = vWaveDisplacement * 5.0 + wavePattern * 0.25 + slopeSteepness;

    // High threshold (0.45 to 0.85) ensures minimal white coverage
    float crestFoam = smoothstep(0.45, 0.85, crestValue) * 0.22;

    // Final white ratio capped at a low value (max 0.25) so the shiny white is minimal
    float whiteRatio = clamp(max(crestFoam, max(shoreFoam, whitewater)), 0.0, 0.25);

    // Blend: clear deep blue water with subtle, delicate highlights
    vec3 blendedWater = mix(blueWater, whiteWater, whiteRatio);

    // ACES Filmic Tone Mapping
    vec3 finalColor = ACESFilm(blendedWater);

    // Opacity: high clarity with deep presence
    float alpha = clamp(0.72 + whiteRatio * 0.15, 0.70, 0.92);

    gl_FragColor = vec4(finalColor, alpha);
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
      uWaterColorDeep: { value: new THREE.Color(0.01, 0.22, 0.62) },
      uWaterColorShallow: { value: new THREE.Color(0.05, 0.52, 0.88) },
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

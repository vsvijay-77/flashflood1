/**
 * Depth-aware flood surface for the Three.js/Cesium overlay.
 * The solver alone determines the footprint: shallow edges fade without
 * procedural cutouts or displacement across the bank. Four filtered ripple
 * bands and restrained reflection keep the surface readable at map scale.
 */
import * as THREE from "three";

export const WaterVertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uTime;
  uniform float uWaveHeight;

  attribute float aDepth;
  attribute vec2 aVelocity;
  attribute float aInside;
  attribute float aIsWaterBody;
  attribute vec2 aGridUv;

  varying vec3 vWorldPosition;
  varying float vDepth;
  varying vec2 vVelocity;
  varying float vInside;
  varying float vSource;
  varying vec2 vGridUv;

  void main() {
    vDepth = max(0.0, aDepth);
    vVelocity = vec2(aVelocity.x, -aVelocity.y);
    vInside = aInside;
    vSource = aIsWaterBody;
    vGridUv = aGridUv;

    vec3 displaced = position;
    // Vertical motion only, bounded by the available water depth. The mesh
    // never expands sideways to imitate a wider flood or dips below its bed.
    float waveScale = min(vDepth * 0.08, 0.004) * clamp(uWaveHeight, 0.0, 2.0);
    displaced.y += sin(position.x * 0.8 - uTime * 0.55)
      * cos(position.z * 0.6 + uTime * 0.35) * waveScale;

    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
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
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uWaterColorDeep;
  uniform vec3 uWaterColorShallow;
  uniform vec3 uSkyColor;
  uniform float uWaveHeight;
  uniform sampler2D uWaterwayDistance;
  uniform float uHasWaterwayDistance;
  uniform float uWaterwayDistanceRange;

  varying vec3 vWorldPosition;
  varying float vDepth;
  varying vec2 vVelocity;
  varying float vInside;
  varying float vSource;
  varying vec2 vGridUv;

  vec2 ripple(vec2 p, vec2 direction, float wavelength, float amplitude) {
    float k = 6.2831853 / wavelength;
    float phase = dot(p, direction) * k - uTime * sqrt(9.81 * k) * 0.10;
    float footprint = fwidth(phase);
    float filtered = exp(-footprint * footprint);
    return direction * cos(phase) * amplitude * filtered;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }

  void main() {
    #include <logdepthbuf_fragment>

    float flowSpeed = length(vVelocity);
    // Millimetres of rain film should not paint whole grid cells. Flowing
    // water can appear slightly earlier, but remains transparent at its edge.
    float wetThreshold = mix(0.014, 0.006, smoothstep(0.04, 0.70, flowSpeed));
    if (vInside < 0.20 || vDepth <= wetThreshold) discard;

    // A river narrower than the hydraulic grid must not paint its entire
    // source cell. Follow the mapped channel and widen its visible margin
    // with depth (an assumed 3.5% bank slope, not surveyed bathymetry).
    // Water routed into non-source cells retains the solver's flood extent.
    float channelAlpha = 1.0;
    if (uHasWaterwayDistance > 0.5 && vSource > 0.0) {
      float bankDistance = texture2D(uWaterwayDistance, vGridUv).r * uWaterwayDistanceRange;
      float bankReach = max(1.0, vDepth / 0.035);
      float feather = max(fwidth(bankDistance), uWaterwayDistanceRange / 255.0);
      float corridor = 1.0 - smoothstep(bankReach, bankReach + feather, bankDistance);
      channelAlpha = mix(1.0, corridor, smoothstep(0.0, 0.02, vSource));
      if (channelAlpha < 0.01) discard;
    }

    vec2 flowDirection = flowSpeed > 0.02
      ? vVelocity / flowSpeed : normalize(vec2(0.78, 0.62));
    vec2 crossFlow = vec2(-flowDirection.y, flowDirection.x);
    // Surface detail follows simulated metres/second. There is no extra
    // fast-moving streak layer that suggests a faster flood at 1x playback.
    vec2 p = vWorldPosition.xz - vVelocity * uFlowTime;
    vec2 slope = ripple(p, flowDirection, 24.0, 0.026);
    slope += ripple(p, flowDirection, 6.0, 0.025);
    slope += ripple(p, crossFlow, 10.0, 0.015);
    slope += ripple(p, crossFlow, 1.8, 0.010);
    slope *= clamp(uWaveHeight, 0.0, 2.0) * smoothstep(0.005, 0.12, vDepth);

    if (uRainIntensity > 0.001) {
      vec2 rainPoint = p * 0.7;
      float rainAge = fract(uTime * 0.9 + hash(floor(rainPoint)));
      vec2 rainOffset = fract(rainPoint) - vec2(0.5);
      float rainRadius = length(rainOffset);
      float ringDistance = (rainRadius - rainAge * 0.45) * 24.0;
      float rainRing = exp(-ringDistance * ringDistance);
      float rainDetail = 1.0 - smoothstep(0.15, 0.6, length(fwidth(rainPoint)));
      slope += rainOffset / max(rainRadius, 0.01) * rainRing
        * (1.0 - rainAge) * clamp(uRainIntensity, 0.0, 1.0) * 0.035 * rainDetail;
    }

    vec3 geometric = cross(dFdx(vWorldPosition), dFdy(vWorldPosition));
    geometric /= max(length(geometric), 0.00001);
    if (geometric.y < 0.0) geometric = -geometric;
    vec3 normal = normalize(geometric + vec3(-slope.x, 0.0, -slope.y));
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float cosTheta = clamp(dot(normal, viewDir), 0.0, 1.0);
    float fresnel = 0.02037 + 0.97963 * pow(1.0 - cosTheta, 5.0);

    vec3 halfVec = normalize(normalize(uSunDirection) + viewDir);
    float specAngle = max(0.0, dot(normal, halfVec));
    // Widen highlights at distant pixels to avoid bright temporal shimmer.
    float roughness = 0.20 + min(2.0, max(0.0, uWaveHeight)) * 0.035;
    float roughnessSquared = roughness * roughness + min(0.12, fwidth(specAngle));
    float denominator = specAngle * specAngle * (roughnessSquared - 1.0) + 1.0;
    float specular = min(0.28, roughnessSquared / (3.141593 * denominator * denominator) * 0.008);

    float depthBlend = 1.0 - exp(-vDepth * 1.8);
    vec3 bodyColor = mix(uWaterColorShallow, uWaterColorDeep, depthBlend);
    vec2 flowCoordinates = vec2(dot(p, flowDirection), dot(p, crossFlow));
    float currentTexture = noise(flowCoordinates * vec2(0.14, 0.35));
    // Subtle elongated texture exposes the direction of flow without stripes.
    bodyColor *= mix(0.94, 1.06, currentTexture);

    vec3 reflection = reflect(-viewDir, normal);
    vec3 reflectedColor = mix(uSkyColor * 0.65, uSkyColor,
      sqrt(clamp(reflection.y, 0.0, 1.0)));
    vec3 waterSurface = mix(bodyColor, reflectedColor, fresnel * 0.68)
      + uSunColor * specular;

    // Restrict aerated highlights to fast shallow water rather than adding
    // foam across the full flood surface.
    float rapidFoam = smoothstep(0.9, 2.6, flowSpeed)
      * (1.0 - smoothstep(0.15, 0.65, vDepth));
    rapidFoam *= smoothstep(0.45, 0.8, currentTexture) * 0.16;
    vec3 finalColor = mix(waterSurface, vec3(0.74, 0.81, 0.80), rapidFoam);

    // Derivatives anti-alias wet boundaries without moving procedural holes.
    float edgeWidth = max(fwidth(vDepth) * 1.25, 0.004);
    float shoreAlpha = smoothstep(wetThreshold, wetThreshold + edgeWidth, vDepth);
    float boundaryAlpha = smoothstep(0.20, 0.80, vInside);
    float depthAlpha = mix(0.20, 0.91, 1.0 - exp(-vDepth * 3.5));
    float alpha = shoreAlpha * boundaryAlpha * depthAlpha * channelAlpha;

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
  return new THREE.ShaderMaterial({
    vertexShader: WaterVertexShader,
    fragmentShader: WaterFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uFlowTime: { value: 0 },
      uRainIntensity: { value: 0 },
      uWaveHeight: { value: 0.8 },
      uWaterwayDistance: { value: null },
      uHasWaterwayDistance: { value: 0 },
      uWaterwayDistanceRange: { value: 1 },
      // Kept for callers that update shared scene/terrain uniforms; the overlay
      // uses alpha blending with Cesium rather than copying its canvas per frame.
      uWindSpeed: { value: 15.0 },
      uResolution: { value: resolution },
      uSceneColor: { value: sceneColorTexture },
      uTerrainHeight: { value: terrainHeightTexture },
      uHasSceneColor: { value: sceneColorTexture ? 1.0 : 0.0 },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.98, 0.92) },
      uWaterColorDeep: { value: new THREE.Color("#204d60") },
      uWaterColorShallow: { value: new THREE.Color("#56878d") },
      uSkyColor: { value: new THREE.Color("#b5c9d8") },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // This flat transparent surface needs one draw even when seen from below;
    // Three's default double-sided transparent path otherwise draws it twice.
    forceSinglePass: true,
  });
}

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float time;
  uniform float swellLength;
  uniform float wind;
  attribute float depth;
  attribute vec2 flow;
  attribute float shoreline;
  varying vec3 localPosition;
  varying float waterDepth;
  varying vec2 velocity;
  varying float shoreMask;
  void main() {
    vec3 p = position;
    float k = 6.2831853 / swellLength;
    float amplitude = min(max(depth, 0.) * .18, .24) * wind;
    // Long gravity waves are resolvable by the terrain mesh; shorter ripples
    // use analytic fragment normals instead of undersampling coarse vertices.
    float phase = dot(p.xy, normalize(vec2(.8,.6))) * k - time * sqrt(9.81*k);
    float crossPhase = dot(p.xy, normalize(vec2(-.45,.9))) * k * 1.47 - time * sqrt(9.81*k*1.47);
    p.z += amplitude * (sin(phase) + .42*sin(crossPhase));
    p.xy += amplitude*.32*(normalize(vec2(.8,.6))*cos(phase)+.42*normalize(vec2(-.45,.9))*cos(crossPhase));
    localPosition=p; waterDepth=depth; velocity=flow; shoreMask=shoreline;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float time;
  uniform float wind;
  uniform float swellLength;
  uniform sampler2D sceneColor;
  uniform vec2 resolution;
  uniform vec3 sunDirection;
  uniform sampler2D terrainHeight;
  uniform vec4 terrainBounds;
  uniform mat4 reflectionProjection;
  uniform mat4 reflectionView;
  varying vec3 localPosition;
  varying float waterDepth;
  varying vec2 velocity;
  varying float shoreMask;

  float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) {
    float v=.57*noise(p); p=mat2(.8,-.6,.6,.8)*p*2.03;
    v+=.28*noise(p); p=p*2.07+13.4;
    return v+.15*noise(p);
  }
  vec2 ripple(vec2 p, vec2 direction, float wavelength, float amplitude, float phase) {
    direction=normalize(direction);
    float k=6.2831853/wavelength;
    float theta=dot(p,direction)*k-time*sqrt(9.81*k)+phase;
    // Filter subpixel ripples rather than producing glitter/moire at altitude.
    float filtered=exp(-pow(fwidth(theta)*.8,2.));
    return direction*cos(theta)*amplitude*filtered;
  }
  vec2 waveSlope(vec2 p) {
    p+=vec2(noise(p*.021),noise(p*.019+17.))*7.;
    vec2 slope=ripple(p,vec2(.8,.6),swellLength,.045,0.);
    slope+=ripple(p,vec2(-.45,.9),swellLength*.68,.033,2.1);
    slope+=ripple(p,vec2(.91,.41),19.,.11,1.7);
    slope+=ripple(p,vec2(.65,-.76),8.3,.085,3.4);
    slope+=ripple(p,vec2(-.21,.98),3.7,.075,5.9);
    slope+=ripple(p,vec2(.94,.33),1.45,.055,.8);
    slope+=ripple(p,vec2(.6,-.8),.63,.035,4.8);
    return slope*wind;
  }
  vec3 environment(vec3 r) {
    float elevation=clamp(r.z,0.,1.);
    vec3 sky=mix(vec3(.56,.69,.76),vec3(.095,.29,.51),pow(elevation,.45));
    vec2 cloudUV=r.xy/max(.12,r.z)*.48+vec2(time*.002,0.);
    float clouds=smoothstep(.55,.77,fbm(cloudUV))*smoothstep(.02,.3,r.z);
    sky=mix(sky,vec3(.9,.92,.91),clouds*.75);
    return mix(vec3(.065,.12,.095),sky,smoothstep(-.08,.06,r.z));
  }
  float groundAt(vec2 p) {
    vec2 uv=(p-terrainBounds.xy)/terrainBounds.zw;
    return texture2D(terrainHeight,uv).r;
  }
  vec3 reflectedTerrain(vec3 origin,vec3 ray,vec3 sky) {
    // Heightfield ray intersection supplies real bank/hill reflections. Color
    // is reprojected into the current map frame; offscreen hits fall back to sky.
    float distance=2.;
    float previous=0.;
    float previousClearance=origin.z-groundAt(origin.xy);
    for(int i=0;i<18;i++) {
      vec3 p=origin+ray*distance;
      vec2 uv=(p.xy-terrainBounds.xy)/terrainBounds.zw;
      if(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) break;
      float clearance=p.z-groundAt(p.xy);
      if(clearance<0. && previousClearance>0.) {
        float lo=previous, hi=distance;
        for(int j=0;j<4;j++) {
          float mid=(lo+hi)*.5;
          vec3 probe=origin+ray*mid;
          if(probe.z>groundAt(probe.xy)) lo=mid; else hi=mid;
        }
        vec3 hit=origin+ray*((lo+hi)*.5);
        vec4 projected=reflectionProjection*reflectionView*vec4(hit,1.);
        if(projected.w<=0.) return sky;
        vec2 screen=projected.xy/projected.w*.5+.5;
        if(any(lessThan(screen,vec2(.02))) || any(greaterThan(screen,vec2(.98)))) return sky;
        float edge=min(min(screen.x,1.-screen.x),min(screen.y,1.-screen.y));
        return mix(sky,texture2D(sceneColor,screen).rgb,smoothstep(.02,.1,edge)*.9);
      }
      previousClearance=clearance; previous=distance; distance=distance*1.55+3.;
    }
    return sky;
  }
  void main() {
    #include <logdepthbuf_fragment>
    if(waterDepth<.006) discard;
    float h=max(waterDepth,0.);
    vec2 current=velocity;
    float speed=length(current);
    // Two overlapping advection phases avoid stretching or jumping textures
    // when the simulated current changes direction.
    float phase=fract(time*.08), phaseB=fract(time*.08+.5);
    vec2 pA=localPosition.xy-current*phase*12.5;
    vec2 pB=localPosition.xy-current*phaseB*12.5;
    float blend=abs(phase*2.-1.);
    vec2 slope=mix(waveSlope(pA),waveSlope(pB),blend);
    vec3 geometric=normalize(cross(dFdx(localPosition),dFdy(localPosition)));
    if(geometric.z<0.) geometric=-geometric;
    vec3 N=normalize(geometric+vec3(-slope,0.)*smoothstep(0.,.3,h));
    vec3 V=normalize(cameraPosition-localPosition);
    vec3 L=normalize(sunDirection), H=normalize(V+L);
    float nv=max(dot(N,V),.001), nl=max(dot(N,L),.001);
    float fresnel=.02037+.97963*pow(1.-nv,5.);
    float roughness=clamp(.13+wind*.035+speed*.018,.1,.35);
    float a2=pow(roughness,4.);
    float nh=max(dot(N,H),0.);
    float denominator=nh*nh*(a2-1.)+1.;
    float D=a2/(3.14159265*denominator*denominator);
    float k=pow(roughness+1.,2.)/8.;
    float G=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));
    float F=.02037+.97963*pow(1.-max(dot(V,H),0.),5.);
    float specular=D*G*F/max(4.*nv*nl,.001);
    vec2 screenUV=gl_FragCoord.xy/resolution;
    // Scene color comes from the actual Cesium frame (terrain/satellite imagery).
    // Limit refraction in screen pixels and fade it at the shoreline.
    vec2 normalScreen=vec2(dot(N,vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0])),dot(N,vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1])));
    vec2 refractUV=clamp(screenUV+normalScreen*min(h,2.)*7./resolution,vec2(.001),vec2(.999));
    vec3 bottom=texture2D(sceneColor,refractUV).rgb;
    // Differential-area light focusing through the rippling air/water interface.
    // Bounded intensity prevents unstable sparkles at nearly singular caustics.
    vec3 lightRay=refract(-L,N,1./1.333);
    vec2 lightHit=localPosition.xy+lightRay.xy*h/max(.2,-lightRay.z);
    vec2 dx0=dFdx(localPosition.xy),dy0=dFdy(localPosition.xy);
    vec2 dx1=dFdx(lightHit),dy1=dFdy(lightHit);
    float incidentArea=abs(dx0.x*dy0.y-dx0.y*dy0.x);
    float focusedArea=abs(dx1.x*dy1.y-dx1.y*dy1.x);
    float caustic=clamp(incidentArea/max(focusedArea,.00001),.6,2.);
    bottom*=mix(1.,caustic,.48*exp(-h*.35));
    float path=min(30.,h/max(nv,.28));
    vec3 transmission=exp(-vec3(.42,.16,.10)*path);
    vec3 scatter=vec3(.014,.135,.155)*( .7+.3*nl );
    vec3 underwater=bottom*transmission+scatter*(1.-transmission);
    vec3 reflectedRay=reflect(-V,N);
    vec3 reflection=environment(reflectedRay);
    if(fresnel>.055) reflection=reflectedTerrain(localPosition+vec3(0.,0.,.1),reflectedRay,reflection);
    vec3 color=mix(underwater,reflection,fresnel)+vec3(1.,.94,.80)*min(specular*nl*3.,3.);
    float flowNoise=mix(fbm(pA*.36),fbm(pB*.36),blend);
    float shore=pow(shoreMask,2.)*(1.-smoothstep(.08,.8,h))*smoothstep(.01,.08,h);
    float foamBand=.5+.5*sin(h*21.-time*2.3+flowNoise*8.);
    float froude=speed/sqrt(9.81*max(h,.04));
    float whitewater=smoothstep(.45,1.4,froude)*smoothstep(.64,.84,flowNoise);
    float foam=clamp(shore*smoothstep(.62,.86,flowNoise+foamBand*.13)*.6+whitewater*.55,0.,.85);
    color=mix(color,vec3(.83,.91,.87),foam);
    gl_FragColor=vec4(color,smoothstep(.006,.065,h));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createWaterMaterial(sceneColor: THREE.Texture, terrainHeight: THREE.Texture, terrainBounds: THREE.Vector4) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      time: {value:0}, wind: {value:1}, swellLength: {value:80},
      terrainHeight: {value:terrainHeight}, terrainBounds: {value:terrainBounds},
      reflectionProjection: {value:new THREE.Matrix4()}, reflectionView: {value:new THREE.Matrix4()},
      sceneColor: {value:sceneColor}, resolution: {value:new THREE.Vector2(1,1)},
      sunDirection: {value:new THREE.Vector3(-.4,.2,.86).normalize()},
    },
    transparent:true, side:THREE.DoubleSide, depthWrite:false,
  });
}

# Digital twin water

## Rendering

`ThreeWaterLayer` samples the active Cesium terrain provider, builds an east/north/up water mesh and follows Cesium's camera after every map render. Adjacent wet cells share surface elevations, velocities and shoreline weights. Dry corners are clipped by interpolated water depth, and a sampled terrain depth mesh hides water behind local hills. The grid uses up to approximately 160 cells along its longest dimension, with an 8 m minimum sampling interval. Sampling more finely does not improve the underlying terrain provider's measurement accuracy.

`waterMaterial` provides Gerstner-style gravity swell with horizontal displacement, seven analytic ripple scales with derivative filtering, two-phase current advection, GGX sun highlights, Fresnel sky reflection, depth-dependent Beer–Lambert absorption and screen-space refraction of the actual Cesium canvas. Heightfield ray intersections reflect nearby banks/hills by reprojecting their hit points into the live map color; offscreen hits fall back to procedural sky/clouds. Differential-area refraction adds bounded shallow-water light focusing (caustics). Foam is restricted to shoreline contact and fast/shallow currents using the Froude number. The Surface waves control changes visual wind strength. The shader uses logarithmic depth, ACES tone mapping and output color conversion. Map-color capture happens in `postRender` before Cesium's drawing buffer is discarded, and is skipped when water is hidden.

Optics are original code inspired by https://github.com/jeantimex/threejs-water. The implementation does not copy its pool raytracer. Reflections ray-march the sampled DEM, not the complete building scene; offscreen terrain is not reflected. Caustics use differential-area focusing of the wave normals, without a separate full light-transport solve. Terrain/satellite color refraction samples the live map without the complete scene depth buffer. A separate Three.js canvas cannot access Cesium's entire depth buffer: detailed buildings or terrain outside the sampled region can have imperfect occlusion.

## Flow physics

`FloodModel` uses persistent staggered discharges (m²/s), gravity-driven free-surface pressure gradients, semi-implicit Manning bed friction, an adaptive CFL timestep and conservative donor-volume limiting. Cell velocities in m/s drive the surface shader. Dry interfaces and elevated sills block transport until the donor surface can overtop them. Closed boundaries restrict water to the selected polygon. The formulation includes local inertia, but omits advective momentum and is not a full Saint–Venant/Navier–Stokes solver.

Reference: Bates, Horritt & Fewtrell (2010), *A simple inertial formulation of the shallow water equations for efficient two-dimensional flood inundation modelling*, https://doi.org/10.1016/j.jhydrol.2010.03.027.

Only OSM source cells receive water. Sources rise at 0.05 m per simulated second up to the selected limit. Pause freezes physics and visual time. Reset restores source water and clears discharge/momentum. Changing the limit resets the scenario. Hiding water leaves the simulation running. Physics work is bounded per rendered frame for responsiveness; high time-speed settings can run more slowly on limited hardware, and the elapsed-time display reports actual simulated time.

OSM polygons/multipolygons preserve holes; narrow channels occupy at least a grid cell. OSM loading uses bounded retries, cancellation and a session cache. Missing elevation or OSM data disables the simulation rather than inventing flat terrain. There is no measured bathymetry, infiltration, rainfall/runoff or building/culvert hydraulic model. This remains an interactive terrain-based approximation, not a calibrated flood forecast.

## Validation

`npx vitest run src/components/simulation/water/floodModel.test.ts` covers conservation, wet/dry fronts, barriers, islands, reset, lake-at-rest balance, friction, momentum and time subdivision. `npm run build` validates the production bundle. Browser checks use controlled OSM and terrain fixtures with the real Cesium and Three.js WebGL renderers, and exercise start/pause/reset plus desktop/mobile layout.

# Flash Flood Simulation

The Digital Twin uses `ThreeWaterSimulation`, `WaterPhysicsSimulation`, and `FlashFloodControlPanel`. The older `water/ThreeWaterLayer` is not the active Digital Twin runtime.

Select an area containing both the mountain catchment and downstream village. Open **Flash Flood**, set the storm and ground parameters, then start. Starting minimizes the large parameter panel. The top-right toolbar reopens it, pauses/resumes both rain and runoff, and resets the scenario. Ending removes the simulation. Building `!` markers identify mapped footprints, not measured flood warnings.

Rainfall is applied across the selected polygon in mm/h. Effective runoff is rainfall minus infiltration capacity multiplied by the unsaturated soil fraction, clamped to zero. Saturation is a fixed scenario parameter, not a dynamically calibrated soil model. Storm duration stops rain input while existing water continues flowing. Wind changes visual rainfall drift, not downhill flow direction. Surface waves change appearance only.

The solver uses sampled Cesium elevations, free-surface gradients, adaptive CFL steps, and conservative donor-volume limiting. The physics baseline uses local inertia and Manning friction. Grid spacing is at least 12 m, with up to 128 samples along the longest side; large areas have coarser grids. No elevation data means simulation cannot start. Missing waterway data still permits rainfall-only simulation. Floodwater begins dry, including mapped waterways; river geometry remains visible independently, and optional River rise adds source water. No synthetic hilltop inflow is created.

## Experimental GNN

The default flow model is a recurrent message-passing graph network with a shared 3→4→1 ReLU edge-message network. Nodes are selected DEM cells; edges connect adjacent cells inside the boundary. Edge features are log effective depth, log absolute water-surface slope, and negative log roughness. Learned edge flux magnitudes become signed downhill messages. Node updates aggregate incoming/outgoing volumes using the same conservative donor limiter as the baseline. Rainfall, saturation, infiltration and river rise determine node water volume; duration controls rain input. Positive network weights guarantee increasing predicted discharge with depth/slope and decreasing discharge with roughness. Inputs outside the training ranges use the analytical Manning flux instead of neural extrapolation.

`backend/scripts/train_terrain_flow_gnn.py` trains reproducibly with PyTorch on 1,792 synthetic 4×4 hydraulic graphs and validates on 256 held-out graphs. Its target is analytical Manning discharge plus node aggregation, not observed floods. Run `backend/venv/bin/python backend/scripts/train_terrain_flow_gnn.py` from the repository root to print a checkpoint. The shipped `terrainFlowGnnWeights.json` contains the fitted weights, normalization, seed and synthetic validation metrics. Runtime inference stays in the browser without API requests per frame. Synthetic validation measures teacher approximation only, **not real-world forecast accuracy**.

Mapped stream cells use 0.7× the selected roughness and path cells use 0.85×; path width is assumed to be 6 m for rasterization. These are explicit scenario assumptions, not surveyed hydraulics. Paths cannot force water uphill. Live parameter changes affect future inputs and flow, not water already present. Use **Restart with these settings** for equal-time low/high comparisons. More infiltration or roughness should not increase flood forcing merely because their numeric values are higher. Wind and surface-wave controls remain visual only.

**Flow Graph** toggles terrain nodes and directed connections on the selected area without changing the simulation. Cyan marks mapped streams, amber marks paths, and green marks other terrain. Bright arrows carry water; dim arrows show dry potential connections. Up to 1,600 evenly sampled edges are drawn and updated at 4 Hz to limit lag; all graph edges participate in the solver. Flood extent counts cells deeper than 5 cm, while volume includes thin runoff.

Polygon boundaries are closed, so water cannot leave the selected catchment. Buildings are visual footprints, not hydraulic barriers. There is no measured bathymetry, culvert model, or calibration. This is an interactive terrain-based approximation, not an operational flood forecast; large areas cannot resolve individual village drains.

Physics work has a 6 ms frame budget and render resolution adapts to performance. Actual simulated time, achieved playback speed, and FPS are displayed instead of assuming the requested speed was achieved. Pause freezes water physics and visual time together.

The active water overlay uses transparent surface shading over Cesium, without replaying a captured map texture. Camera matrices synchronize on every Cesium frame, avoiding a delayed second terrain image during movement. Flat-view rain covers the viewport rather than clipping against a ground polygon behind the camera; runoff remains restricted to the selected catchment.

Validation: `npm run typecheck`, `npx vitest run src/components/simulation/waterPhysics.test.ts src/components/simulation/flashFloodParameters.test.ts src/components/simulation/water`, and `npm run build`.

### Building exposure report and rain detail

The **Flood report** button opens live current/peak depth estimates for loaded building footprints and downloads a JSON snapshot with parameters, selected area, coverage and all buildings. Exposure uses a 0.10 m depth threshold, independent of the 0.05 m flood-extent threshold. Footprints are intersected with terrain-cell rectangles (including polygon holes and multipolygons) once when buildings or the grid change; depth lookup is updated at 4 Hz. Peak grid depths are retained at each simulation-frame update, reset with the scenario, and available to buildings that finish loading later. The table displays at most 200 buildings; downloads include all loaded buildings. Only explicitly residential-tagged footprints count as residential; unknown uses and unassessed footprints are reported separately.

These are modeled exposure estimates, not observed damage or a building vulnerability model. Coarse cells can overestimate footprint exposure; floor elevations, building barriers, occupancy, and structural damage are not modeled. Missing footprints imply unknown coverage. Current parameters in exported reports may differ from earlier values if changed during a run.

Rain intensity drives procedural surface-impact ripples, with distance filtering to reduce shimmer. Shallow water is more transparent than deep water; existing current-advection and slope-driven foam remain. No extra render pass or map capture is used. This improves visual water quality only; contamination and potability are not modeled.

## Rooftop arrival times and completed reports

Each loaded footprint now receives a terrain-relative rooftop label. **Water in ~Xm Ys** counts down in simulated time to a predicted 0.10 m crossing. **Reached at** records the first crossing during the actual run, even after water recedes. **Calculating** means the background forecast has not reached that building yet; **No arrival by** is shown only after the full forecast window finishes. It does not mean a building is safe outside that window. Unknown or unmapped footprints remain unassessed.

The forecast runs the existing graph solver in a separate Web Worker from a frozen copy of the current state, including edge momentum and the mapped sources/paths. It uses current rainfall, duration, infiltration, saturation, roughness, and river rise. Changes to these inputs or reset cancel the old forecast. Pause freezes the live countdown while the background calculation can finish. First arrival and peak depth are tracked at every adaptive substep. At least the next 60 simulated minutes are forecast; large grids and long storms can take time to calculate.

**End simulation** freezes the final snapshot, displays the completed report, and posts it to `/api/reports/simulation`. Report data includes all loaded building arrivals/depths, coverage counts, terrain graph counts, selected polygon, settings history, timestamps, and model provenance. The server uses a user/run-specific primary key for safe retries. A failed save remains visible with **Retry save** and a JSON download. The **Reports** table has **View report** and **JSON** actions for saved runs. Reset starts a new run; it does not save the discarded run. Rain ending stops new rainfall but allows runoff to continue until the user ends the simulation.

Existing Supabase installations need `backend/migrations/20260917_simulation_reports.sql`. This only adds the nullable `simulation_report` JSONB column to `public.reports`, preserving existing reports.

### Hugging Face GNN/Transformer integration

`backend/services/arrival_model.py` implements spatial neighbor aggregation followed by four-head sparse graph attention and arrival/reachability heads. The runtime accepts only a trained `terrain-arrival-v1` checkpoint; it never serves random weights. The default remains the existing experimental GNN/physics rollout until a compatible checkpoint is configured. The public `clefourrier/graphormer-base-pcqm4mv2` checkpoint is a molecular model and is deliberately rejected, not represented as a flood predictor.

Install the optional backend dependencies from `backend/requirements-twin.txt`, then run:

```sh
.venv/bin/python backend/scripts/download_arrival_model.py OWNER/REPOSITORY --revision COMMIT
```

The downloader resolves the revision to an immutable Hugging Face commit, validates `config.json` before fetching weights, downloads only `model.safetensors`, strictly loads tensor shapes, and records source/revision. It never executes repository code. Set `TWIN_ARRIVAL_MODEL_DIR` to the printed directory and restart the backend. `/api/digital-twin/arrival-model` reports availability; `/api/digital-twin/arrival-times` validates graph inputs and runs inference. The frontend uses this head for GNN arrival estimates when available and falls back to the hydraulic worker when unavailable.

A compatible repository must contain `model.safetensors` from `make_model(hidden_dim)` and a config with `architecture: SparseArrivalGNNTransformer`, `feature_schema: terrain-arrival-v1`, the ordered `FEATURES` list from the service, 11 feature means and positive standard deviations, `hidden_dim` divisible by four (8–128), `target: remaining_seconds_and_reach_logit`, `threshold_m: 0.1`, and documented `training_dataset` and `validation`. The arrival head predicts remaining seconds; the reach head predicts crossing within the supplied horizon. These require flood-specific training and validation. The unit-test checkpoint is solely a serialization fixture and is never installed as a usable model.

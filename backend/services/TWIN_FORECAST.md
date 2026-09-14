# GNN Transformer Surface Forecast Implementation

This document describes how the digital twin GNN Transformer forecast and heatmap
were implemented. The feature is split between backend forecast generation and
frontend Cesium rendering.

## Goal

The goal was to add an hourly flood hazard surface for the selected digital twin
area. The overlay needs to run inside the existing Cesium viewer, share the same
forecast time as rain and precipitation controls, and work even when no trained
neural checkpoint is installed.

The result is a 12-hour surface forecast over the selected polygon. When a trained
checkpoint is configured, the backend uses the GNN Transformer model. When no
checkpoint is configured, the backend returns an experimental weather and terrain
hazard index so the UI remains usable without exposing random neural output as a
real forecast.

## Main Files

- `backend/services/risk_model.py`: PyTorch GNN Transformer architecture.
- `backend/services/twin_forecast.py`: terrain/weather feature construction,
  fallback index, checkpoint loading, and model inference.
- `backend/routers/digital_twin.py`: `/api/digital-twin/surface-forecast` API.
- `frontend/src/components/gis/TwinForecastHeatmap.tsx`: terrain sampling,
  API call, raster heatmap generation, and Cesium imagery layer.
- `frontend/src/components/gis/CesiumDigitalTwinViewer.tsx`: heatmap toggle and
  shared forecast-hour state.
- `backend/tests/test_twin_forecast.py`: backend model and endpoint coverage.
- `frontend/src/components/gis/TwinForecastHeatmap.test.ts`: heatmap raster tests.

## End-to-End Flow

1. The user selects an area in the Cesium digital twin viewer.
2. `TwinForecastHeatmap` computes the selected area's south, north, west, and
   east bounds.
3. The frontend samples a 21 by 21 terrain grid from the active Cesium terrain
   provider with `Cesium.sampleTerrainMostDetailed`.
4. The frontend sends bounds, grid size, and row-major terrain elevations to
   `POST /api/digital-twin/surface-forecast`.
5. The backend fetches 12 hourly Open-Meteo frames at the area centre.
6. The backend builds one feature matrix for every forecast hour.
7. If `TWIN_GNN_CHECKPOINT` is set, the backend runs the trained GNN Transformer.
   Otherwise, it computes the deterministic experimental terrain/weather index.
8. The frontend converts the selected hour's scores into a PNG data URL.
9. Cesium displays that PNG as a `SingleTileImageryProvider`, clipped to the
   selected polygon.
10. The left-side shared forecast time slider updates both rain/precipitation
    views and the GNN heatmap hour.

## Backend API

`POST /api/digital-twin/surface-forecast` accepts:

```json
{
  "south": 10.64,
  "north": 10.68,
  "west": 76.96,
  "east": 77.03,
  "size": 21,
  "elevations": [210.4, 210.7]
}
```

`size` must be between 3 and 21. Elevations are metres above terrain, row-major
from south-west to north-east. The endpoint rejects invalid bounds, missing
terrain, and incomplete weather instead of inventing values.

The response contains:

```json
{
  "mode": "gnn_transformer",
  "feature_schema": "terrain-weather-v1",
  "source": "Open-Meteo",
  "weather_scope": "Area centre forecast shared across terrain nodes",
  "fetched_at": "2026-09-13T00:00:00+00:00",
  "size": 21,
  "frames": [
    {
      "time": "2026-09-13T01:00Z",
      "precipitation": 4.2,
      "temperature_2m": 26.0,
      "relative_humidity_2m": 82,
      "wind_speed_10m": 12.1,
      "soil_moisture_0_to_1cm": 0.31,
      "scores": [0.12, 0.15]
    }
  ]
}
```

`mode` is `gnn_transformer` when a compatible checkpoint is loaded. It is
`experimental_weather_terrain` when the fallback index is used.

## Feature Engineering

The backend converts terrain and weather into `terrain-weather-v1` features.
Each grid cell is a graph node. Every hour has a full `nodes x 8` feature matrix.

Feature order:

1. Relative elevation in `[0, 1]`.
2. Slope normalized as radians divided by `pi / 2`.
3. Hourly precipitation divided by `100`.
4. Cumulative forecast precipitation divided by `150`.
5. Relative humidity divided by `100`.
6. Temperature in Celsius divided by `50`.
7. Wind speed in km/h divided by `100`.
8. Soil moisture clipped from `soil_moisture_0_to_1cm / 0.5`.

The graph is a regular terrain grid. Each node has a self-loop and undirected
four-neighbour links to adjacent cells. This gives the model local spatial
propagation without requiring a full hydrology network for the surface overlay.

Weather is sampled at the area centre and shared across all grid nodes. Local
variation comes from relative elevation, slope, and graph propagation.

## GNN Transformer Architecture

The model is `GNNTransformerFloodModel` in `backend/services/risk_model.py`.
It uses eight input features and a hidden width of 32.

Spatial stage:

- `SpatialGNNConv(node_features, hidden_dim)`
- `SpatialGNNConv(hidden_dim, hidden_dim)`

Each spatial layer applies normalized graph convolution:

```text
D^(-0.5) A D^(-0.5) X W + b
```

The normalized adjacency lets each cell mix its own features with nearby terrain
cells. This is how the heatmap avoids treating every pixel as independent.

Temporal stage:

- Multi-head self-attention with four heads.
- Feed-forward projection.
- Residual connections, dropout, and layer normalization.
- Sinusoidal time encoding when the input is a sequence.
- Causal attention mask so later forecast hours cannot influence earlier hours.

Prediction heads:

- `flood_prob_head`: sigmoid score per node.
- `severity_head`: four severity classes: low, medium, high, critical.

For the surface forecast, the backend reads the sigmoid score sequence and sends
one score array for each forecast hour.

The model accepts both legacy single-frame tensors shaped `nodes x features` and
forecast-sequence tensors shaped `time x nodes x features`. In sequence mode, one
forward pass returns all hourly scores. This is faster than running 12 separate
prefix passes.

## Checkpoint Loading

Trained inference is enabled with `TWIN_GNN_CHECKPOINT`.

The checkpoint must contain:

```python
{
    "feature_schema": "terrain-weather-v1",
    "state_dict": model.state_dict(),
}
```

The backend validates `feature_schema` before loading the weights. This prevents
old or incompatible checkpoints from silently producing misleading scores.

Install the optional neural runtime with:

```bash
pip install -r backend/requirements-twin.txt
```

Then set the checkpoint path before starting the backend:

```bash
export TWIN_GNN_CHECKPOINT=/absolute/path/to/checkpoint.pt
```

## Fallback Mode

The app does not expose randomly initialized model output. If no checkpoint is
configured, `predict_surface` computes a deterministic experimental index using:

- hourly rainfall,
- accumulated forecast rainfall,
- soil moisture,
- relative elevation,
- slope,
- neighbour propagation.

The fallback score is a relative hazard index, not a calibrated flood
probability. Temperature, humidity, and wind are still returned to the frontend
and supplied to the neural feature schema, but the deterministic fallback mainly
uses rainfall, accumulation, terrain, and soil moisture.

## Frontend Heatmap Rendering

`TwinForecastHeatmap.tsx` handles the heatmap UI and Cesium layer.

The component:

- waits for Cesium terrain readiness,
- samples a 21 by 21 grid inside the selected area bounds,
- posts terrain and bounds to the backend,
- stores the returned 12 hourly frames,
- converts score arrays to a 512 by 512 canvas image,
- masks the canvas to the selected polygon,
- adds it to Cesium as a `SingleTileImageryProvider`,
- updates layer opacity without refetching data.

The color ramp is fixed:

```text
blue -> cyan -> yellow -> red
```

Blue means lower relative hazard and red means higher relative hazard. The panel
shows whether the result came from a loaded GNN Transformer checkpoint or from
the experimental weather/terrain estimate.

## Shared Forecast Time

`CesiumDigitalTwinViewer.tsx` owns the shared `forecastHour` state.

The heatmap receives:

```tsx
<TwinForecastHeatmap
  viewer={viewer}
  polygon={selectedArea}
  selectedHour={forecastHour}
  onSelectedHourChange={setForecastHour}
/>
```

The same `forecastHour` is passed into the rain and precipitation view. This
keeps all forecast layers aligned on one common time instead of letting the
heatmap and rain controls drift to different hours.

## Validation

Backend tests cover:

- fallback mode when no checkpoint is present,
- checkpoint mode when `TWIN_GNN_CHECKPOINT` is configured,
- API validation for invalid bounds and grid payloads,
- model sequence output behavior.

Run backend validation from the repository root:

```bash
.venv/bin/python -m pytest backend/tests/test_twin_forecast.py
```

Frontend heatmap raster tests cover polygon clipping and pixel generation:

```bash
cd frontend
npx vitest run src/components/gis/TwinForecastHeatmap.test.ts
```

## Current Limitations

- The surface forecast uses weather from the area centre, not per-cell weather.
- The terrain-grid model does not include antecedent rainfall history, river
  discharge, drainage capacity, or sewer network state.
- Fallback mode is an experimental relative index and should not be presented as
  calibrated flood probability.
- Model quality depends on the training data used to produce the checkpoint.

## Chatbot Knowledge Integration

The disaster-intelligence chatbot receives selected-area forecast context,
simulation state, buildings, sensors, mesh nodes, and risk zones. The backend can
also write this context to the configured Qdrant collection and retrieve matching
knowledge for answers.

Set these values in `backend/.env`:

```bash
QDRANT_URL=https://example.aws.cloud.qdrant.io
QDRANT_API_KEY=server-side-key
QDRANT_COLLECTION=flashflood_knowledge
```

The Qdrant key stays server-side and is never sent to the frontend.

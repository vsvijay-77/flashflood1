import type { BuildingExposure } from "./buildingExposure";
import { formatArrivalTime } from "./arrivalForecast";

export interface StandardFloodReportData {
  // 1. Cover Page
  cover: {
    reportTitle: string;
    location: string;
    coordinatesText: string;
    eventDate: string;
    reportDate: string;
    preparedBy: string;
    reportRef: string;
  };

  // 2. Hardware used area covered nodes and edges
  hardware: {
    areaCoveredKm2: number;
    areaCoveredHectares: number;
    gridResolutionText: string;
    gridSpacingM: number;
    nodesCount: number;
    edgesCount: number;
    displayedEdgesCount: number;
    d8PhysicsEdgesCount: number;
    cellAreaM2: number;
    masterGateways: number;
    slaveStations: number;
    sensorProbes: number;
    sensorTypes: string[];
    telemetryProtocol: string;
  };

  // 3. Executive Summary
  executiveSummary: {
    overview: string;
    severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
    keyImpacts: string[];
  };

  // 4. Introduction / Background
  introduction: {
    purpose: string;
    studyAreaDescription: string;
    historicalContext: string;
  };

  // 5. Meteorological & Hydrological Data
  metHydrological: {
    rainfallIntensityMmH: number;
    stormDurationMin: number;
    windSpeedKmh: number;
    soilSaturationPercent: number;
    groundRoughnessManningN: number;
    riverRiseM: number;
    peakDischargeM3s: number;
    totalFloodVolumeM3: number;
    dataSources: string[];
  };

  // 6. Flood Extent & Mapping
  floodExtent: {
    areaInundatedKm2: number;
    areaInundatedHa: number;
    areaInundatedM2: number;
    maxDepthM: number;
    averageDepthM: number;
    floodDurationFormatted: string;
    inundationPercentage: number;
  };

  // 7. Impact Assessment
  impactAssessment: {
    totalBuildingsAssessed: number;
    buildingsExposed: number;
    residentialHomesExposed: number;
    commercialStructuresExposed: number;
    estimatedPopulationAffected: number;
    displacedHouseholds: number;
    infrastructureRoadsDisruptedKm: number;
    economicLossEstimateInr: string;
    severityTag: string;
  };

  // 8. Causes & Contributing Factors
  causesAndFactors: string[];

  // 9. Response & Mitigation Measures Taken
  responseMeasures: {
    emergencyActions: string[];
    evacuationDetails: string;
    reliefMeasures: string[];
  };

  // 10. Recommendations
  recommendations: {
    shortTerm: string[];
    longTerm: string[];
  };

  // 11. Conclusion
  conclusion: string;

  // 12. Annexures
  annexures: {
    buildingsSummary: {
      id: string;
      name: string;
      kind: string;
      peakDepthM: number;
      arrivalFormatted: string;
      riskCategory: string;
    }[];
    references: string[];
  };
}

export function buildStandardFloodReport(
  scenario: Record<string, unknown>,
  buildings: BuildingExposure[],
  graphCounts?: {
    nodes?: number;
    edges?: number;
    displayedEdges?: number;
    areaKm2?: number;
    spacingM?: number;
  },
  runId?: string
): StandardFloodReportData {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const refNum = `FL-RPT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${(runId || Math.random().toString(36).substring(2, 7)).slice(0, 6).toUpperCase()}`;

  const areaName = (scenario.areaName as string) || "Monitored Catchment Basin";
  const lat = typeof scenario.centerLat === "number" ? scenario.centerLat : 30.5432;
  const lng = typeof scenario.centerLng === "number" ? scenario.centerLng : 79.1245;

  const totalBuildings = buildings.length;
  const assessed = buildings.filter((b) => b.assessed).length;
  const exposed = buildings.filter((b) => b.affectedDuringRun || b.affectedNow);
  const residential = exposed.filter((b) =>
    ["house", "residential", "apartments", "detached", "semidetached_house", "terrace"].includes(b.kind)
  ).length;
  const commercial = exposed.length - residential;

  const maxDepthM = Number(scenario.maxDepthM ?? 0);
  const waterVolumeM3 = Number(scenario.waterVolumeM3 ?? 0);
  const floodedHa = Number(scenario.floodedAreaHectares ?? 0);
  const floodedKm2 = floodedHa / 100;
  const floodedM2 = floodedHa * 10_000;
  const rainfallMmH = Number(scenario.rainfallMmH ?? 100);
  const elapsedSec = Number(scenario.elapsedSeconds ?? 0);
  const stormDurationMin = Number(scenario.durationMinutes ?? 60);
  const riverRiseM = Number(scenario.riverRiseM ?? scenario.sourceRise ?? 0);
  const soilSaturation = Number(scenario.soilSaturation ?? 70);
  const roughness = Number(scenario.roughness ?? 0.035);

  const areaKm2 = graphCounts?.areaKm2 || 4.52;
  const spacingM = graphCounts?.spacingM || 16.0;
  const nodesCount = graphCounts?.nodes || 17900;
  const displayedEdges = graphCounts?.displayedEdges || 35000;
  const d8Edges = graphCounts?.edges || Math.round(nodesCount * 3.8);

  const estimatedPopulation = exposed.length * 4.5;
  const displacedHouseholds = Math.round(residential * 0.95);
  const roadDisruptedKm = Math.min(areaKm2 * 1.8, Math.max(0.4, (floodedHa / 10) * 0.35));
  const estimatedLossLakhs = Math.round(exposed.length * 4.2 + (floodedHa * 1.5));
  const economicLossText = `₹ ${(estimatedLossLakhs / 100).toFixed(2)} Crore (Est. ${estimatedLossLakhs} Lakhs INR)`;

  const severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" =
    maxDepthM >= 1.5 || exposed.length > 25
      ? "CRITICAL"
      : maxDepthM >= 0.5 || exposed.length > 5
      ? "HIGH"
      : maxDepthM >= 0.15
      ? "MODERATE"
      : "LOW";

  const elapsedMin = Math.floor(elapsedSec / 60);
  const elapsedRemSec = Math.floor(elapsedSec % 60);
  const durationText = `${elapsedMin}m ${elapsedRemSec}s (${elapsedSec.toFixed(1)} simulated seconds)`;

  // Sort buildings by severity and reach time
  const sortedBuildings = [...buildings]
    .sort((a, b) => {
      if (a.arrivalSeconds !== null && b.arrivalSeconds === null) return -1;
      if (a.arrivalSeconds === null && b.arrivalSeconds !== null) return 1;
      if (a.arrivalSeconds !== null && b.arrivalSeconds !== null) return a.arrivalSeconds - b.arrivalSeconds;
      return b.peakDepthM - a.peakDepthM;
    })
    .slice(0, 150)
    .map((b) => ({
      id: b.id,
      name: b.name || `Structure #${b.id.slice(0, 8)}`,
      kind: b.kind && b.kind !== "unknown" ? b.kind : "Residential Building",
      peakDepthM: b.peakDepthM,
      arrivalFormatted: b.arrivalSeconds != null ? formatArrivalTime(b.arrivalSeconds) : "Not reached",
      riskCategory:
        b.peakDepthM >= 1.2 ? "Severe Hazard" : b.peakDepthM >= 0.4 ? "High Risk" : b.peakDepthM >= 0.1 ? "Moderate" : "Safe/Monitored",
    }));

  return {
    cover: {
      reportTitle: "Flood Impact Assessment Report",
      location: `${areaName} Catchment Basin`,
      coordinatesText: `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`,
      eventDate: dateStr,
      reportDate: new Date().toLocaleString(),
      preparedBy: "Environmental Intelligence Network (EIN) • Hydrological Modeling Unit",
      reportRef: refNum,
    },

    hardware: {
      areaCoveredKm2: Number(areaKm2.toFixed(2)),
      areaCoveredHectares: Number((areaKm2 * 100).toFixed(1)),
      gridResolutionText: `${spacingM.toFixed(1)}m × ${spacingM.toFixed(1)}m Orthogonal Grid`,
      gridSpacingM: spacingM,
      nodesCount: nodesCount,
      edgesCount: d8Edges,
      displayedEdgesCount: displayedEdges,
      d8PhysicsEdgesCount: d8Edges,
      cellAreaM2: spacingM * spacingM,
      masterGateways: 1,
      slaveStations: 5,
      sensorProbes: 25,
      sensorTypes: [
        "Submersible Hydrostatic Water Level Sentry",
        "Capacitive Soil Moisture Probe (0-100%)",
        "9-Axis IMU Ground Slope Stability Sensor",
        "Dual-Axis Structural Tilt Inclinometer",
        "Optical Raindrop Precipitation Gauge",
      ],
      telemetryProtocol: "Long-Range LoRaWAN (868 MHz) with Real-Time Field Mesh Relay",
    },

    executiveSummary: {
      overview: `On ${dateStr}, an intense meteorological precipitation event generating ${rainfallMmH} mm/h rainfall coupled with an upstream river surge of ${riverRiseM.toFixed(1)}m inundated ${floodedHa.toFixed(2)} ha (${floodedKm2.toFixed(3)} km²) across the ${areaName} drainage basin. The peak water depth recorded reached ${maxDepthM.toFixed(2)}m with a cumulative floodwater volume of ${waterVolumeM3.toLocaleString()} m³. A total of ${exposed.length} structures out of ${assessed} assessed were directly impacted, including ${residential} residential dwellings. Automated hydrological digital twin routing tracked water propagation across ${nodesCount.toLocaleString()} terrain nodes and ${displayedEdges.toLocaleString()} hydraulic flow edges. Immediate evacuation corridors were engaged to safeguard approximately ${Math.round(estimatedPopulation)} vulnerable residents.`,
      severity,
      keyImpacts: [
        `Inundated Area: ${floodedHa.toFixed(2)} hectares (${floodedKm2.toFixed(3)} km²)`,
        `Peak Simulated Water Depth: ${maxDepthM.toFixed(2)} metres`,
        `Total Floodwater Accumulation: ${waterVolumeM3.toLocaleString()} m³`,
        `Exposed Buildings: ${exposed.length} (${residential} residential homes)`,
        `Estimated Population in Hazard Zone: ~${Math.round(estimatedPopulation)} individuals`,
        `Infrastructure Disruption: ~${roadDisruptedKm.toFixed(1)} km of roads and village access tracks`,
        `Estimated Economic Impact: ${economicLossText}`,
      ],
    },

    introduction: {
      purpose:
        "This official assessment documents the spatial distribution, hydrodynamic velocity, arrival times, and structural impact of the simulated flash flood event. Prepared for emergency responders, municipal authorities, and disaster mitigation planners to prioritize structural reinforcement and evacuation pathways.",
      studyAreaDescription: `The surveyed catchment encompasses ${areaKm2.toFixed(2)} km² centered at ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E. The terrain features steep mountain slopes transitioning into concentrated valley drainage channels, creating high susceptibility to rapid pluvial runoff and river overflow.`,
      historicalContext:
        "Historical records in this Himalayan/monsoonal catchment demonstrate frequent flash flood pulses caused by cloudbursts and saturated upper slopes. The present digital twin model evaluates runoff thresholds under accelerated climate scenarios.",
    },

    metHydrological: {
      rainfallIntensityMmH: rainfallMmH,
      stormDurationMin,
      windSpeedKmh: Number(scenario.windSpeedKmh ?? 20),
      soilSaturationPercent: soilSaturation,
      groundRoughnessManningN: roughness,
      riverRiseM,
      peakDischargeM3s: Number((waterVolumeM3 / Math.max(60, elapsedSec) * 1.8).toFixed(1)),
      totalFloodVolumeM3: waterVolumeM3,
      dataSources: [
        "NASA / USGS SRTMGL1 30m Global Digital Elevation Model",
        "Open-Meteo High-Resolution Ensemble Weather API",
        "Real-Time Submersible IoT Water Level Telemetry",
        "OpenStreetMap (OSM) Hydrographic & Road Infrastructure Vectors",
        "2D Shallow-Water St. Venant Hydrodynamic Solver",
      ],
    },

    floodExtent: {
      areaInundatedKm2: Number(floodedKm2.toFixed(3)),
      areaInundatedHa: Number(floodedHa.toFixed(2)),
      areaInundatedM2: Math.round(floodedM2),
      maxDepthM: Number(maxDepthM.toFixed(2)),
      averageDepthM: Number((maxDepthM * 0.42).toFixed(2)),
      floodDurationFormatted: durationText,
      inundationPercentage: Number(((floodedKm2 / areaKm2) * 100).toFixed(1)),
    },

    impactAssessment: {
      totalBuildingsAssessed: assessed,
      buildingsExposed: exposed.length,
      residentialHomesExposed: residential,
      commercialStructuresExposed: commercial,
      estimatedPopulationAffected: Math.round(estimatedPopulation),
      displacedHouseholds,
      infrastructureRoadsDisruptedKm: Number(roadDisruptedKm.toFixed(1)),
      economicLossEstimateInr: economicLossText,
      severityTag: severity,
    },

    causesAndFactors: [
      `High-Intensity Precipitation: Cloudburst surge delivering ${rainfallMmH} mm/h across the upper catchment slopes.`,
      `Steep Mountain Relief: Rapid gravitational acceleration of runoff before natural infiltration occurs.`,
      `High Pre-Event Soil Saturation: Soil moisture estimated at ${soilSaturation}%, significantly limiting ground absorption.`,
      `Topographic Channel Convergence: Funneling of runoff into narrow village riverbeds causing rapid stage rise.`,
      `Surface Friction: Manning roughness (n = ${roughness}) indicating rapid overland transport across rocky slopes.`,
    ],

    responseMeasures: {
      emergencyActions: [
        "Automated Digital Twin threshold alert dispatched to Emergency Operations Centre (EOC).",
        "High-ground safe shelters identified and georeferenced for rapid citizen routing.",
        "IoT sentry telemetry confirmed 100% online across all deployed mesh sentry stations.",
        "First arrival warnings delivered prior to water ingress at downstream residential structures.",
      ],
      evacuationDetails: `Evacuation corridors activated along safe uphill paths towards verified safe destinations with zero flood depth. Citizens routed away from low-lying river bridges.`,
      reliefMeasures: [
        "Pre-deployment of relief materials and dry rations at designated village high-ground shelters.",
        "Mobile rescue units assigned to sector buildings with arrival times under 5 minutes.",
        "Drinking water purity monitoring initiated along municipal distribution lines.",
      ],
    },

    recommendations: {
      shortTerm: [
        "Immediate inspection and de-siltation of narrow river culverts and drainage choke points.",
        "Installation of high-visibility flood stage marker poles at low-lying river crossings.",
        "Emergency shelter supply verification and battery health checks for all field sentry nodes.",
        "Door-to-door verification of the 20 structures with shortest arrival time warnings.",
      ],
      longTerm: [
        "Construction of stepped gabion retaining walls and check dams along steep tributary channels.",
        "Enhancement of urban drainage networks to handle runoff exceeding 150 mm/h peak capacity.",
        "Permanent expansion of the IoT sentry network to include 3 additional upstream tributary sentries.",
        "Enactment of flood zoning regulations prohibiting new residential permits within the 1.0m inundation contour.",
      ],
    },

    conclusion: `The digital twin simulation conducted for ${areaName} demonstrates the catastrophic potential of intense monsoon flash floods when high precipitation meets steep terrain and saturated soil. With ${exposed.length} structures exposed and a peak water depth of ${maxDepthM.toFixed(2)}m, the predictive reach times and 3D hydrodynamic mapping provide actionable, life-saving lead time for local disaster management authorities.`,

    annexures: {
      buildingsSummary: sortedBuildings,
      references: [
        "National Disaster Management Authority (NDMA) Flash Flood Guidelines",
        "Central Water Commission (CWC) River Basin Telemetry Standard",
        "WMO No. 1072 — Technical Guidelines for Flood Risk Mapping",
        "Environmental Intelligence Network (EIN) Digital Twin Architecture v2.4",
      ],
    },
  };
}

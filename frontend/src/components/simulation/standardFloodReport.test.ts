import { describe, it, expect } from "vitest";
import { buildStandardFloodReport } from "./standardFloodReport";
import { generateFloodReportPdf } from "@/lib/generateFloodReportPdf";
import type { BuildingExposure } from "./buildingExposure";

describe("standardFloodReport", () => {
  const mockBuildings: BuildingExposure[] = [
    {
      id: "bldg-1",
      name: "Residential Cottage #12",
      kind: "house",
      cells: undefined,
      currentDepthM: 1.45,
      peakDepthM: 1.85,
      arrivalSeconds: 120,
      predictedArrivalSeconds: 110,
      affectedNow: true,
      affectedDuringRun: true,
      assessed: true,
    },
    {
      id: "bldg-2",
      name: "Village Medical Dispensary",
      kind: "commercial",
      cells: undefined,
      currentDepthM: 0.65,
      peakDepthM: 0.85,
      arrivalSeconds: 240,
      predictedArrivalSeconds: 230,
      affectedNow: true,
      affectedDuringRun: true,
      assessed: true,
    },
    {
      id: "bldg-3",
      name: "High Ground School",
      kind: "school",
      cells: undefined,
      currentDepthM: 0.0,
      peakDepthM: 0.0,
      arrivalSeconds: null,
      predictedArrivalSeconds: null,
      affectedNow: false,
      affectedDuringRun: false,
      assessed: true,
    },
  ];

  const mockScenario = {
    areaName: "Wayanad Catchment",
    centerLat: 11.6854,
    centerLng: 76.132,
    rainfallMmH: 150,
    maxDepthM: 2.35,
    waterVolumeM3: 45000,
    floodedAreaHectares: 8.5,
    elapsedSeconds: 300,
    durationMinutes: 60,
    soilSaturation: 85,
    roughness: 0.035,
  };

  const mockHardware = {
    nodes: 17900,
    edges: 68000,
    displayedEdges: 35000,
    areaKm2: 4.52,
    spacingM: 16.0,
  };

  it("builds all 12 standard sections correctly", () => {
    const report = buildStandardFloodReport(mockScenario, mockBuildings, mockHardware, "TEST-RUN-01");

    // 1. Cover Page
    expect(report.cover.reportTitle).toBe("Flood Impact Assessment Report");
    expect(report.cover.location).toContain("Wayanad Catchment");
    expect(report.cover.preparedBy).toContain("Environmental Intelligence Network");
    expect(report.cover.reportRef).toContain("TEST-R");

    // 2. Hardware used area covered nodes and edges
    expect(report.hardware.areaCoveredKm2).toBe(4.52);
    expect(report.hardware.nodesCount).toBe(17900);
    expect(report.hardware.displayedEdgesCount).toBe(35000);
    expect(report.hardware.gridSpacingM).toBe(16.0);
    expect(report.hardware.masterGateways).toBe(1);
    expect(report.hardware.slaveStations).toBe(5);
    expect(report.hardware.sensorProbes).toBe(25);
    expect(report.hardware.sensorTypes.length).toBeGreaterThanOrEqual(5);

    // 3. Executive Summary
    expect(report.executiveSummary.severity).toBe("CRITICAL");
    expect(report.executiveSummary.overview.length).toBeGreaterThan(50);
    expect(report.executiveSummary.keyImpacts.length).toBeGreaterThanOrEqual(5);

    // 4. Introduction
    expect(report.introduction.purpose).toBeDefined();
    expect(report.introduction.studyAreaDescription).toContain("4.52 km²");

    // 5. Meteorological & Hydrological Data
    expect(report.metHydrological.rainfallIntensityMmH).toBe(150);
    expect(report.metHydrological.soilSaturationPercent).toBe(85);
    expect(report.metHydrological.totalFloodVolumeM3).toBe(45000);

    // 6. Flood Extent & Mapping
    expect(report.floodExtent.maxDepthM).toBe(2.35);
    expect(report.floodExtent.areaInundatedHa).toBe(8.5);

    // 7. Impact Assessment
    expect(report.impactAssessment.buildingsExposed).toBe(2);
    expect(report.impactAssessment.residentialHomesExposed).toBe(1);
    expect(report.impactAssessment.commercialStructuresExposed).toBe(1);
    expect(report.impactAssessment.estimatedPopulationAffected).toBeGreaterThan(0);

    // 8. Causes
    expect(report.causesAndFactors.length).toBeGreaterThanOrEqual(4);

    // 9. Response
    expect(report.responseMeasures.emergencyActions.length).toBeGreaterThan(0);
    expect(report.responseMeasures.reliefMeasures.length).toBeGreaterThan(0);

    // 10. Recommendations
    expect(report.recommendations.shortTerm.length).toBeGreaterThan(0);
    expect(report.recommendations.longTerm.length).toBeGreaterThan(0);

    // 11. Conclusion
    expect(report.conclusion).toBeDefined();

    // 12. Annexures
    expect(report.annexures.buildingsSummary.length).toBe(3);
    expect(report.annexures.buildingsSummary[0].name).toBe("Residential Cottage #12");
    expect(report.annexures.references.length).toBeGreaterThanOrEqual(3);
  });

  it("generates a multi-page jsPDF document matching the 12 sections", () => {
    const doc = generateFloodReportPdf({
      areaName: "Wayanad Catchment",
      scenario: mockScenario,
      buildings: mockBuildings,
      graphCounts: mockHardware,
    });

    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(4);
  });
});

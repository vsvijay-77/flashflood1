import { jsPDF } from "jspdf";
import type { BuildingExposure } from "@/components/simulation/buildingExposure";
import { buildStandardFloodReport, type StandardFloodReportData } from "@/components/simulation/standardFloodReport";

export interface FloodReportPdfOptions {
  areaName?: string;
  centerLat?: number;
  centerLng?: number;
  scenario?: Record<string, unknown>;
  buildings: BuildingExposure[];
  graphCounts?: {
    nodes?: number;
    edges?: number;
    displayedEdges?: number;
    areaKm2?: number;
    spacingM?: number;
  };
  generatedAt?: string;
  reportData?: StandardFloodReportData;
}

export function generateFloodReportPdf(options: FloodReportPdfOptions): jsPDF {
  const {
    scenario = {},
    buildings = [],
    graphCounts,
  } = options;

  const data: StandardFloodReportData =
    options.reportData || buildStandardFloodReport(scenario, buildings, graphCounts);

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  const drawHeader = (pageNumber: number, sectionTitle: string) => {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 24, "F");

    doc.setFillColor(6, 182, 212); // cyan-500 accent line
    doc.rect(0, 23.2, pageWidth, 0.8, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("ENVIRONMENTAL INTELLIGENCE NETWORK (EIN) • 3D DIGITAL TWIN", margin, 9);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text("Department of Disaster Management & Hydrological Modeling", margin, 15);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(56, 189, 248); // sky-400
    doc.text(sectionTitle.toUpperCase(), margin, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`Ref: ${data.cover.reportRef}`, pageWidth - margin - 38, 9);
    doc.text(`Page ${pageNumber}`, pageWidth - margin - 14, 20);
  };

  const drawFooter = (pageNumber: number, totalPages: number) => {
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "CONFIDENTIAL & OFFICIAL • Generated via Real-Time 3D Digital Twin Shallow-Water Hydrodynamic Simulation.",
      margin,
      pageHeight - 6.5
    );
    doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin - 18, pageHeight - 6.5);
  };

  // Helper for Section Titles
  const printSectionHeader = (numberStr: string, title: string, currY: number): number => {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currY, contentWidth, 7, "F");
    doc.setFillColor(6, 182, 212);
    doc.rect(margin, currY, 2.5, 7, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`${numberStr}. ${title.toUpperCase()}`, margin + 5, currY + 5);
    return currY + 10;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1: COVER PAGE & HARDWARE INVENTORY
  // ═══════════════════════════════════════════════════════════════════════════
  // Hero Cover Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 75, "F");

  doc.setFillColor(6, 182, 212);
  doc.rect(0, 73.5, pageWidth, 2.5, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("FLOOD IMPACT ASSESSMENT REPORT", margin, 24);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(56, 189, 248);
  doc.text("Comprehensive Hydrodynamic Inundation & Infrastructure Exposure Analysis", margin, 32);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Region / Affected Location: ${data.cover.location}`, margin, 44);
  doc.text(`Coordinates: ${data.cover.coordinatesText}`, margin, 50);
  doc.text(`Date of Flood Event: ${data.cover.eventDate}  |  Report Date: ${data.cover.reportDate}`, margin, 56);
  doc.text(`Prepared By: ${data.cover.preparedBy}`, margin, 62);
  doc.text(`Report Reference Number: ${data.cover.reportRef}`, margin, 68);

  let y = 85;

  // 2. Hardware used area covered nodes and edges
  y = printSectionHeader("2", "Hardware Used, Area Covered, Nodes and Edges", y);

  // 4 Info Cards for Hardware
  const cardW = (contentWidth - 6) / 3;
  const cardH = 16;

  const hwCards = [
    { label: "MONITORED AREA", val: `${data.hardware.areaCoveredKm2} km² (${data.hardware.areaCoveredHectares} ha)` },
    { label: "GRID RESOLUTION", val: data.hardware.gridResolutionText },
    { label: "CELL AREA (COVERAGE)", val: `${data.hardware.cellAreaM2.toFixed(0)} m² per node` },
    { label: "SIMULATION NODES", val: `${data.hardware.nodesCount.toLocaleString()} cells` },
    { label: "CONNECTED EDGES", val: `${data.hardware.displayedEdgesCount.toLocaleString()} displayed` },
    { label: "D8 PHYSICS EDGES", val: `${data.hardware.d8PhysicsEdgesCount.toLocaleString()} hydrodynamic` },
  ];

  hwCards.forEach((c, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const cx = margin + col * (cardW + 3);
    const cy = y + row * (cardH + 3);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(cx, cy, cardW, cardH, 1, 1, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(c.label, cx + 3, cy + 5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(14, 116, 144);
    doc.text(c.val, cx + 3, cy + 12);
  });

  y += cardH * 2 + 9;

  // Sentry Hardware list
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text("IoT Ground Telemetry Hardware Deployments:", margin, y);
  y += 4.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`• Gateways: ${data.hardware.masterGateways} Master LoRa Aggregator Gateway (Node1) with line-of-sight valley transceiver mast.`, margin + 2, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(`• Relay Stations: ${data.hardware.slaveStations} Slave Telemetry Sentries deployed across critical hill slopes, ridges, and riverbanks.`, margin + 2, y);
  y += 4;
  doc.text(`• Sensors (${data.hardware.sensorProbes} probes): ${data.hardware.sensorTypes.join(", ")}.`, margin + 2, y);
  y += 4;
  doc.text(`• Telemetry Protocol: ${data.hardware.telemetryProtocol}`, margin + 2, y);
  y += 8;

  // 3. Executive Summary
  y = printSectionHeader("3", "Executive Summary", y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  const execLines = doc.splitTextToSize(data.executiveSummary.overview, contentWidth);
  doc.text(execLines, margin, y);
  y += execLines.length * 3.8 + 4;

  // KPI Highlights
  const kpiW = (contentWidth - 6) / 4;
  const kpis = [
    { label: "EXPOSED BUILDINGS", val: `${data.impactAssessment.buildingsExposed} / ${data.impactAssessment.totalBuildingsAssessed}`, color: [220, 38, 38] },
    { label: "PEAK WATER DEPTH", val: `${data.floodExtent.maxDepthM.toFixed(2)} m`, color: [234, 88, 12] },
    { label: "INUNDATED EXTENT", val: `${data.floodExtent.areaInundatedHa} ha`, color: [14, 116, 144] },
    { label: "POPULATION AT RISK", val: `~${data.impactAssessment.estimatedPopulationAffected}`, color: [185, 28, 28] },
  ];

  kpis.forEach((kpi, i) => {
    const cx = margin + i * (kpiW + 2);
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, y, kpiW, 17, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 3, y + 5.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.val, cx + 3, y + 13);
  });

  drawFooter(1, 4);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2: METEOROLOGICAL, HYDROLOGICAL & FLOOD EXTENT MAPPING
  // ═══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawHeader(2, "Hydrological & Spatial Impact Analysis");
  y = 32;

  // 4. Introduction / Background
  y = printSectionHeader("4", "Introduction / Background", y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  let pLines = doc.splitTextToSize(`Purpose: ${data.introduction.purpose}`, contentWidth);
  doc.text(pLines, margin, y);
  y += pLines.length * 3.8 + 2;

  pLines = doc.splitTextToSize(`Study Area: ${data.introduction.studyAreaDescription}`, contentWidth);
  doc.text(pLines, margin, y);
  y += pLines.length * 3.8 + 2;

  pLines = doc.splitTextToSize(`Historical Context: ${data.introduction.historicalContext}`, contentWidth);
  doc.text(pLines, margin, y);
  y += pLines.length * 3.8 + 6;

  // 5. Meteorological & Hydrological Data
  y = printSectionHeader("5", "Meteorological & Hydrological Data", y);

  const metTable = [
    ["Rainfall Intensity", `${data.metHydrological.rainfallIntensityMmH} mm/h`, "Ground Roughness (Manning's n)", `${data.metHydrological.groundRoughnessManningN}`],
    ["Storm Duration", `${data.metHydrological.stormDurationMin} minutes`, "Peak Discharge Level", `${data.metHydrological.peakDischargeM3s} m³/s`],
    ["Water Level River Rise", `+${data.metHydrological.riverRiseM.toFixed(1)} m`, "Total Floodwater Volume", `${data.metHydrological.totalFloodVolumeM3.toLocaleString()} m³`],
    ["Soil Moisture Saturation", `${data.metHydrological.soilSaturationPercent}%`, "Wind Drift Speed", `${data.metHydrological.windSpeedKmh} km/h`],
  ];

  const halfW = contentWidth / 2;
  metTable.forEach(([l1, v1, l2, v2]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(l1, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(v1, margin + 45, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text(l2, margin + halfW, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(v2, margin + halfW + 55, y);
    y += 5.2;
  });

  y += 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text(`Data Sources: ${data.metHydrological.dataSources.join(" • ")}`, margin, y);
  y += 7;

  // 6. Flood Extent & Mapping
  y = printSectionHeader("6", "Flood Extent & Mapping", y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text(`• Inundated Surface Area: ${data.floodExtent.areaInundatedKm2} km² (${data.floodExtent.areaInundatedHa} hectares / ${data.floodExtent.areaInundatedM2.toLocaleString()} m²)`, margin, y);
  y += 4.5;
  doc.text(`• Basin Inundation Fraction: ${data.floodExtent.inundationPercentage}% of the ${data.hardware.areaCoveredKm2} km² catchment domain.`, margin, y);
  y += 4.5;
  doc.text(`• Flood Depth Statistics: Maximum recorded depth = ${data.floodExtent.maxDepthM} m; Mean inundated depth = ${data.floodExtent.averageDepthM} m.`, margin, y);
  y += 4.5;
  doc.text(`• Duration of Active Flooding: ${data.floodExtent.floodDurationFormatted}`, margin, y);
  y += 7;

  // 7. Impact Assessment
  y = printSectionHeader("7", "Impact Assessment", y);

  doc.text(`• Total Structures Assessed: ${data.impactAssessment.totalBuildingsAssessed} buildings mapped in high-risk catchment.`, margin, y);
  y += 4.5;
  doc.text(`• Inundated Structures: ${data.impactAssessment.buildingsExposed} buildings exposed (depth ≥ 0.10 m), including ${data.impactAssessment.residentialHomesExposed} residential dwellings.`, margin, y);
  y += 4.5;
  doc.text(`• Population Directly Affected: Estimated ~${data.impactAssessment.estimatedPopulationAffected} residents (~${data.impactAssessment.displacedHouseholds} households).`, margin, y);
  y += 4.5;
  doc.text(`• Infrastructure Disruption: ~${data.impactAssessment.infrastructureRoadsDisruptedKm} km of village and arterial access roads submerged.`, margin, y);
  y += 4.5;
  doc.text(`• Estimated Economic Loss: ${data.impactAssessment.economicLossEstimateInr} in residential and physical asset damages.`, margin, y);
  y += 4.5;
  doc.text(`• Hazard Severity Classification: ${data.impactAssessment.severityTag} (Categorized under NDMA Protocol)`, margin, y);

  drawFooter(2, 4);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3: CAUSES, RESPONSE MEASURES & RECOMMENDATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawHeader(3, "Contributing Factors, Emergency Response & Mitigation");
  y = 32;

  // 8. Causes & Contributing Factors
  y = printSectionHeader("8", "Causes & Contributing Factors", y);
  data.causesAndFactors.forEach((cause) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(30, 41, 59);
    const cLines = doc.splitTextToSize(`• ${cause}`, contentWidth);
    doc.text(cLines, margin, y);
    y += cLines.length * 3.8 + 1.5;
  });
  y += 4;

  // 9. Response & Mitigation Measures Taken
  y = printSectionHeader("9", "Response & Mitigation Measures Taken", y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("Emergency Actions:", margin, y);
  y += 4.5;

  data.responseMeasures.emergencyActions.forEach((act) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const aLines = doc.splitTextToSize(`• ${act}`, contentWidth);
    doc.text(aLines, margin, y);
    y += aLines.length * 3.6 + 1;
  });
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("Evacuation & Safe Routing Details:", margin, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  const evLines = doc.splitTextToSize(data.responseMeasures.evacuationDetails, contentWidth);
  doc.text(evLines, margin, y);
  y += evLines.length * 3.6 + 6;

  // 10. Recommendations
  y = printSectionHeader("10", "Recommendations", y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(185, 28, 28);
  doc.text("Short-Term Actions (Immediate Relief & Inspection):", margin, y);
  y += 4.5;

  data.recommendations.shortTerm.forEach((rec) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const rLines = doc.splitTextToSize(`[1-48h] ${rec}`, contentWidth);
    doc.text(rLines, margin, y);
    y += rLines.length * 3.6 + 1.2;
  });
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(14, 116, 144);
  doc.text("Long-Term Actions (Structural Reinforcement & Early Warning):", margin, y);
  y += 4.5;

  data.recommendations.longTerm.forEach((rec) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const rLines = doc.splitTextToSize(`[3-12m] ${rec}`, contentWidth);
    doc.text(rLines, margin, y);
    y += rLines.length * 3.6 + 1.2;
  });
  y += 5;

  // 11. Conclusion
  y = printSectionHeader("11", "Conclusion", y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  const concLines = doc.splitTextToSize(data.conclusion, contentWidth);
  doc.text(concLines, margin, y);

  drawFooter(3, 4);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 4: ANNEXURES & STRUCTURE INVENTORY TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawHeader(4, "Annexures • Structural Exposure Inventory");
  y = 32;

  y = printSectionHeader("12", "Annexures • Building Exposure & Hydrodynamic Data Table", y);

  const colWidths = [10, 52, 34, 38, 24, 24];
  const colNames = ["#", "Structure Name / ID", "Building Type", "Sim Arrival Time", "Peak Depth", "Risk Level"];

  doc.setFillColor(30, 41, 59);
  doc.rect(margin, y, contentWidth, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);

  let cx = margin + 2;
  colNames.forEach((n, idx) => {
    doc.text(n, cx, y + 4.2);
    cx += colWidths[idx];
  });
  y += 6;

  const annexRows = data.annexures.buildingsSummary.slice(0, 32);
  annexRows.forEach((row, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, 5.2, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(51, 65, 85);

    let rcx = margin + 2;
    doc.text(String(i + 1), rcx, y + 3.8);
    rcx += colWidths[0];

    const trName = row.name.length > 28 ? row.name.slice(0, 26) + "…" : row.name;
    doc.text(trName, rcx, y + 3.8);
    rcx += colWidths[1];

    doc.text(row.kind, rcx, y + 3.8);
    rcx += colWidths[2];

    doc.text(row.arrivalFormatted, rcx, y + 3.8);
    rcx += colWidths[3];

    doc.text(`${row.peakDepthM.toFixed(2)} m`, rcx, y + 3.8);
    rcx += colWidths[4];

    if (row.riskCategory === "Severe Hazard") {
      doc.setTextColor(220, 38, 38);
    } else if (row.riskCategory === "High Risk") {
      doc.setTextColor(234, 88, 12);
    } else {
      doc.setTextColor(14, 116, 144);
    }
    doc.text(row.riskCategory, rcx, y + 3.8);

    y += 5.2;
  });

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`References: ${data.annexures.references.join(" • ")}`, margin, y);

  drawFooter(4, 4);

  return doc;
}

export function downloadFloodReportPdf(options: FloodReportPdfOptions): void {
  const doc = generateFloodReportPdf(options);
  const ref = options.reportData?.cover.reportRef || "flood-impact-report";
  doc.save(`${ref}.pdf`);
}

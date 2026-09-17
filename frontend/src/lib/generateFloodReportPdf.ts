import { jsPDF } from "jspdf";
import type { BuildingExposure } from "@/components/simulation/buildingExposure";
import { formatArrivalTime } from "@/components/simulation/arrivalForecast";

export interface FloodReportPdfOptions {
  areaName?: string;
  centerLat?: number;
  centerLng?: number;
  scenario?: Record<string, unknown>;
  buildings: BuildingExposure[];
  generatedAt?: string;
}

export function generateFloodReportPdf(options: FloodReportPdfOptions): jsPDF {
  const {
    areaName = "Monitored Catchment Basin",
    centerLat,
    centerLng,
    scenario = {},
    buildings = [],
    generatedAt = new Date().toLocaleString(),
  } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Aggregate statistics
  const total = buildings.length;
  const assessed = buildings.filter((b) => b.assessed).length;
  const affected = buildings.filter((b) => b.affectedDuringRun || b.affectedNow);
  const residential = affected.filter((b) =>
    ["house", "residential", "apartments", "detached", "semidetached_house", "terrace"].includes(b.kind)
  ).length;

  const maxDepth = Number(scenario.maxDepthM ?? 0);
  const waterVolume = Number(scenario.waterVolumeM3 ?? 0);
  const floodedHa = Number(scenario.floodedAreaHectares ?? 0);
  const rainfall = Number(scenario.rainfallMmH ?? 100);
  const elapsed = Number(scenario.elapsedSeconds ?? 0);

  // Helper for drawing header banner
  const drawHeader = (pageNumber: number) => {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 28, "F");

    doc.setFillColor(6, 182, 212); // cyan-500 accent strip
    doc.rect(0, 27, pageWidth, 1.5, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("ENVIRONMENTAL INTELLIGENCE NETWORK (EIN) • 3D DIGITAL TWIN", margin, 11);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      "Department of Disaster Management & Hydrological Modeling • Official Impact Assessment",
      margin,
      17
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(56, 189, 248); // sky-400
    doc.text("FLASH FLOOD RUNOFF & BUILDING REACH TIME REPORT", margin, 23);

    // Date & page
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated: ${generatedAt}`, pageWidth - margin - 45, 11);
    doc.text(`Page ${pageNumber}`, pageWidth - margin - 15, 23);
  };

  // Helper for drawing footer
  const drawFooter = (pageNumber: number, totalPages: number) => {
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "CONFIDENTIAL & OFFICIAL • Generated via Real-Time 3D Digital Twin Shallow-Water Simulation.",
      margin,
      pageHeight - 8
    );
    doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 8);
  };

  // ─── PAGE 1: EXECUTIVE SUMMARY & KEY METRICS ───
  drawHeader(1);
  let y = 36;

  // Area & Scenario Header Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`Monitored Catchment: ${areaName}`, margin + 4, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const coordText = centerLat && centerLng ? `Coordinates: ${centerLat.toFixed(4)}°N, ${centerLng.toFixed(4)}°E` : "Active GIS Boundary";
  const modelText = `Flow Model: ${String(scenario.model ?? "Physics Baseline").toUpperCase()} • Simulated Time: ${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s`;
  doc.text(`${coordText}  |  ${modelText}`, margin + 4, y + 12);

  const stormText = `Rainfall Intensity: ${rainfall} mm/h  |  Storm Duration: ${scenario.durationMinutes ?? 60} min  |  River Inflow: ${scenario.riverRiseM ?? 0} m`;
  doc.text(stormText, margin + 4, y + 18);

  y += 29;

  // KPI Metric Cards (4 cards)
  const cardWidth = (contentWidth - 6) / 4;
  const cardHeight = 22;

  const kpis = [
    { label: "ASSESSED HOUSES", value: `${assessed} / ${total}`, color: [14, 116, 144] },
    { label: "EXPOSED STRUCTURES", value: `${affected.length}`, color: [220, 38, 38] },
    { label: "RESIDENTIAL AT RISK", value: `${residential}`, color: [234, 88, 12] },
    { label: "PEAK DEPTH", value: `${maxDepth.toFixed(2)} m`, color: [6, 182, 212] },
  ];

  kpis.forEach((kpi, index) => {
    const cx = margin + index * (cardWidth + 2);
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, y, cardWidth, cardHeight, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 3, y + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, cx + 3, y + 16);
  });

  y += cardHeight + 6;

  // Secondary Hydrological Metrics
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text("Hydrological Runoff Telemetry", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Total Simulated Floodwater Volume: ${waterVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³   •   Flooded Extent: ${floodedHa.toFixed(2)} ha   •   Grid Resolution: ${scenario.grid ?? "30m"}`,
    margin,
    y
  );
  y += 7;

  // Detailed Table Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("House-by-House Flood Reach Time & Inundation Assessment", margin, y);
  y += 4;

  const colWidths = [10, 48, 30, 40, 24, 30];
  const colNames = ["#", "House / Structure Name", "Type", "Estimated Reach Time", "Peak Depth", "Risk Category"];

  const drawTableHeader = (currY: number) => {
    doc.setFillColor(30, 41, 59); // slate-800
    doc.rect(margin, currY, contentWidth, 6.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);

    let cx = margin + 2;
    colNames.forEach((name, i) => {
      doc.text(name, cx, currY + 4.5);
      cx += colWidths[i];
    });
    return currY + 6.5;
  };

  y = drawTableHeader(y);

  // Sort buildings: reached first, then sorted by reach time, then peak depth
  const sortedBuildings = [...buildings].sort((a, b) => {
    if (a.arrivalSeconds !== null && b.arrivalSeconds === null) return -1;
    if (a.arrivalSeconds === null && b.arrivalSeconds !== null) return 1;
    if (a.arrivalSeconds !== null && b.arrivalSeconds !== null) return a.arrivalSeconds - b.arrivalSeconds;
    if (a.predictedArrivalSeconds !== null && b.predictedArrivalSeconds !== null) {
      return a.predictedArrivalSeconds - b.predictedArrivalSeconds;
    }
    return b.peakDepthM - a.peakDepthM;
  });

  let currentPage = 1;
  const rowHeight = 6.2;

  sortedBuildings.forEach((b, idx) => {
    if (y + rowHeight > pageHeight - 16) {
      drawFooter(currentPage, 0); // Will update page counts later
      doc.addPage();
      currentPage++;
      drawHeader(currentPage);
      y = 36;
      y = drawTableHeader(y);
    }

    // Alternate row background
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);

    let cx = margin + 2;

    // Col 0: Index
    doc.text(String(idx + 1), cx, y + 4.2);
    cx += colWidths[0];

    // Col 1: Name (truncated if necessary)
    const rawName = b.name || `House ${b.id.slice(0, 8)}`;
    const truncatedName = rawName.length > 24 ? rawName.slice(0, 22) + "…" : rawName;
    doc.text(truncatedName, cx, y + 4.2);
    cx += colWidths[1];

    // Col 2: Kind
    const kindText = b.kind && b.kind !== "unknown" ? b.kind : "House";
    doc.text(kindText, cx, y + 4.2);
    cx += colWidths[2];

    // Col 3: Flood Reach Estimation Time
    let reachText = "Dry · Safe";
    let reachColor: [number, number, number] = [16, 185, 129]; // emerald

    if (b.arrivalSeconds !== null) {
      reachText = `REACHED at ${formatArrivalTime(b.arrivalSeconds)}`;
      reachColor = [220, 38, 38]; // red
    } else if (b.predictedArrivalSeconds !== null && b.predictedArrivalSeconds > elapsed) {
      reachText = `Water in ~${formatArrivalTime(b.predictedArrivalSeconds - elapsed)}`;
      reachColor = [234, 88, 12]; // orange
    } else if (b.predictedArrivalSeconds !== null) {
      reachText = `Imminent (< 1 min)`;
      reachColor = [220, 38, 38];
    } else if (!b.assessed) {
      reachText = "Unassessed";
      reachColor = [148, 163, 184];
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(reachColor[0], reachColor[1], reachColor[2]);
    doc.text(reachText, cx, y + 4.2);
    cx += colWidths[3];

    // Col 4: Peak Depth
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    const depthStr = b.assessed ? `${b.peakDepthM.toFixed(2)} m` : "—";
    doc.text(depthStr, cx, y + 4.2);
    cx += colWidths[4];

    // Col 5: Risk Category
    let category = "SAFE";
    let catColor: [number, number, number] = [16, 185, 129];
    if (b.peakDepthM >= 0.6) {
      category = "CRITICAL";
      catColor = [220, 38, 38];
    } else if (b.peakDepthM >= 0.3) {
      category = "HIGH RISK";
      catColor = [234, 88, 12];
    } else if (b.peakDepthM >= 0.1) {
      category = "MODERATE";
      catColor = [202, 138, 4];
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(catColor[0], catColor[1], catColor[2]);
    doc.text(category, cx, y + 4.2);

    y += rowHeight;
  });

  // Footer for last page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }

  return doc;
}

export function downloadFloodReportPdf(options: FloodReportPdfOptions) {
  const doc = generateFloodReportPdf(options);
  const safeName = (options.areaName || "flood-report").replace(/\s+/g, "_").toLowerCase();
  doc.save(`${safeName}_flood_impact_report.pdf`);
}

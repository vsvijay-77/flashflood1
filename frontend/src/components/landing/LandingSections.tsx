import { Radio, Cpu, Cloud, Map, Bell, Satellite, Database, Brain, Boxes, Smartphone, MonitorSmartphone } from "lucide-react";
import { Card } from "@/components/ui/card";

const STEPS = [
  { n: "01", title: "Data Collection", icon: Satellite, body: "IoT environmental sensor nodes collect rainfall, soil moisture, temperature, water level, smoke and tilt readings from the field." },
  { n: "02", title: "LoRaWAN Communication", icon: Radio, body: "Sensor nodes transmit long-range, low-power data to the nearest LoRaWAN gateway across difficult terrain." },
  { n: "03", title: "Edge Processing", icon: Cpu, body: "Edge AI performs local analysis and continues critical operations during network interruptions." },
  { n: "04", title: "Cloud + AI", icon: Cloud, body: "Environmental data is processed using machine learning models and a multi-agent intelligence system." },
  { n: "05", title: "GIS + Digital Twin", icon: Map, body: "Data is visualized geographically and through Digital Twin simulations of hazard propagation." },
  { n: "06", title: "Early Warning", icon: Bell, body: "Authorities receive actionable alerts, risk scores and response recommendations in real time." },
];

export function HowPlatformWorks() {
  return (
    <section className="border-y border-slate-200 bg-white py-16 sm:py-20" id="how-it-works" data-testid="how-platform-works-section">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0F4C81]">Operational Workflow</p>
        <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          How the platform works
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
          Six stages carry a field reading from a hillside sensor to an authorized decision on an officer's desk.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step) => (
            <Card key={step.n} className="relative border-slate-200/80 p-6 transition-transform duration-200 hover:-translate-y-0.5" data-testid={`workflow-step-${step.n}`}>
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-[#0F4C81]/10 text-[#0F4C81]">
                  <step.icon className="size-5" />
                </span>
                <div>
                  <p className="font-mono text-[11px] font-bold tracking-[0.18em] text-slate-400">STEP {step.n}</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
                </div>
              </div>
              <span className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-[#0F4C81]/25 to-transparent" />
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const LAYERS = [
  {
    id: "data",
    title: "Data Source & Model Layer",
    icon: Database,
    items: ["Sensor Data", "Satellite Data", "Historical Datasets"],
    models: ["Random Forest — landslide & flood prediction", "Isolation Forest — anomaly detection", "CNN — satellite data classification"],
  },
  {
    id: "backend",
    title: "Backend & Database Layer",
    icon: Boxes,
    items: ["FastAPI", "PostgreSQL", "Apache Airflow"],
    models: ["Docker", "AWS deployment"],
  },
  {
    id: "agents",
    title: "Multi-Agent System",
    icon: Brain,
    items: ["Prediction Agent", "Alert Agent", "Risk Assessment Agent", "Decision Making Agent", "Adaptive Learning Agent"],
    models: ["AI Orchestrator", "LLM", "Qdrant Vector DB", "Redis", "LangChain", "LangGraph", "HuggingFace"],
  },
  {
    id: "twin",
    title: "Digital Twin Environment",
    icon: Map,
    items: ["Evacuation Route Simulation", "Emergency Response Simulation", "Water Flow Modeling", "Disaster Risk Simulation"],
    models: [],
  },
  {
    id: "gis",
    title: "Application Layer",
    icon: MonitorSmartphone,
    items: ["Risk Assessment Dashboard", "AI Decision Support", "Interactive Hazard Mapping"],
    models: ["Mobile: Real-Time Alerts", "Mobile: Evacuation Guidance", "Mobile: Safety Recommendations"],
  },
];

export function TechnologyArchitecture() {
  return (
    <section className="bg-[#F7F9FC] py-16 sm:py-20" id="gis" data-testid="technology-architecture-section">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#1B4D3E]">System Architecture</p>
        <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Technology architecture
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
          Five layers, each independently deployable, carrying data from the sensor edge to the command dashboard.
        </p>

        <div className="mt-10 space-y-4">
          {LAYERS.map((layer, index) => (
            <div key={layer.id} data-testid={`architecture-layer-${layer.id}`}>
              <Card className="border-slate-200/80 p-6">
                <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                  <div className="flex items-start gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-[#0B2545] text-white">
                      <layer.icon className="size-5" />
                    </span>
                    <div>
                      <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-slate-400">LAYER {index + 1}</p>
                      <h3 className="mt-1 text-base font-semibold text-slate-900">{layer.title}</h3>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {layer.items.map((item) => (
                      <span key={item} className="rounded-full border border-[#0F4C81]/25 bg-[#0F4C81]/[0.06] px-3 py-1.5 text-xs font-medium text-[#0B2545]">
                        {item}
                      </span>
                    ))}
                    {layer.models.map((item) => (
                      <span key={item} className="rounded-full border border-[#0D9488]/30 bg-[#0D9488]/[0.07] px-3 py-1.5 text-xs font-medium text-[#0B4A44]">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
              {index < LAYERS.length - 1 ? (
                <div className="flex justify-center py-1.5">
                  <span className="h-5 w-px bg-slate-300" />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-5">
          <Smartphone className="size-5 text-[#0F4C81]" />
          <p className="text-sm text-slate-600">
            Field officers receive the same intelligence on mobile — real-time disaster alerts, evacuation route
            guidance and safety recommendations.
          </p>
        </div>
      </div>
    </section>
  );
}

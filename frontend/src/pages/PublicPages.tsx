import { Link } from "react-router-dom";
import { 
  ArrowRight, Activity, Radio, ShieldCheck, Users, Globe, Zap, Network, 
  Map, Cloud, Cpu, Lock, CheckCircle2, Brain, Server, Shield, ArrowDown,
  Database, Satellite, Boxes, Smartphone, Layers, Bot, Workflow, Navigation, 
  Eye, MonitorPlay, Trees, HardDrive, CloudRain
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LandingNavbar, GovernmentFooter } from "@/components/landing/LandingChrome";
import { Card } from "@/components/ui/card";

export function AboutPlatform() {
  const MANDATE = [
    { 
      id: "01", 
      icon: Network, 
      color: "text-blue-500", 
      bg: "bg-blue-500/10",
      title: "NODAL COORDINATION", 
      body: "One operational picture shared across disaster management authorities, forest departments, and environmental agencies." 
    },
    { 
      id: "02", 
      icon: Radio, 
      color: "text-emerald-500", 
      bg: "bg-emerald-500/10",
      title: "SENSOR-FIRST EVIDENCE", 
      body: "Every alert can be traced back to a timestamped LoRaWAN uplink from an identifiable field node." 
    },
    { 
      id: "03", 
      icon: ShieldCheck, 
      color: "text-amber-500", 
      bg: "bg-amber-500/10",
      title: "HUMAN AUTHORITY", 
      body: "AI generates risk scores and decision-support recommendations, while authorized officials remain responsible for final decisions." 
    },
    { 
      id: "04", 
      icon: Lock, 
      color: "text-purple-500", 
      bg: "bg-purple-500/10",
      title: "AUDITABLE ACCESS", 
      body: "Role-based clearance, administrator verification, and logged sessions protect access to restricted operational intelligence." 
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900" data-testid="about-page">
      <LandingNavbar />

      {/* ====================================================
          PAGE HERO
          ==================================================== */}
      <section className="relative overflow-hidden bg-[#0A192F] pt-24 pb-32 text-center text-white border-b border-emerald-500/20">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(#38BDF8 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-sky-900/20 rounded-full blur-3xl opacity-50 mix-blend-screen" />
        
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 z-10">
          <span className="inline-block rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400">
            ABOUT THE PLATFORM
          </span>
          <h1 className="mt-8 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-white">
            A National Environmental Intelligence and <span className="text-emerald-400">Disaster Monitoring Platform</span>
          </h1>
          <p className="mt-8 text-xl leading-relaxed text-slate-300 max-w-3xl mx-auto font-light">
            The Environmental Intelligence Network consolidates IoT telemetry, satellite intelligence, historical hazard datasets, and machine learning into a unified decision-support system for Indian government authorities responsible for environmental monitoring and hazard response.
          </p>
        </div>
      </section>

      {/* ====================================================
          CORE PRINCIPLES
          ==================================================== */}
      <section className="py-24 bg-slate-50 relative -mt-16 z-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-8">
            {MANDATE.map((m) => (
              <div 
                key={m.id} 
                className="group relative bg-white rounded-2xl border border-slate-200 p-10 shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 hover:border-slate-300 overflow-hidden"
                data-testid={`about-card-${m.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 transition-opacity group-hover:opacity-10 pointer-events-none">
                  <m.icon className="size-48" />
                </div>
                <div className="flex items-center gap-6 mb-8">
                  <span className={`grid size-14 place-items-center rounded-xl ${m.bg} ${m.color}`}>
                    <m.icon className="size-6" />
                  </span>
                  <div>
                    <span className="text-[10px] font-black tracking-widest text-slate-400">{m.id}</span>
                    <h3 className="text-lg font-bold uppercase tracking-wider text-[#0F4C81]">{m.title}</h3>
                  </div>
                </div>
                <p className="text-base leading-relaxed text-slate-600 relative z-10 font-medium">
                  {m.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <GovernmentFooter />
    </div>
  );
}

export function PlatformPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900" data-testid="platform-page">
      <LandingNavbar />

      {/* ====================================================
          PAGE HERO
          ==================================================== */}
      <section className="relative overflow-hidden bg-[#0A192F] pt-20 pb-24 text-center text-white border-b border-emerald-500/20">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-400 via-[#0A192F] to-[#0A192F]" />
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <span className="inline-block rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400">
            PLATFORM ARCHITECTURE
          </span>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            From Environmental Signals to <span className="text-emerald-400">Intelligent Decisions.</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            The Environmental Intelligence Network is built as a modular, independently deployable architecture connecting field telemetry, satellite intelligence, edge processing, cloud analytics, multi-agent AI, Digital Twin simulation, and government-facing command applications.
          </p>

          <div className="mt-12 flex flex-col items-center gap-2 font-mono text-[11px] font-bold text-sky-300 tracking-wider">
            <div className="flex items-center gap-3 bg-slate-800/50 px-6 py-3 rounded-lg border border-slate-700 w-full max-w-sm justify-center"><Satellite className="size-4"/> SENSORS + SATELLITE</div>
            <ArrowDown className="size-4 text-emerald-400 animate-bounce" />
            <div className="flex items-center gap-3 bg-slate-800/50 px-6 py-3 rounded-lg border border-slate-700 w-full max-w-sm justify-center"><Database className="size-4"/> DATA & AI MODELS</div>
            <ArrowDown className="size-4 text-emerald-400 animate-bounce" />
            <div className="flex items-center gap-3 bg-slate-800/50 px-6 py-3 rounded-lg border border-slate-700 w-full max-w-sm justify-center"><Server className="size-4"/> BACKEND + DATA PLATFORM</div>
            <ArrowDown className="size-4 text-emerald-400 animate-bounce" />
            <div className="flex items-center gap-3 bg-slate-800/50 px-6 py-3 rounded-lg border border-slate-700 w-full max-w-sm justify-center"><Brain className="size-4"/> MULTI-AGENT INTELLIGENCE</div>
            <ArrowDown className="size-4 text-emerald-400 animate-bounce" />
            <div className="flex items-center gap-3 bg-slate-800/50 px-6 py-3 rounded-lg border border-slate-700 w-full max-w-sm justify-center"><Map className="size-4"/> DIGITAL TWIN SIMULATION</div>
            <ArrowDown className="size-4 text-emerald-400 animate-bounce" />
            <div className="flex items-center gap-3 bg-slate-800/50 px-6 py-3 rounded-lg border border-slate-700 w-full max-w-sm justify-center"><MonitorPlay className="size-4"/> COMMAND DASHBOARD + MOBILE</div>
          </div>
        </div>
      </section>

      {/* ====================================================
          SYSTEM ARCHITECTURE OVERVIEW
          ==================================================== */}
      <section className="bg-white py-24 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F4C81]">SYSTEM ARCHITECTURE</p>
          <h2 className="mt-4 text-3xl font-extrabold text-slate-900 sm:text-4xl">Five Layers. One Connected Intelligence Network.</h2>
          <p className="mt-4 max-w-3xl mx-auto text-lg text-slate-600">
            Each architectural layer is independently deployable and scalable, allowing environmental intelligence services to operate reliably from remote field sensors to national-level command dashboards.
          </p>
        </div>
      </section>

      {/* ====================================================
          LAYER 1 — DATA SOURCE & MODEL LAYER
          ==================================================== */}
      <section className="bg-slate-50 py-20 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-8">
            <span className="grid size-12 place-items-center rounded-xl bg-[#0F4C81] text-white font-mono text-sm font-bold">01</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">LAYER 01</p>
              <h2 className="text-2xl font-extrabold text-slate-900">Data Source & Intelligence Model Layer</h2>
            </div>
          </div>
          <p className="text-lg text-slate-600 mb-12 max-w-4xl">
            This layer collects environmental intelligence from distributed field systems, Earth observation platforms, and historical datasets while providing the core machine learning models used for hazard prediction and anomaly detection.
          </p>

          <div className="grid lg:grid-cols-2 gap-12">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#0F4C81] mb-6 flex items-center gap-2"><Database className="size-4"/> DATA SOURCES</h3>
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold flex items-center gap-2"><Radio className="size-4 text-sky-500"/> IoT Environmental Sensor Data</h4>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {["Rainfall", "Temperature", "Humidity", "Soil Moisture", "Water Level", "Tilt", "Accelerometer", "Smoke / Fire Indicators"].map(t => (
                      <span key={t} className="bg-slate-100 px-2.5 py-1 rounded text-xs font-semibold text-slate-600">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold flex items-center gap-2"><Satellite className="size-4 text-amber-500"/> Satellite & Earth Observation Data</h4>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {["Sentinel Satellite Data", "SAR Data", "Optical Imagery", "Terrain Data", "Land Cover Data", "Rainfall Observations"].map(t => (
                      <span key={t} className="bg-slate-100 px-2.5 py-1 rounded text-xs font-semibold text-slate-600">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold flex items-center gap-2"><HardDrive className="size-4 text-emerald-500"/> Historical Datasets</h4>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {["Historical Flood Events", "Landslide Records", "Weather History", "Environmental Records", "Disaster Incident Data"].map(t => (
                      <span key={t} className="bg-slate-100 px-2.5 py-1 rounded text-xs font-semibold text-slate-600">{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#0F4C81] mb-6 flex items-center gap-2"><Brain className="size-4"/> AI / ML MODELS</h3>
              <div className="space-y-6">
                <div className="bg-[#0A192F] p-6 rounded-xl border border-slate-800 shadow-sm text-white">
                  <h4 className="font-bold flex items-center gap-2 text-emerald-400"><Trees className="size-4"/> Random Forest</h4>
                  <ul className="mt-4 space-y-2 text-sm text-slate-400">
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-emerald-500"/> Landslide Risk Prediction</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-emerald-500"/> Flood Risk Prediction</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-emerald-500"/> Environmental Risk Classification</li>
                  </ul>
                </div>
                <div className="bg-[#0A192F] p-6 rounded-xl border border-slate-800 shadow-sm text-white">
                  <h4 className="font-bold flex items-center gap-2 text-sky-400"><Zap className="size-4"/> Isolation Forest</h4>
                  <ul className="mt-4 space-y-2 text-sm text-slate-400">
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-sky-500"/> Sensor Anomaly Detection</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-sky-500"/> Abnormal Environmental Pattern Detection</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-sky-500"/> Equipment Behaviour Analysis</li>
                  </ul>
                </div>
                <div className="bg-[#0A192F] p-6 rounded-xl border border-slate-800 shadow-sm text-white">
                  <h4 className="font-bold flex items-center gap-2 text-purple-400"><Eye className="size-4"/> CNN (Convolutional Neural Network)</h4>
                  <ul className="mt-4 space-y-2 text-sm text-slate-400">
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-purple-500"/> Satellite Image Classification</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-purple-500"/> Land Change Detection</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-purple-500"/> Hazard Area Identification</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================
          LAYER 2 — BACKEND & DATABASE LAYER
          ==================================================== */}
      <section className="bg-white py-20 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-8">
            <span className="grid size-12 place-items-center rounded-xl bg-[#0F4C81] text-white font-mono text-sm font-bold">02</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">LAYER 02</p>
              <h2 className="text-2xl font-extrabold text-slate-900">Backend, Data Processing & Infrastructure Layer</h2>
            </div>
          </div>
          <p className="text-lg text-slate-600 mb-12 max-w-4xl">
            This layer provides the scalable backend infrastructure responsible for API services, data ingestion, workflow orchestration, persistent storage, and cloud deployment.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="border border-slate-200 rounded-xl p-6 bg-slate-50">
              <h4 className="font-bold text-slate-900">FastAPI</h4>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>• High-performance APIs</li>
                <li>• Sensor Data Ingestion</li>
                <li>• AI Model Integration</li>
                <li>• Real-Time Data Services</li>
                <li>• WebSocket Communication</li>
              </ul>
            </div>
            <div className="border border-slate-200 rounded-xl p-6 bg-slate-50">
              <h4 className="font-bold text-slate-900">PostgreSQL + PostGIS</h4>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>• Sensor Data Storage</li>
                <li>• User & Role Management</li>
                <li>• Geographic Intelligence</li>
                <li>• Historical Data</li>
                <li>• Incident Records</li>
              </ul>
            </div>
            <div className="border border-slate-200 rounded-xl p-6 bg-slate-50">
              <h4 className="font-bold text-slate-900">Apache Airflow</h4>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>• Automated Data Pipelines</li>
                <li>• Scheduled Model Processing</li>
                <li>• ETL Workflows</li>
                <li>• Satellite Processing</li>
              </ul>
            </div>
            <div className="border border-slate-200 rounded-xl p-6 bg-slate-50">
              <h4 className="font-bold text-slate-900">AWS / Docker Cloud</h4>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>• Containerized Services</li>
                <li>• Cloud Compute</li>
                <li>• Database Hosting</li>
                <li>• Object Storage</li>
                <li>• Scalable Architecture</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================
          LAYER 3 — MULTI-AGENT INTELLIGENCE SYSTEM
          ==================================================== */}
      <section className="bg-[#0A192F] py-24 border-y border-slate-800 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-8">
            <span className="grid size-12 place-items-center rounded-xl bg-emerald-500 text-[#0A192F] font-mono text-sm font-bold">03</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">LAYER 03</p>
              <h2 className="text-2xl font-extrabold text-white">Multi-Agent Environmental Intelligence System</h2>
            </div>
          </div>
          <p className="text-lg text-slate-300 mb-16 max-w-4xl">
            The intelligence layer uses specialized AI agents coordinated by an orchestration system to transform environmental data into risk assessments, alerts, recommendations, and decision-support insights.
          </p>

          <div className="relative">
            {/* Center Orchestrator */}
            <div className="flex justify-center mb-16 relative z-10">
              <div className="bg-emerald-500/10 border border-emerald-500 p-8 rounded-2xl text-center max-w-sm shadow-[0_0_30px_rgba(16,185,129,0.15)]">
                <Brain className="size-12 text-emerald-400 mx-auto mb-4" />
                <h3 className="text-xl font-black tracking-widest text-emerald-400">AI ORCHESTRATOR</h3>
                <ul className="mt-4 text-sm text-emerald-100/80 space-y-1">
                  <li>Agent Coordination</li>
                  <li>Workflow Management</li>
                  <li>Task Delegation</li>
                  <li>Context Sharing</li>
                  <li>Response Aggregation</li>
                </ul>
              </div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 relative z-10">
              {[
                { name: "Prediction Agent", icon: Globe, desc: ["Hazard Prediction", "Flood Forecasting", "Landslide Probability", "Environmental Trend Analysis"] },
                { name: "Alert Agent", icon: ShieldCheck, desc: ["Threshold Monitoring", "Alert Generation", "Alert Prioritization", "Authority Notification"] },
                { name: "Risk Assessment Agent", icon: Activity, desc: ["Multi-Hazard Risk Analysis", "Risk Scoring", "Severity Classification", "Location-Based Risk Assessment"] },
                { name: "Decision Support Agent", icon: Users, desc: ["Response Recommendations", "Resource Prioritization", "Evacuation Suggestions", "Authority Decision Support"] }
              ].map(agent => (
                <div key={agent.name} className="bg-slate-800/80 border border-slate-700 p-6 rounded-xl">
                  <agent.icon className="size-6 text-sky-400 mb-4" />
                  <h4 className="font-bold text-white mb-4">{agent.name}</h4>
                  <ul className="space-y-2 text-xs text-slate-400">
                    {agent.desc.map(d => <li key={d}>• {d}</li>)}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-16 flex flex-wrap justify-center gap-3">
              {["LLM", "LangChain", "LangGraph", "HuggingFace", "Qdrant Vector Database", "Redis", "RAG Pipeline"].map(tech => (
                <span key={tech} className="bg-slate-800 border border-slate-700 px-4 py-2 rounded-full text-xs font-mono text-slate-300">
                  {tech}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================
          LAYER 4 — DIGITAL TWIN ENVIRONMENT
          ==================================================== */}
      <section className="bg-white py-20 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-8">
            <span className="grid size-12 place-items-center rounded-xl bg-[#0F4C81] text-white font-mono text-sm font-bold">04</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">LAYER 04</p>
              <h2 className="text-2xl font-extrabold text-slate-900">Environmental Digital Twin & Simulation Layer</h2>
            </div>
          </div>
          <p className="text-lg text-slate-600 mb-12 max-w-4xl">
            This layer transforms real-world environmental intelligence into dynamic spatial simulations, enabling authorities to visualize potential hazard behaviour before and during an emergency.
          </p>

          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-slate-50 border border-slate-200 p-8 rounded-2xl flex flex-col items-center justify-center min-h-[400px] text-center">
              <Map className="size-24 text-sky-200 mb-6" />
              <div className="flex flex-col items-center gap-2 font-mono text-[10px] font-bold text-sky-600">
                <span>REAL-TIME DATA + AI RISK SCORE</span>
                <ArrowDown className="size-4 animate-bounce" />
                <span>DIGITAL TWIN SIMULATION ENGINE</span>
                <ArrowDown className="size-4 animate-bounce" />
                <span>IMPACT ANALYSIS & RECOMMENDATIONS</span>
              </div>
            </div>
            
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { name: "Hazard Simulation", icon: CloudRain, items: ["Flood Propagation", "Landslide Risk Zones"] },
                { name: "Evacuation Route", icon: Navigation, items: ["Safe Route Identification", "Road Accessibility", "Dynamic Route Updates"] },
                { name: "Emergency Response", icon: Shield, items: ["Resource Allocation", "Response Time Analysis", "Emergency Unit Deployment"] },
                { name: "Disaster Risk", icon: Activity, items: ["Impact Zones", "Population Exposure", "Infrastructure Risk"] }
              ].map(sim => (
                <div key={sim.name} className="border border-slate-200 p-5 rounded-xl">
                  <sim.icon className="size-5 text-[#0F4C81] mb-3" />
                  <h4 className="font-bold text-sm text-slate-900 mb-3">{sim.name}</h4>
                  <ul className="text-xs text-slate-600 space-y-1">
                    {sim.items.map(i => <li key={i}>• {i}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================
          LAYER 5 — APPLICATION & COMMAND LAYER
          ==================================================== */}
      <section className="bg-slate-50 py-20 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-8">
            <span className="grid size-12 place-items-center rounded-xl bg-[#0F4C81] text-white font-mono text-sm font-bold">05</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">LAYER 05</p>
              <h2 className="text-2xl font-extrabold text-slate-900">Command, Decision Support & Field Applications</h2>
            </div>
          </div>
          <p className="text-lg text-slate-600 mb-12 max-w-4xl">
            The final layer delivers environmental intelligence to authorized government officers through command dashboards, GIS interfaces, and mobile applications.
          </p>

          <div className="space-y-16">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900 mb-8 border-b border-slate-200 pb-4">COMMAND CENTER DASHBOARD</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold text-sm mb-4 text-[#0F4C81]">Risk Assessment</h4>
                  <ul className="text-sm text-slate-600 space-y-2">
                    <li>• National Risk Overview</li>
                    <li>• Regional Risk Scores</li>
                    <li>• Active Hazards</li>
                  </ul>
                </div>
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold text-sm mb-4 text-[#0F4C81]">AI Decision Support</h4>
                  <ul className="text-sm text-slate-600 space-y-2">
                    <li>• AI Recommendations</li>
                    <li>• Risk Explanation</li>
                    <li>• Response Priorities</li>
                  </ul>
                </div>
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold text-sm mb-4 text-[#0F4C81]">Interactive Mapping</h4>
                  <ul className="text-sm text-slate-600 space-y-2">
                    <li>• India GIS View</li>
                    <li>• Hazard Zones</li>
                    <li>• Real-Time Layers</li>
                  </ul>
                </div>
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold text-sm mb-4 text-[#0F4C81]">Alert Management</h4>
                  <ul className="text-sm text-slate-600 space-y-2">
                    <li>• Active Alerts</li>
                    <li>• Severity Levels</li>
                    <li>• Response Status</li>
                  </ul>
                </div>
              </div>
            </div>


          </div>
        </div>
      </section>

      {/* ====================================================
          KEY ARCHITECTURAL PRINCIPLES
          ==================================================== */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-slate-900">Key Architectural Principles</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "MODULAR", desc: "Each service can be independently developed and deployed." },
              { title: "SCALABLE", desc: "Architecture can expand from prototype deployments to large sensor networks." },
              { title: "RESILIENT", desc: "Edge processing supports critical operations during connectivity disruptions." },
              { title: "INTELLIGENT", desc: "AI and multi-agent systems transform raw data into actionable intelligence." },
              { title: "INTEROPERABLE", desc: "Designed to integrate multiple data sources, sensors, and government systems." },
              { title: "SECURE", desc: "Role-based access and controlled intelligence distribution protect sensitive operational data." }
            ].map(p => (
              <div key={p.title} className="p-6 bg-slate-50 border border-slate-200 rounded-xl">
                <h3 className="font-black text-sm uppercase tracking-wider text-[#0F4C81] mb-2">{p.title}</h3>
                <p className="text-sm text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================
          FINAL ARCHITECTURE CTA
          ==================================================== */}
      <section className="bg-[#0A192F] py-24 text-center border-t border-slate-800">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">CONNECTED INTELLIGENCE. COORDINATED ACTION.</p>
          <h2 className="mt-4 text-3xl font-extrabold text-white sm:text-4xl">From the Sensor Edge to the Command Decision.</h2>
          <p className="mt-6 text-lg text-slate-300">
            A modular environmental intelligence architecture designed to transform distributed environmental signals into predictive insights, simulated outcomes, and actionable decisions.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link to="/login" className={buttonVariants({ variant: "outline", size: "lg", className: "border-2 border-white/40 text-white hover:bg-white/10 hover:border-white font-bold transition-all shadow-sm" })}>
              Explore Live Monitoring
            </Link>
            <Link to="/register" className={buttonVariants({ size: "lg", className: "bg-emerald-400 text-[#0A192F] hover:bg-emerald-300 font-bold shadow-lg" })}>
              Request Departmental Access
            </Link>
          </div>
        </div>
      </section>

      <GovernmentFooter />
    </div>
  );
}

import { Link } from "react-router-dom";
import { 
  ArrowRight, Activity, Radio, ShieldCheck, Users, Clock, Globe, Zap, Network, 
  CloudRain, Mountain, Flame, Waves, Droplets, Map, Cloud, Cpu, Lock, 
  CheckCircle2, FileCheck, Brain, Server, Shield, ArrowDown
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LandingNavbar, GovernmentFooter } from "@/components/landing/LandingChrome";
import EnvironmentalNetworkAnimation from "@/components/landing/EnvironmentalNetworkAnimation";

export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900" data-testid="home-page">
      <LandingNavbar />

      {/* ====================================================
          HERO SECTION
          ==================================================== */}
      <section className="relative overflow-hidden bg-[#0A192F] pt-12 pb-24">
        {/* Subtle background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-96 bg-emerald-900/20 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8">
          <div className="z-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              ENVIRONMENTAL INTELLIGENCE NETWORK · INDIA
            </span>

            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[56px]">
              See the Risk. <br className="hidden lg:block"/>
              Predict the Impact. <br className="hidden lg:block"/>
              <span className="text-emerald-400">Act Before Disaster Strikes.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300">
              A unified environmental intelligence network connecting remote sensors, LoRaWAN communication, AI-driven risk prediction, GIS mapping, and Digital Twins to help authorities detect, understand, and respond to environmental threats in real time.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/platform" className={buttonVariants({ size: "lg", className: "bg-emerald-500 text-[#0A192F] hover:bg-emerald-400 font-bold tracking-wide" })}>
                Explore the Platform
              </Link>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-700/50 pt-6">
              {[
                "Real-Time Monitoring", 
                "📡 Remote LoRaWAN Coverage", 
                "🧠 AI-Powered Prediction", 
                "🗺 India-Scale GIS Intelligence"
              ].map((strip, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {i === 0 && <span className="text-emerald-400">●</span>}
                  {strip}
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 lg:pl-4">
            <EnvironmentalNetworkAnimation />
          </div>
        </div>
      </section>

      {/* ====================================================
          PLATFORM OVERVIEW
          ==================================================== */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F4C81]">ONE PLATFORM. COMPLETE ENVIRONMENTAL AWARENESS.</p>
            <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">
              Built for the moments when every minute matters.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
              The Environmental Intelligence Network provides a unified operational environment for monitoring environmental conditions, detecting anomalies, predicting hazards, and coordinating responses across agencies.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { value: "24/7", label: "Continuous Environmental Monitoring", icon: Clock },
              { value: "REAL-TIME", label: "Sensor-to-Decision Intelligence", icon: Zap },
              { value: "MULTI-HAZARD", label: "Flood · Landslide", icon: ShieldCheck },
              { value: "ONE NETWORK", label: "Multi-Agency Coordination", icon: Network }
            ].map((stat, i) => (
              <div key={i} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="absolute inset-0 bg-gradient-to-b from-sky-50/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <span className="mx-auto grid size-12 place-items-center rounded-xl bg-sky-100 text-[#0F4C81] transition-transform group-hover:scale-110">
                  <stat.icon className="size-6" />
                </span>
                <p className="mt-6 text-2xl font-bold tracking-tight text-slate-900">{stat.value}</p>
                <p className="mt-2 text-sm font-medium text-slate-500 uppercase tracking-widest">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================
          CORE PLATFORM CAPABILITIES
          ==================================================== */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-extrabold text-slate-900">Intelligence Beyond Connectivity</h2>
          </div>

          <div className="grid gap-12 lg:grid-cols-2">
            {[
              {
                icon: Radio,
                title: "Monitor where conventional networks cannot reach.",
                desc: "LoRaWAN-enabled environmental sensor nodes deliver long-range, low-power connectivity across remote hills, forests, river basins, and difficult terrain where conventional cellular infrastructure is unreliable.",
                tags: ["Long-range communication", "Low-power operation", "Solar-powered deployments", "Remote terrain coverage", "Offline resilience"]
              },
              {
                icon: Brain,
                title: "Move from monitoring events to anticipating them.",
                desc: "Machine learning and anomaly detection models continuously analyze environmental patterns and sensor behavior to generate dynamic hazard probabilities and early risk indicators.",
                tags: ["Random Forest", "Isolation Forest", "CNN Analysis", "Time-Series Detection", "Multi-Agent AI"]
              },
              {
                icon: Lock,
                title: "Built for controlled operational environments.",
                desc: "Role-based access control, authenticated sessions, administrative verification, and audit logging ensure sensitive environmental intelligence is accessible only to authorized personnel.",
                tags: ["Role-Based Access Control", "Administrator Approval", "Session Monitoring", "Audit Logs", "Restricted Access"]
              },
              {
                icon: Users,
                title: "One operational picture. Multiple authorities.",
                desc: "Enable disaster management authorities, forest departments, environmental agencies, and emergency response teams to operate from a shared real-time intelligence environment.",
                tags: ["Shared GIS Layer", "Multi-Agency Alerting", "Unified Dashboards", "Coordinated Response", "Data Interoperability"]
              }
            ].map((cap, i) => (
              <div key={i} className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-8 sm:p-10 transition-shadow hover:shadow-md">
                <span className="grid size-14 place-items-center rounded-xl bg-[#0F4C81] text-white">
                  <cap.icon className="size-7" />
                </span>
                <h3 className="mt-6 text-2xl font-bold text-slate-900">{cap.title}</h3>
                <p className="mt-4 text-base leading-relaxed text-slate-600">{cap.desc}</p>
                <div className="mt-8 flex flex-wrap gap-2">
                  {cap.tags.map((tag, j) => (
                    <span key={j} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================
          HAZARDS WE MONITOR
          ==================================================== */}
      <section className="bg-[#0A192F] py-24 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">ONE NETWORK. MULTIPLE ENVIRONMENTAL THREATS.</p>
            <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Hazards We Monitor</h2>
          </div>

          <div className="mt-16 flex flex-wrap justify-center gap-6 max-w-6xl mx-auto">
            {[
              { icon: Waves, color: "text-blue-400", bg: "bg-blue-400/10", title: "FLOOD MONITORING", desc: "Water-level sensors, rainfall intelligence, and predictive flood risk analysis." },
              { icon: Mountain, color: "text-amber-400", bg: "bg-amber-400/10", title: "LANDSLIDE DETECTION", desc: "Tilt, acceleration, soil moisture, and terrain intelligence for slope instability monitoring." },
              { icon: CloudRain, color: "text-cyan-400", bg: "bg-cyan-400/10", title: "EXTREME RAINFALL", desc: "Hyperlocal rainfall monitoring and threshold-based warning systems." },
              { icon: Droplets, color: "text-emerald-400", bg: "bg-emerald-400/10", title: "SOIL & ENVIRONMENTAL HEALTH", desc: "Continuous soil moisture and environmental condition monitoring." },
              { icon: Activity, color: "text-purple-400", bg: "bg-purple-400/10", title: "MULTI-HAZARD INTELLIGENCE", desc: "AI combines multiple environmental indicators to identify complex and emerging compound risks." }
            ].map((hazard, i) => (
              <div key={i} className="group cursor-pointer rounded-2xl border border-slate-700 bg-slate-800/50 p-8 transition-all hover:-translate-y-1 hover:border-slate-500 hover:bg-slate-800 w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)]">
                <span className={`grid size-12 place-items-center rounded-xl ${hazard.bg} ${hazard.color}`}>
                  <hazard.icon className="size-6" />
                </span>
                <h3 className="mt-6 text-lg font-bold tracking-wide">{hazard.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{hazard.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================
          OPERATIONAL WORKFLOW
          ==================================================== */}
      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F4C81]">FROM THE FIELD TO THE DECISION MAKER</p>
            <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">How Environmental Intelligence Becomes Action</h2>
            <p className="mt-4 text-lg text-slate-600">Six connected stages transform a field observation into actionable intelligence.</p>
          </div>

          <div className="mt-16 relative">
            <div className="hidden lg:block absolute top-[44px] left-[10%] right-[10%] h-1 bg-gradient-to-r from-sky-200 via-sky-400 to-emerald-400" />
            <div className="grid gap-12 lg:grid-cols-6 lg:gap-4 relative z-10">
              {[
                { step: "01", name: "SENSE", title: "DATA COLLECTION", icon: Activity, desc: "IoT environmental sensor nodes continuously capture rainfall, soil moisture, temperature, water level, tilt, acceleration, and other critical field conditions." },
                { step: "02", name: "CONNECT", title: "LORAWAN COMMUNICATION", icon: Radio, desc: "Long-range, low-power communication delivers environmental data across difficult terrain to the nearest gateway or edge processing unit." },
                { step: "03", name: "ANALYZE LOCALLY", title: "EDGE INTELLIGENCE", icon: Cpu, desc: "Edge computing processes critical data closer to the source, reducing latency and maintaining essential monitoring capabilities during connectivity disruptions." },
                { step: "04", name: "PREDICT", title: "CLOUD + AI INTELLIGENCE", icon: Cloud, desc: "Environmental data is processed through machine learning models, anomaly detection systems, and AI intelligence layers to identify emerging risks." },
                { step: "05", name: "VISUALIZE", title: "GIS + DIGITAL TWIN", icon: Map, desc: "Real-time intelligence is mapped geographically and modeled through Digital Twin simulations to understand environmental conditions and potential hazard propagation." },
                { step: "06", name: "ACT", title: "EARLY WARNING & RESPONSE", icon: Shield, desc: "Authorized authorities receive prioritized alerts, risk scores, affected locations, and decision-support recommendations for faster response." }
              ].map((stage, i) => (
                <div key={i} className="flex flex-col items-center text-center lg:items-start lg:text-left">
                  <div className="flex flex-col items-center lg:flex-row lg:items-start lg:w-full">
                    <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white border-2 border-slate-200 text-[#0F4C81] shadow-sm z-10">
                      <stage.icon className="size-7" />
                    </span>
                  </div>
                  <div className="mt-6">
                    <p className="font-mono text-xs font-bold text-slate-400">STEP {stage.step} — {stage.name}</p>
                    <h3 className="mt-2 text-sm font-bold text-slate-900">{stage.title}</h3>
                    <p className="mt-3 text-xs leading-relaxed text-slate-600">{stage.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>


      {/* ====================================================
          TECHNOLOGY ARCHITECTURE
          ==================================================== */}
      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-extrabold text-slate-900">Designed as an Integrated Intelligence Stack</h2>
          
          <div className="mt-16 flex flex-col items-center gap-4">
            {[
              { name: "FIELD LAYER", tech: "IoT Sensors + Environmental Nodes", icon: Mountain },
              { name: "CONNECTIVITY LAYER", tech: "LoRa + LoRaWAN", icon: Radio },
              { name: "EDGE INTELLIGENCE", tech: "Raspberry Pi + Local Processing", icon: Cpu },
              { name: "CLOUD INTELLIGENCE", tech: "FastAPI + AI + Data Processing", icon: Cloud },
              { name: "INTELLIGENCE LAYER", tech: "Machine Learning + Multi-Agent AI", icon: Brain },
              { name: "VISUALIZATION LAYER", tech: "GIS + Digital Twin + Command Dashboard", icon: Map }
            ].map((layer, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="flex w-full max-w-md items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-[#0F4C81] text-white">
                    <layer.icon className="size-6" />
                  </span>
                  <div className="text-left">
                    <p className="font-mono text-[10px] font-bold tracking-widest text-slate-400">{layer.name}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{layer.tech}</p>
                  </div>
                </div>
                {i < 5 && (
                  <div className="py-2">
                    <ArrowDown className="size-5 text-sky-400 animate-bounce" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================
          PLATFORM BENEFITS
          ==================================================== */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-slate-900">Designed for Operational Decision-Making</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "FASTER DETECTION", desc: "Identify abnormal environmental conditions as they emerge." },
              { title: "PREDICTIVE INTELLIGENCE", desc: "Understand potential risks before they escalate." },
              { title: "HYPERLOCAL AWARENESS", desc: "Monitor environmental conditions at the exact location where they matter." },
              { title: "REMOTE COVERAGE", desc: "Extend monitoring into areas with limited conventional connectivity." },
              { title: "CONTINUOUS MONITORING", desc: "Maintain a real-time operational view of changing environmental conditions." },
              { title: "COORDINATED RESPONSE", desc: "Enable multiple agencies to work from a shared intelligence picture." }
            ].map((benefit, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle2 className="size-5 text-[#1B4D3E]" />
                  <h3 className="font-bold text-slate-900">{benefit.title}</h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ====================================================
          FINAL CALL TO ACTION
          ==================================================== */}
      <section className="relative overflow-hidden bg-[#0F4C81] py-24 text-center">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 50% 50%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300">THE NEXT DISASTER SIGNAL MAY ALREADY BE IN THE DATA.</p>
          <h2 className="mt-4 text-4xl font-extrabold text-white sm:text-5xl">Turn Environmental Signals Into Early Action.</h2>
          <p className="mt-6 text-lg text-sky-100">
            Connect your department to an integrated environmental intelligence platform designed for real-time awareness, predictive risk analysis, and coordinated response.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link to="/register" className={buttonVariants({ size: "lg", className: "bg-emerald-400 text-[#0A192F] hover:bg-emerald-300 font-bold shadow-lg transition-colors" })}>
              Request Access
            </Link>
            <Link to="/platform" className={buttonVariants({ variant: "outline", size: "lg", className: "border-2 border-white/40 text-white hover:bg-white/10 hover:border-white font-bold transition-all shadow-sm" })}>
              Explore Platform Architecture
            </Link>
          </div>
        </div>
      </section>

      <GovernmentFooter />
    </div>
  );
}

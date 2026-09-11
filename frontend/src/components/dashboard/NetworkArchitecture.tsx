import { Radio, Server, Cloud, Monitor } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { motion } from "motion/react";

export function NetworkArchitecture() {
  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-4">
        <CardTitle className="text-lg font-semibold text-slate-900">Live Communication Architecture</CardTitle>
      </CardHeader>
      <CardContent className="pt-8 pb-10">
        <div className="flex flex-col items-center justify-center space-y-2">
          
          {/* SLAVE NODES */}
          <div className="flex gap-4 sm:gap-12">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="grid size-12 place-items-center rounded-full bg-slate-100 border-2 border-emerald-500 shadow-sm">
                  <Radio className="size-5 text-emerald-600" />
                </div>
                <span className="mt-2 text-[10px] font-bold uppercase text-slate-500">Slave Node {i}</span>
              </div>
            ))}
          </div>

          {/* LORA COMMUNICATION LINKS */}
          <div className="relative flex h-16 w-full max-w-[300px] items-center justify-center">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-200">
              <motion.div 
                className="w-full h-full bg-emerald-400"
                initial={{ scaleY: 0, originY: 0 }}
                animate={{ scaleY: [0, 1, 0], originY: [0, 0, 1] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              />
            </div>
            <svg className="absolute top-0 w-full h-full" preserveAspectRatio="none">
              <path d="M 20 0 L 150 64" stroke="#e2e8f0" strokeWidth="2" fill="none" />
              <path d="M 280 0 L 150 64" stroke="#e2e8f0" strokeWidth="2" fill="none" />
            </svg>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[10px] font-bold text-emerald-600 uppercase tracking-widest z-10">
              LoRa
            </span>
          </div>

          {/* MASTER NODE */}
          <div className="flex flex-col items-center z-10">
            <div className="grid size-16 place-items-center rounded-2xl bg-indigo-50 border-2 border-indigo-500 shadow-sm">
              <Server className="size-7 text-indigo-600" />
            </div>
            <span className="mt-2 text-[10px] font-bold uppercase text-slate-600">Edge Processing Unit</span>
          </div>

          {/* LORAWAN LINK */}
          <div className="relative flex h-16 w-full items-center justify-center">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-200">
              <motion.div 
                className="w-full h-full bg-indigo-400"
                initial={{ scaleY: 0, originY: 0 }}
                animate={{ scaleY: [0, 1, 0], originY: [0, 0, 1] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "linear", delay: 0.2 }}
              />
            </div>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[10px] font-bold text-indigo-600 uppercase tracking-widest z-10">
              LoRaWAN
            </span>
          </div>

          {/* CLOUD */}
          <div className="flex flex-col items-center z-10">
            <div className="grid size-16 place-items-center rounded-2xl bg-blue-50 border-2 border-blue-500 shadow-sm">
              <Cloud className="size-7 text-blue-600" />
            </div>
            <span className="mt-2 text-[10px] font-bold uppercase text-slate-600">Cloud Platform</span>
          </div>

          {/* API LINK */}
          <div className="relative flex h-16 w-full items-center justify-center">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-200">
              <motion.div 
                className="w-full h-full bg-blue-400"
                initial={{ scaleY: 0, originY: 0 }}
                animate={{ scaleY: [0, 1, 0], originY: [0, 0, 1] }}
                transition={{ repeat: Infinity, duration: 1.0, ease: "linear", delay: 0.4 }}
              />
            </div>
          </div>

          {/* DASHBOARD */}
          <div className="flex flex-col items-center z-10">
            <div className="grid size-16 place-items-center rounded-2xl bg-slate-900 shadow-lg">
              <Monitor className="size-7 text-white" />
            </div>
            <span className="mt-2 text-[10px] font-bold uppercase text-slate-900">GIS + AI Dashboard</span>
          </div>

        </div>
      </CardContent>
    </Card>
  );
}

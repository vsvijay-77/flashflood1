import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Supervisor exports DISABLE_HOT_RELOAD=true when the platform sets ENABLE_RELOAD=false.
const hotReloadDisabled = process.env.DISABLE_HOT_RELOAD === "true";

// Pod inotify quota is node-shared and routinely exhausted; native fs.watch EMFILEs at
// boot. Polling is the load-bearing default (set before Vite evaluates the config).
if (!hotReloadDisabled && process.platform === "linux") {
  process.env.CHOKIDAR_USEPOLLING = "true";
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // optimizeDeps: {
  //   include: [
  //     "@base-ui/react/button",
  //     "@base-ui/react/checkbox",
  //     "@base-ui/react/dialog",
  //     "@base-ui/react/input",
  //     "@base-ui/react/menu",
  //     "@base-ui/react/merge-props",
  //     "@base-ui/react/popover",
  //     "@base-ui/react/select",
  //     "@base-ui/react/tabs",
  //     "@base-ui/react/use-render",
  //     "@tanstack/react-query",
  //     "class-variance-authority",
  //     "clsx",
  //     "date-fns",
  //     "lucide-react",
  //     "motion/react",
  //     "next-themes",
  //     "react",
  //     "react-day-picker",
  //     "react-dom/client",
  //     "react-is",
  //     "react-router-dom",
  //     "recharts",
  //     "sonner",
  //     "tailwind-merge",
  //   ],
  // },
  server: {
    host: true,
    port: 3000,
    allowedHosts: true,
    // No hmr.clientPort override: Vite infers the WS target from window.location, which
    // is correct on both localhost:3000 (smoke) and the https/:443 preview proxy.
    hmr: !hotReloadDisabled,
    watch: hotReloadDisabled ? null : (process.platform === "linux" ? { usePolling: true, interval: 300 } : undefined),
    // The /api proxy convention: frontend code calls relative /api/*, never an
    // absolute backend URL. Target is the FastAPI dev server (supervisor: backend).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
      },
    },
  },
});

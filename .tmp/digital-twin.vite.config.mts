import base from "../frontend/vite.config";
export default {
  ...base,
  root: new URL("../frontend", import.meta.url).pathname,
  server: { ...base.server, port: 3001, proxy: { "/api": { target: "http://127.0.0.1:8002", changeOrigin: true } } },
};

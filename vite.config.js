import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const api = `http://localhost:${env.PORT || 4000}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: api, changeOrigin: false },
        "/media": { target: api, changeOrigin: false },
        "/healthz": { target: api, changeOrigin: false },
      },
      watch: { ignored: ["**/.devdb/**", "**/data/**", "**/*.crdownload", "**/*.part", "**/*.tmp"] },
    },
    build: {
      target: "es2020",
      sourcemap: false,
      chunkSizeWarningLimit: 600,
    },
  };
});

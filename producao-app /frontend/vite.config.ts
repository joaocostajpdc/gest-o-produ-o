import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Configuração Vite: proxy de /api para o backend Express em desenvolvimento.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});

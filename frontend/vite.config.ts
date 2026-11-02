/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The graph explorer calls the FastAPI backend at /v1; proxying keeps it
  // same-origin in dev, so the API needs no CORS setup.
  server: { port: 5173, proxy: { "/v1": "http://127.0.0.1:8000" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});

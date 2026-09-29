import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "testpaq-dev-session",
      transformIndexHtml(html, context) {
        if (context.server) return html.replace("__TESTPAQ_SESSION__", process.env.TESTPAQ_SESSION_TOKEN ?? "dev-session");
        return html;
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4178" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});

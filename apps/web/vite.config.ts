import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // Load root .env so VITE_SERVER_PORT is available
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  const serverPort = rootEnv.SERVER_PORT || "8080";

  return {
    plugins: [react()],
    server: { port: 5173 },
    define: {
      "import.meta.env.VITE_SERVER_PORT": JSON.stringify(serverPort)
    }
  };
});

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  const serverPort = rootEnv.SERVER_PORT || "8080";

  return {
    plugins: [react()],
    server: { port: 5174 },
    define: {
      "import.meta.env.VITE_SERVER_PORT": JSON.stringify(serverPort)
    }
  };
});
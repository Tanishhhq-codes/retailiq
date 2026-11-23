import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Serves /api/* from the same handler files Vercel runs in production, so `npm run dev`
// behaves like the deployed site without needing the Vercel CLI.
function devApi(): Plugin {
  return {
    name: "retailiq-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([a-z-]+)/);
        if (!m) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.js`);
          await mod.default(req, res);
        } catch (e) {
          res.statusCode = 500; res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

// VITE_STATIC=1 builds a static preview (relative paths, no API) into dist-static/.
const STATIC = process.env.VITE_STATIC === "1";
export default defineConfig({
  base: STATIC ? "./" : "/",
  plugins: [react(), devApi()],
  build: { sourcemap: false, outDir: STATIC ? "dist-static" : "dist" },
});

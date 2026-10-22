import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // fileURLToPath, not `new URL(...).pathname`: the latter is a URL
    // path, not a filesystem path. On Windows it comes back as
    // "/D:/07%20-%20PROJETOS/..." — leading slash and percent-encoded
    // spaces — and Vite then cannot find the file, so every test that
    // transitively imports @app-messages dies with ERR_MODULE_NOT_FOUND.
    alias: {
      "@app-messages": fileURLToPath(
        new URL("./messages/en.json", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
      // Pin the app locale so the formatting assertions don't depend on
      // the machine's regional settings — a pt-BR Windows box and an
      // en-US CI runner would otherwise disagree on what "1,234" is.
      // Pinning it here also documents the intent: the app's locale
      // decides the format, never the runtime's.
      NEXT_PUBLIC_APP_LOCALE: "en",
    },
    clearMocks: true,
  },
});

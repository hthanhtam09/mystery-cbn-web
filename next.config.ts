import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname),
    resolveAlias: {
      // Force the browser build: Turbopack sometimes honors jspdf's "node"
      // export condition in client code too, whose Blob polyfill is not the
      // one URL.createObjectURL() accepts (fails with "Overload resolution
      // failed").
      jspdf: "jspdf/dist/jspdf.es.min.js",
    },
  },
};

export default nextConfig;

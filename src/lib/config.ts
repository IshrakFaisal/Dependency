import "server-only";

// Independent gates: demo data is never substituted for a real analysis.
export const demoMode =
  process.env.DEMO_MODE === undefined || process.env.DEMO_MODE === "true";

export const staticAnalysisEnabled =
  process.env.STATIC_ANALYSIS_ENABLED === undefined ||
  process.env.STATIC_ANALYSIS_ENABLED === "true";

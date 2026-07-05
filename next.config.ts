import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by the Aspire apphost's publish mode, which containerizes the
  // app from .next/standalone for Azure Container Apps.
  output: "standalone",
};

export default nextConfig;

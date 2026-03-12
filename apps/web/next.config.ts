import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@evefrontier/dapp-kit", "@mysten/dapp-kit-react", "@mysten/dapp-kit-core"],
};

export default nextConfig;

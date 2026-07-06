import type { NextConfig } from "next";
import path from "path";

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
} as NextConfig;

export default nextConfig;

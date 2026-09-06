/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native and Node-only packages that must not be bundled by Next's compiler.
  serverExternalPackages: ["pngjs", "sharp", "pg", "pg-boss"]
};

export default nextConfig;

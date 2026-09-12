/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native and Node-only packages that must not be bundled by Next's compiler.
  serverExternalPackages: ["pngjs", "sharp", "pg", "pg-boss"],

  /**
   * Lets a build run without fighting the dev server for `.next`. Sharing the
   * directory makes `next build` fail with a bogus "Cannot find module for
   * page" on whichever route it reads while dev rewrites the manifest.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * Sends www to the apex, so there is one canonical origin.
   *
   * This lives here because neither layer above it can do the job. App
   * Platform's ALIAS domain type only serves the app on a second hostname, it
   * does not redirect, and a Cloudflare redirect rule never executes while the
   * records are DNS-only. Without this, www answers 200 with duplicate content
   * and needs its own CORS entry on the bucket.
   */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.spritebench.com" }],
        destination: "https://spritebench.com/:path*",
        permanent: true
      }
    ];
  }
};

export default nextConfig;

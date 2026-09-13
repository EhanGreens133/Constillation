/** @type {import('next').NextConfig} */
const nextConfig = {
  // The archive is a long-lived, self-hosted artifact: prefer explicitness over magic.
  reactStrictMode: true,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["mongodb"],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        // The capture shell must be installable/offline-cacheable by the service worker.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;

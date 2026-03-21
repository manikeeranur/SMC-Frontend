/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "https://smc-backend-yheu.onrender.com"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

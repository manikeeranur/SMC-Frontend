/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://13.61.175.6:4000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

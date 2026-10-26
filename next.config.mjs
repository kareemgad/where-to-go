/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fail the production build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;

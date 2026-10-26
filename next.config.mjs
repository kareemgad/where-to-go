/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fail the production build on type errors rather than shipping them.
  // Next 16 removed `next lint` and the `eslint` config key with it; linting
  // runs as its own step in `npm run verify`.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;

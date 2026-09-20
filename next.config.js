/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Bundle docs UI locally where practical; swagger-ui-react is bundled by webpack.
  transpilePackages: ["swagger-ui-react"],
};

module.exports = nextConfig;

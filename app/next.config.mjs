/** @type {import('next').NextConfig} */
export default {
  // @pulso/sdk ships TypeScript source (main: src/index.ts) and imports "./x.js" for "./x.ts".
  transpilePackages: ["@pulso/sdk"],
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

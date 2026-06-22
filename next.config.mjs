import path from "path";

const MESH_SERVER_EXTERNALS = [
    "@meshsdk/react",
    "@meshsdk/core",
    "@meshsdk/core-cst",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: function (config, options) {
        config.experiments = {
            ...(config.experiments || {}),
            asyncWebAssembly: true,
            layers: true, // required for some wasm scenarios
        };
        config.resolve = config.resolve || {};
        config.resolve.alias = {
            ...(config.resolve.alias || {}),
            "util-deprecate": path.resolve("./lib/shims/util-deprecate.js"),
        };
        if (options.isServer) {
            const existingExternals = Array.isArray(config.externals)
                ? config.externals
                : config.externals
                    ? [config.externals]
                    : [];
            config.externals = [
                ...existingExternals,
                Object.fromEntries(
                    MESH_SERVER_EXTERNALS.map((pkg) => [pkg, `commonjs ${pkg}`])
                ),
            ];
        }
        return config;
    },
};

export default nextConfig;

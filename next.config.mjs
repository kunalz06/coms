const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'simple-peer': false, // or handle if needed, usually just global/process
      };
    }
    return config;
  },
};

export default nextConfig;

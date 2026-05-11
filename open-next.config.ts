import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const cloudflareConfig = {
  ...defineCloudflareConfig({}),
  buildCommand: "npm run build:next",
};

export default cloudflareConfig;

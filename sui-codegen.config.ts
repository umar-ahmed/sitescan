import type { SuiCodegenConfig } from "@mysten/codegen";

const config: SuiCodegenConfig = {
  output: "./src/contracts",
  packages: [
    {
      package: "@local-pkg/scan_market",
      path: "./move/scan_market",
    },
  ],
};

export default config;

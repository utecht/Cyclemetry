import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((current) => ({
  ...current,
  module: {
    ...current.module,
    rules: [
      ...(current.module?.rules ?? []),
      {
        test: /\.(jpg|jpeg|png|gif|webp)$/i,
        type: "asset/resource",
      },
    ],
  },
}));

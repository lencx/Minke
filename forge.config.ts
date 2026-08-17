import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pruneMacElectronLocales } from "./scripts/forge/electron-locales.ts";
import {
  parsePackageArtifactPolicy,
  verifyPackagedApplication,
} from "./scripts/forge/package-artifact.ts";

const projectRoot = __dirname;
const iconRoot = join(projectRoot, "resources", "icons");
const appIcon = join(iconRoot, "icon.png");
const sysPackageRoot = join(projectRoot, "packages", "sys");

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (
      _forgeConfig,
      buildPath,
      _electronVersion,
      platform,
      _arch,
    ) => {
      if (platform !== "darwin") return;
      const nodeModulesRoot = join(buildPath, "node_modules");
      await mkdir(nodeModulesRoot, { recursive: true });
      await cp(sysPackageRoot, join(nodeModulesRoot, "sys"), {
        recursive: true,
      });
    },
    postPackage: async (
      _forgeConfig,
      { arch, outputPaths, platform },
    ) => {
      const [runtimeContract, artifactPolicy] = await Promise.all([
        readFile(
          join(projectRoot, "config", "harness-runtime.json"),
          "utf8",
        ).then(JSON.parse),
        readFile(
          join(projectRoot, "config", "package-artifact.json"),
          "utf8",
        ).then(JSON.parse).then(parsePackageArtifactPolicy),
      ]);
      for (const outputPath of outputPaths) {
        const report = await verifyPackagedApplication(outputPath, {
          appSizeBudgetBytes:
            artifactPolicy.appSizeBudgetBytes[platform],
          arch: String(arch),
          platform,
          productPackageName:
            runtimeContract.productBundle.packageName,
          runtimeFileBudget: runtimeContract.runtimeFileBudget,
          runtimeSizeBudgetBytes:
            runtimeContract.runtimeSizeBudgetBytes[platform],
        });
        console.log(
          `Verified packaged Host ${(report.host.bytes / 1024 / 1024).toFixed(1)} MiB/${String(report.host.files)} files and app ${(report.app.bytes / 1024 / 1024).toFixed(1)} MiB`,
        );
      }
    },
  },
  packagerConfig: {
    name: "Minke",
    executableName: "Minke",
    appBundleId: "me.lencx.minke",
    appCategoryType: "public.app-category.developer-tools",
    asar: {
      unpack: "**/node_modules/sys/**/*.node",
    },
    // The Vite plugin copies only .vite and packageAfterCopy injects the sole
    // external native package on macOS. Packager pruning would otherwise walk
    // the complete pnpm graph before that ignore policy, retaining redundant
    // production packages and consuming several GiB on every desktop OS.
    prune: false,
    icon: join(iconRoot, "icon"),
    afterCopyExtraResources: [
      (buildPath, _electronVersion, platform, _arch, callback) => {
        if (platform !== "darwin") {
          callback();
          return;
        }
        void pruneMacElectronLocales(join(buildPath, "Minke.app")).then(
          (result) => {
            console.log(
              `Pruned ${String(result.removed.length)} unused Electron locales`,
            );
            callback();
          },
          (error: unknown) => {
            callback(
              error instanceof Error
                ? error
                : new Error(String(error)),
            );
          },
        );
      },
    ],
    extraResource: [
      join(projectRoot, "runtime", "host"),
      join(projectRoot, "resources", "desktop-style-extension"),
      join(projectRoot, "resources", "licenses"),
      appIcon,
      join(iconRoot, "trayTemplate.png"),
      join(iconRoot, "trayTemplate@2x.png"),
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "Minke",
      setupIcon: join(iconRoot, "icon.ico"),
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({
      format: "ULFO",
      icon: join(iconRoot, "icon.icns"),
    }),
    new MakerRpm({
      options: {
        bin: "Minke",
        icon: appIcon,
      },
    }),
    new MakerDeb({
      options: {
        bin: "Minke",
        icon: appIcon,
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "desktop/main/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "desktop/preload/desktop-preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      // Harness and the bundled pnpm run as isolated Node processes through
      // Electron's own runtime, so a second standalone Node binary is unnecessary.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

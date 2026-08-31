import { strict as assert } from "node:assert";
import {
  DEFAULT_DATA_ROOT,
  DEFAULT_EXTERNAL_VOLUME_PATH,
  DEFAULT_SYSTEM_DATA_VOLUME_PATH,
  parsePowerShellVolumeOutput,
  GIB,
  isPathInside,
  parseDfOutput,
  parseMountOutput,
  resolveStorageConfig,
  runStoragePreflight,
  validateVolume,
  type VolumeInspection,
} from "./check-data-storage.ts";

const config = resolveStorageConfig(
  {
    STORAGE_MIN_EXTERNAL_GIB: "0.5",
    STORAGE_MIN_SYSTEM_DATA_GIB: "0.25",
  },
  "darwin",
);
assert.equal(config.externalVolumePath, DEFAULT_EXTERNAL_VOLUME_PATH);
assert.equal(config.dataRoot, DEFAULT_DATA_ROOT);
assert.equal(config.systemDataVolumePath, DEFAULT_SYSTEM_DATA_VOLUME_PATH);
assert.equal(config.systemDataCheckKind, "system");
assert.equal(config.externalMinFreeBytes, 0.5 * GIB);
assert.equal(config.systemDataMinFreeBytes, 0.25 * GIB);

const mount = parseMountOutput(
  "/dev/disk7s1 on /Volumes/Lark (apfs, local, nodev, nosuid, journaled)\n",
  "/Volumes/Lark",
  "darwin",
);
const df = parseDfOutput(
  "Filesystem 1024-blocks Used Available Capacity Mounted on\n" +
    "/dev/disk7s1 100000000 1 60000000 1% /Volumes/Lark\n",
  "/Volumes/Lark",
  "darwin",
);
assert.deepEqual(mount, {
  mountPoint: "/Volumes/Lark",
  filesystem: "apfs",
  readOnly: false,
});
assert.equal(df?.mountPoint, "/Volumes/Lark");
assert.equal(df?.availableBytes, 60_000_000 * 1024);

const unmountedConfig = resolveStorageConfig({ STORAGE_MIN_EXTERNAL_GIB: "0" }, "darwin");
const unmountedInspection: VolumeInspection = {
  path: unmountedConfig.externalVolumePath,
  mounted: false,
  mountPoint: "/",
  filesystem: "apfs",
  availableBytes: 100 * GIB,
};
assert.match(
  validateVolume(unmountedInspection, unmountedConfig, "external").join(" "),
  /not mounted|fallback/,
);
assert.equal(isPathInside(unmountedConfig.dataRoot, unmountedConfig.externalVolumePath), true);
assert.equal(isPathInside("/System/Volumes/Data/games", unmountedConfig.externalVolumePath), false);

const windowsConfig = resolveStorageConfig(
  {
    DATA_DIR: "D:/GamesMcp/data",
    SystemDrive: "C:",
    STORAGE_MIN_EXTERNAL_GIB: "1",
    STORAGE_MIN_SYSTEM_DATA_GIB: "0.5",
  },
  "win32",
);
assert.equal(windowsConfig.platform, "win32");
assert.equal(windowsConfig.dataRoot, "D:\\GamesMcp\\data");
assert.equal(windowsConfig.externalVolumePath, "D:\\");
assert.equal(windowsConfig.systemDataVolumePath, "C:\\");
assert.equal(windowsConfig.systemDataCheckKind, "system");
assert.equal(isPathInside(windowsConfig.dataRoot, windowsConfig.externalVolumePath, "win32"), true);
assert.equal(
  isPathInside("C:\\Users\\someone\\data", windowsConfig.externalVolumePath, "win32"),
  false,
);

const windowsEvidence = parsePowerShellVolumeOutput(
  JSON.stringify({
    Mounted: true,
    MountPoint: "D:\\",
    FileSystem: "NTFS",
    Size: 200 * GIB,
    SizeRemaining: 100 * GIB,
    ReadOnly: false,
  }),
  windowsConfig.dataRoot,
);
assert.equal(windowsEvidence?.mounted, true);
assert.equal(windowsEvidence?.filesystem, "ntfs");
assert.equal(windowsEvidence?.availableBytes, 100 * GIB);
assert.deepEqual(
  validateVolume(
    {
      path: windowsConfig.externalVolumePath,
      mounted: true,
      mountPoint: "D:\\",
      filesystem: "ntfs",
      readOnly: false,
      availableBytes: 100 * GIB,
    },
    windowsConfig,
    "external",
  ),
  [],
);

const windowsPreflight = await runStoragePreflight({
  platform: "win32",
  env: {
    DATA_DIR: "D:/GamesMcp/data",
    SystemDrive: "C:",
    STORAGE_MIN_EXTERNAL_GIB: "0",
    STORAGE_MIN_SYSTEM_DATA_GIB: "0",
  },
  runCommand: async (_command, args) => {
    const command = args[args.indexOf("-Command") + 1] ?? "";
    const system = command.includes("C:\\");
    return JSON.stringify({
      Mounted: true,
      MountPoint: system ? "C:\\" : "D:\\",
      FileSystem: "NTFS",
      Size: 200 * GIB,
      SizeRemaining: 100 * GIB,
      ReadOnly: false,
    });
  },
  accessPath: async () => undefined,
  realpathPath: async (path) => path,
});
assert.equal(windowsPreflight.ok, true);

const externalRuntimeConfig = resolveStorageConfig(
  {
    DATA_DIR: "/Volumes/Lark/lark/GamesMcp/data",
    STORAGE_RUNTIME_VOLUME_PATH: "/Volumes/Lark",
    STORAGE_MIN_EXTERNAL_GIB: "1",
    STORAGE_MIN_SYSTEM_DATA_GIB: "0.5",
  },
  "darwin",
);
assert.equal(externalRuntimeConfig.systemDataVolumePath, "/Volumes/Lark");
assert.equal(externalRuntimeConfig.systemDataCheckKind, "external_runtime");
const externalRuntimePreflight = await runStoragePreflight({
  platform: "darwin",
  env: {
    DATA_DIR: "/Volumes/Lark/lark/GamesMcp/data",
    STORAGE_RUNTIME_VOLUME_PATH: "/Volumes/Lark",
    STORAGE_MIN_EXTERNAL_GIB: "1",
    STORAGE_MIN_SYSTEM_DATA_GIB: "0.5",
  },
  runCommand: async (command) => {
    if (command === "df")
      return (
        "Filesystem 1024-blocks Used Available Capacity Mounted on\n" +
        "/dev/disk7s1 100000000 1 60000000 1% /Volumes/Lark\n"
      );
    if (command === "mount")
      return "/dev/disk7s1 on /Volumes/Lark (apfs, local, nodev, nosuid, journaled)\n";
    return "";
  },
  accessPath: async () => undefined,
  realpathPath: async (path) => path,
});
assert.equal(externalRuntimePreflight.ok, true);

console.log("check-data-storage helpers passed");

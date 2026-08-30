import { access, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Host-side storage guard for the bind mounts used by Docker Compose.
 *
 * This module deliberately does not create a fallback directory. A failed
 * check is returned to the CLI, which exits with status 1 before Docker is
 * started. The exported parsers and validators keep the platform checks
 * independently testable without requiring a real mounted disk.
 */

export const GIB = 1024 ** 3;
export const DEFAULT_EXTERNAL_VOLUME_PATH = "/Volumes/Lark";
export const DEFAULT_DATA_ROOT = "/Volumes/Lark/lark/GamesMcp/data";
export const DEFAULT_SYSTEM_DATA_VOLUME_PATH = "/System/Volumes/Data";
export const DEFAULT_WINDOWS_DATA_ROOT = "data";
export const DEFAULT_WINDOWS_SYSTEM_DATA_VOLUME_PATH = "C:\\";
export const DEFAULT_EXTERNAL_MIN_FREE_GIB = 50;
export const DEFAULT_SYSTEM_DATA_MIN_FREE_GIB = 10;

const WINDOWS_EXTERNAL_FILESYSTEMS = new Set(["ntfs", "refs"]);
const PORTABLE_EXTERNAL_FILESYSTEMS = new Set([
  "9p",
  "apfs",
  "btrfs",
  "ext2",
  "ext3",
  "ext4",
  "fuseblk",
  "ntfs",
  "ntfs-3g",
  "refs",
  "drvfs",
  "xfs",
]);

function pathApi(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? win32 : posix;
}

function normalizePathForPlatform(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return pathApi(platform).resolve(path);
}

function defaultWindowsSystemPath(env: Environment): string {
  const systemRoot = firstEnvironmentValue(env, ["SystemRoot", "WINDIR"]);
  if (systemRoot) return win32.parse(systemRoot).root;
  const systemDrive = firstEnvironmentValue(env, ["SystemDrive"]);
  if (systemDrive) return win32.parse(`${systemDrive}\\`).root;
  return DEFAULT_WINDOWS_SYSTEM_DATA_VOLUME_PATH;
}

function defaultDataRootForPlatform(env: Environment, platform: NodeJS.Platform): string {
  const configured = firstEnvironmentValue(env, dataRootEnvironmentVariables);
  if (configured) return configured;
  if (platform === "darwin") return DEFAULT_DATA_ROOT;
  if (platform === "win32") return DEFAULT_WINDOWS_DATA_ROOT;
  return "data";
}

const externalThresholdGiBEnvironmentVariables = [
  "STORAGE_MIN_EXTERNAL_GIB",
  "STORAGE_EXTERNAL_MIN_FREE_GIB",
  "STORAGE_EXTERNAL_MIN_GIB",
  "DATA_STORAGE_MIN_EXTERNAL_GIB",
  "EXTERNAL_VOLUME_MIN_FREE_GIB",
  "EXTERNAL_VOLUME_MIN_GIB",
  "MIN_EXTERNAL_FREE_GIB",
  "MIN_EXTERNAL_VOLUME_GIB",
  "MIN_EXTERNAL_DISK_GIB",
  "EXTERNAL_MIN_FREE_GIB",
  "EXTERNAL_MIN_GIB",
  "MIN_EXTERNAL_GIB",
] as const;

const systemThresholdGiBEnvironmentVariables = [
  "STORAGE_MIN_SYSTEM_DATA_GIB",
  "STORAGE_SYSTEM_DATA_MIN_FREE_GIB",
  "STORAGE_SYSTEM_DATA_MIN_GIB",
  "DATA_STORAGE_MIN_SYSTEM_GIB",
  "SYSTEM_DATA_VOLUME_MIN_FREE_GIB",
  "SYSTEM_DATA_VOLUME_MIN_GIB",
  "MIN_SYSTEM_DATA_FREE_GIB",
  "MIN_SYSTEM_DATA_VOLUME_GIB",
  "SYSTEM_DATA_MIN_FREE_GIB",
  "SYSTEM_DATA_MIN_GIB",
  "SYSTEM_MIN_FREE_GIB",
  "MIN_SYSTEM_FREE_GIB",
  "MIN_SYSTEM_GIB",
] as const;

const externalThresholdBytesEnvironmentVariables = [
  "STORAGE_MIN_EXTERNAL_BYTES",
  "EXTERNAL_VOLUME_MIN_FREE_BYTES",
  "EXTERNAL_VOLUME_MIN_BYTES",
] as const;

const systemThresholdBytesEnvironmentVariables = [
  "STORAGE_MIN_SYSTEM_DATA_BYTES",
  "SYSTEM_DATA_VOLUME_MIN_FREE_BYTES",
  "SYSTEM_DATA_VOLUME_MIN_BYTES",
] as const;

const externalPathEnvironmentVariables = [
  "STORAGE_EXTERNAL_VOLUME_PATH",
  "STORAGE_VOLUME_PATH",
  "EXTERNAL_VOLUME_PATH",
] as const;

const systemDataPathEnvironmentVariables = [
  "STORAGE_SYSTEM_DATA_VOLUME_PATH",
  "SYSTEM_DATA_VOLUME_PATH",
] as const;

const dataRootEnvironmentVariables = ["STORAGE_DATA_ROOT", "DATA_ROOT", "DATA_DIR"] as const;

export type Environment = Record<string, string | undefined>;

export type StorageConfig = {
  platform: NodeJS.Platform;
  externalVolumePath: string;
  dataRoot: string;
  systemDataVolumePath: string;
  externalMinFreeGiB: number;
  externalMinFreeBytes: number;
  systemDataMinFreeGiB: number;
  systemDataMinFreeBytes: number;
};

export type CommandResult = {
  stdout: string;
  stderr?: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<CommandResult | string>;

export type AccessPath = (path: string, mode: number) => Promise<void>;
export type RealpathPath = (path: string) => Promise<string>;

export type VolumeEvidence = {
  mountPoint?: string;
  mounted?: boolean;
  filesystem?: string;
  readOnly?: boolean;
  availableBytes?: number;
  totalBytes?: number;
};

export type VolumeInspection = VolumeEvidence & {
  path: string;
  mounted: boolean;
};

export type StoragePreflightOptions = {
  env?: Environment;
  runCommand?: CommandRunner;
  accessPath?: AccessPath;
  realpathPath?: RealpathPath;
  platform?: NodeJS.Platform;
};

export type StoragePreflightResult = {
  ok: boolean;
  config: StorageConfig;
  external: VolumeInspection;
  systemData: VolumeInspection;
  errors: string[];
};

const execFileAsync = promisify(execFile);

let envFileLoaded = false;

function loadLocalEnvironment(): void {
  if (envFileLoaded || typeof process.loadEnvFile !== "function") return;
  envFileLoaded = true;
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function defaultCommandRunner(
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  const result = await execFileAsync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout),
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstEnvironmentValue(env: Environment, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseNonNegativeNumber(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a finite non-negative number; got ${JSON.stringify(raw)}`);
  return value;
}

function threshold(
  env: Environment,
  gibNames: readonly string[],
  bytesNames: readonly string[],
  defaultGiB: number,
  label: string,
): { gib: number; bytes: number } {
  const bytesRaw = firstEnvironmentValue(env, bytesNames);
  if (bytesRaw !== undefined) {
    const bytes = parseNonNegativeNumber(bytesRaw, label);
    return { gib: bytes / GIB, bytes };
  }
  const gibRaw = firstEnvironmentValue(env, gibNames);
  const gib = gibRaw === undefined ? defaultGiB : parseNonNegativeNumber(gibRaw, label);
  return { gib, bytes: gib * GIB };
}

/** Resolve storage paths and thresholds without reading or writing the host. */
export function resolveStorageConfig(
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): StorageConfig {
  if (env === process.env) loadLocalEnvironment();
  const dataRoot = normalizePathForPlatform(defaultDataRootForPlatform(env, platform), platform);
  const externalVolumePath = normalizePathForPlatform(
    firstEnvironmentValue(env, externalPathEnvironmentVariables) ??
      (platform === "darwin"
        ? DEFAULT_EXTERNAL_VOLUME_PATH
        : platform === "win32"
          ? pathApi(platform).parse(dataRoot).root
          : pathApi(platform).parse(dataRoot).root),
    platform,
  );
  const systemDataVolumePath = normalizePathForPlatform(
    firstEnvironmentValue(env, systemDataPathEnvironmentVariables) ??
      (platform === "darwin"
        ? DEFAULT_SYSTEM_DATA_VOLUME_PATH
        : platform === "win32"
          ? defaultWindowsSystemPath(env)
          : "/"),
    platform,
  );
  const externalThreshold = threshold(
    env,
    externalThresholdGiBEnvironmentVariables,
    externalThresholdBytesEnvironmentVariables,
    DEFAULT_EXTERNAL_MIN_FREE_GIB,
    "external storage threshold",
  );
  const systemThreshold = threshold(
    env,
    systemThresholdGiBEnvironmentVariables,
    systemThresholdBytesEnvironmentVariables,
    DEFAULT_SYSTEM_DATA_MIN_FREE_GIB,
    "system data storage threshold",
  );
  return {
    platform,
    externalVolumePath,
    dataRoot,
    systemDataVolumePath,
    externalMinFreeGiB: externalThreshold.gib,
    externalMinFreeBytes: externalThreshold.bytes,
    systemDataMinFreeGiB: systemThreshold.gib,
    systemDataMinFreeBytes: systemThreshold.bytes,
  };
}

function normalizePath(path: string, platform: NodeJS.Platform = process.platform): string {
  return normalizePathForPlatform(path, platform);
}

/** Return true only when child is a strict descendant of parent. */
export function isPathInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const api = pathApi(platform);
  const relativePath = api.relative(
    normalizePath(parent, platform),
    normalizePath(child, platform),
  );
  return Boolean(
    relativePath &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${api.sep}`) &&
    !api.isAbsolute(relativePath),
  );
}

function parseScaledBytes(raw: string, multiplier: number): number | undefined {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) return undefined;
  const bytes = value * multiplier;
  return Number.isFinite(bytes) ? bytes : undefined;
}

/** Parse POSIX df output. Available space is intentionally used for safety. */
export function parseDfOutput(
  output: string,
  expectedMountPath?: string,
): VolumeEvidence | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const header = lines.find((line) => /\bFilesystem\b/i.test(line) && /blocks/i.test(line));
  const multiplier = header && /512-blocks/i.test(header) ? 512 : 1024;
  const expected = expectedMountPath ? normalizePath(expectedMountPath) : undefined;

  for (const line of [...lines].reverse()) {
    if (/^Filesystem\b/i.test(line.trim())) continue;
    let metricLine = line.trim();
    let mountPoint: string | undefined;
    if (expected && metricLine.endsWith(expected)) {
      metricLine = metricLine.slice(0, -expected.length).trim();
      mountPoint = expected;
    }
    const fields = metricLine.split(/\s+/);
    if (fields.length < (mountPoint ? 5 : 6)) continue;
    const [filesystem, totalBlocks, , availableBlocks] = fields;
    if (!filesystem || !totalBlocks || !availableBlocks) continue;
    if (!/^\d+(?:\.\d+)?$/.test(totalBlocks) || !/^\d+(?:\.\d+)?$/.test(availableBlocks)) continue;
    const parsedMountPoint = mountPoint ?? fields.slice(5).join(" ");
    if (!parsedMountPoint) continue;
    return {
      mountPoint: normalizePath(parsedMountPoint),
      filesystem,
      totalBytes: parseScaledBytes(totalBlocks, multiplier),
      availableBytes: parseScaledBytes(availableBlocks, multiplier),
    };
  }
  return undefined;
}

function decodeMountPath(path: string): string {
  return path.replace(/\\040/g, " ").replace(/\\011/g, "\t");
}

function mountOptions(options: string | undefined): { readOnly: boolean; filesystem?: string } {
  const values = (options ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return {
    filesystem: values[0],
    readOnly: values.includes("ro") || values.includes("read-only"),
  };
}

/** Parse macOS (and Linux-compatible) mount output for one exact mount point. */
export function parseMountOutput(
  output: string,
  expectedMountPath: string,
): VolumeEvidence | undefined {
  const expected = normalizePath(expectedMountPath);
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const linuxMatch = /^.+?\s+on\s+(.+?)\s+type\s+(\S+)(?:\s+\(([^)]*)\))?\s*$/.exec(line);
    if (linuxMatch) {
      const mountPoint = normalizePath(decodeMountPath(linuxMatch[1] ?? ""));
      if (mountPoint !== expected) continue;
      const options = mountOptions(linuxMatch[3]);
      return {
        mountPoint,
        filesystem: (linuxMatch[2] ?? options.filesystem)?.toLowerCase(),
        readOnly: options.readOnly,
      };
    }

    const macMatch = /^.+?\s+on\s+(.+?)\s+\(([^)]*)\)\s*$/.exec(line);
    if (!macMatch) continue;
    const mountPoint = normalizePath(decodeMountPath(macMatch[1] ?? ""));
    if (mountPoint !== expected) continue;
    const options = mountOptions(macMatch[2]);
    return { mountPoint, filesystem: options.filesystem, readOnly: options.readOnly };
  }
  return undefined;
}

function parseDiskutilBytes(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const exactBytes = /\(\s*([\d,]+(?:\.\d+)?)\s+bytes?\s*\)/i.exec(value);
  if (exactBytes) return parseScaledBytes(exactBytes[1] ?? "", 1);
  const human = /([\d.]+)\s*(K|M|G|T|P)B\b/i.exec(value);
  if (!human) return undefined;
  const unit = (human[2] ?? "").toUpperCase();
  const exponent = { KB: 1, MB: 2, GB: 3, TB: 4, PB: 5 }[
    `${unit}B` as "KB" | "MB" | "GB" | "TB" | "PB"
  ];
  return exponent === undefined ? undefined : parseScaledBytes(human[1] ?? "", 1000 ** exponent);
}

/** Parse the text form of `diskutil info`, used when mount output is unavailable. */
export function parseDiskutilInfo(
  output: string,
  expectedMountPath?: string,
): VolumeEvidence | undefined {
  const fields = new Map<string, string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const separator = rawLine.indexOf(":");
    if (separator < 0) continue;
    const key = rawLine.slice(0, separator).trim().toLowerCase();
    const value = rawLine.slice(separator + 1).trim();
    if (key && value) fields.set(key, value);
  }
  if (!fields.size) return undefined;

  const mountPoint = fields.get("mount point");
  const expected = expectedMountPath ? normalizePath(expectedMountPath) : undefined;
  const mountedValue = fields.get("mounted");
  const filesystem =
    fields.get("file system personality") ??
    fields.get("filesystem personality") ??
    fields.get("type (bundle)") ??
    fields.get("file system type");
  const freeValue =
    fields.get("volume free space") ??
    fields.get("container free space") ??
    fields.get("free space");
  const totalValue =
    fields.get("volume total space") ??
    fields.get("container total space") ??
    fields.get("total space");
  return {
    mountPoint: mountPoint ? normalizePath(mountPoint) : undefined,
    mounted:
      mountedValue === undefined
        ? undefined
        : /^yes$/i.test(mountedValue) || /^true$/i.test(mountedValue),
    filesystem: filesystem?.trim().toLowerCase(),
    availableBytes: parseDiskutilBytes(freeValue),
    totalBytes: parseDiskutilBytes(totalValue),
    ...(expected && mountPoint && normalizePath(mountPoint) !== expected ? { mounted: false } : {}),
  };
}

/** Parse the compact JSON emitted by the Windows PowerShell volume probe. */
export function parsePowerShellVolumeOutput(
  output: string,
  expectedPath: string,
): VolumeEvidence | undefined {
  try {
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    const mountPoint = typeof parsed.MountPoint === "string" ? parsed.MountPoint : undefined;
    if (!mountPoint) return undefined;
    const filesystem =
      typeof parsed.FileSystem === "string" ? parsed.FileSystem.trim().toLowerCase() : undefined;
    const availableBytes =
      typeof parsed.SizeRemaining === "number"
        ? parsed.SizeRemaining
        : typeof parsed.SizeRemaining === "string"
          ? Number(parsed.SizeRemaining)
          : undefined;
    const totalBytes =
      typeof parsed.Size === "number"
        ? parsed.Size
        : typeof parsed.Size === "string"
          ? Number(parsed.Size)
          : undefined;
    const readOnly =
      typeof parsed.ReadOnly === "boolean"
        ? parsed.ReadOnly
        : typeof parsed.ReadOnly === "string"
          ? /^(true|yes)$/i.test(parsed.ReadOnly)
          : undefined;
    const mounted =
      typeof parsed.Mounted === "boolean"
        ? parsed.Mounted
        : typeof parsed.Mounted === "string"
          ? /^(true|yes)$/i.test(parsed.Mounted)
          : true;
    const normalizedMount = normalizePath(mountPoint, "win32");
    const normalizedExpected = normalizePath(expectedPath, "win32");
    const expectedRoot = win32.parse(normalizedExpected).root.toLowerCase();
    const mountRoot = win32.parse(normalizedMount).root.toLowerCase();
    return {
      mountPoint: normalizedMount,
      mounted: mounted && Boolean(expectedRoot) && expectedRoot === mountRoot,
      filesystem,
      readOnly,
      ...(Number.isFinite(availableBytes) ? { availableBytes } : {}),
      ...(Number.isFinite(totalBytes) ? { totalBytes } : {}),
    };
  } catch {
    return undefined;
  }
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function inspectWindowsVolume(
  path: string,
  runner: CommandRunner,
): Promise<VolumeInspection> {
  const normalizedPath = normalizePath(path, "win32");
  const script = [
    "$ErrorActionPreference='Stop'",
    `$item=Get-Item -LiteralPath ${powerShellLiteral(normalizedPath)}`,
    "$root=[System.IO.Path]::GetPathRoot($item.FullName)",
    "if ([string]::IsNullOrWhiteSpace($root)) { throw 'Path has no volume root' }",
    "$drive=$root.Substring(0,1)",
    "$volume=Get-Volume -DriveLetter $drive -ErrorAction Stop",
    "[pscustomobject]@{ Mounted=$true; MountPoint=$root; FileSystem=[string]$volume.FileSystem; Size=$volume.Size; SizeRemaining=$volume.SizeRemaining; ReadOnly=$false } | ConvertTo-Json -Compress",
  ].join("; ");
  const output = await optionalCommandOutput(runner, "powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  const evidence = output ? parsePowerShellVolumeOutput(output, normalizedPath) : undefined;
  return {
    path: normalizedPath,
    mounted: evidence?.mounted ?? false,
    mountPoint: evidence?.mountPoint,
    filesystem: evidence?.filesystem,
    readOnly: evidence?.readOnly,
    availableBytes: evidence?.availableBytes,
    totalBytes: evidence?.totalBytes,
  };
}

async function optionalCommandOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const result = await runner(command, args);
    return typeof result === "string" ? result : asString(result.stdout);
  } catch (error) {
    const failure = error as { stdout?: unknown };
    return asString(failure.stdout);
  }
}

function samePath(
  left: string | undefined,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (left === undefined) return false;
  const normalizedLeft = normalizePath(left, platform);
  const normalizedRight = normalizePath(right, platform);
  return platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function volumePathMatches(
  mountPoint: string | undefined,
  expectedPath: string,
  platform: NodeJS.Platform,
): boolean {
  if (!mountPoint) return false;
  if (platform !== "win32") return samePath(mountPoint, expectedPath, platform);
  const expectedRoot = win32.parse(normalizePath(expectedPath, platform)).root;
  const mountRoot = win32.parse(normalizePath(mountPoint, platform)).root;
  return (
    Boolean(expectedRoot && mountRoot) && expectedRoot.toLowerCase() === mountRoot.toLowerCase()
  );
}

/** Inspect one host path using platform-native volume evidence. */
export async function inspectVolume(
  path: string,
  runner: CommandRunner = defaultCommandRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<VolumeInspection> {
  if (platform === "win32") return inspectWindowsVolume(path, runner);
  const normalizedPath = normalizePath(path, platform);
  const dfOutput = await optionalCommandOutput(runner, "df", ["-Pk", normalizedPath]);
  const df = dfOutput ? parseDfOutput(dfOutput, normalizedPath) : undefined;
  const mountOutput = await optionalCommandOutput(runner, "mount", []);
  const mount = mountOutput ? parseMountOutput(mountOutput, normalizedPath) : undefined;
  const diskutilOutput =
    mount === undefined
      ? await optionalCommandOutput(runner, "diskutil", ["info", normalizedPath])
      : undefined;
  const diskutil = diskutilOutput ? parseDiskutilInfo(diskutilOutput, normalizedPath) : undefined;

  const mountedEvidence: boolean[] = [];
  if (df) mountedEvidence.push(volumePathMatches(df.mountPoint, normalizedPath, platform));
  if (mount) mountedEvidence.push(volumePathMatches(mount.mountPoint, normalizedPath, platform));
  if (diskutil?.mounted !== undefined)
    mountedEvidence.push(
      diskutil.mounted && volumePathMatches(diskutil.mountPoint, normalizedPath, platform),
    );
  const mounted = mountedEvidence.length > 0 && mountedEvidence.every(Boolean);
  return {
    path: normalizedPath,
    mounted,
    mountPoint: mount?.mountPoint ?? diskutil?.mountPoint ?? df?.mountPoint,
    filesystem: mount?.filesystem ?? diskutil?.filesystem,
    readOnly: mount?.readOnly ?? diskutil?.readOnly,
    availableBytes: df?.availableBytes ?? diskutil?.availableBytes,
    totalBytes: df?.totalBytes ?? diskutil?.totalBytes,
  };
}

export function validateVolume(
  inspection: VolumeInspection,
  config: StorageConfig,
  kind: "external" | "system",
): string[] {
  const label = kind === "external" ? "external volume" : "system data volume";
  const expectedPath =
    kind === "external" ? config.externalVolumePath : config.systemDataVolumePath;
  const minimumBytes =
    kind === "external" ? config.externalMinFreeBytes : config.systemDataMinFreeBytes;
  const minimumGiB = kind === "external" ? config.externalMinFreeGiB : config.systemDataMinFreeGiB;
  const errors: string[] = [];

  if (
    !inspection.mounted ||
    !volumePathMatches(inspection.mountPoint, expectedPath, config.platform)
  )
    errors.push(`${label} is not mounted at ${expectedPath}; refusing any system-disk fallback`);

  if (kind === "external") {
    const filesystem = inspection.filesystem?.toLowerCase();
    const allowed =
      config.platform === "darwin"
        ? new Set(["apfs"])
        : config.platform === "win32"
          ? WINDOWS_EXTERNAL_FILESYSTEMS
          : PORTABLE_EXTERNAL_FILESYSTEMS;
    if (!filesystem || !allowed.has(filesystem)) {
      const expected =
        config.platform === "darwin"
          ? "APFS"
          : config.platform === "win32"
            ? "NTFS or ReFS"
            : "a supported persistent filesystem";
      errors.push(
        `${label} filesystem must be ${expected}; detected ${inspection.filesystem ?? "unknown"}`,
      );
    }
    if (inspection.readOnly)
      errors.push(`${label} is mounted read-only and cannot hold application data`);
  }

  if (inspection.availableBytes === undefined) {
    errors.push(`${label} free space could not be measured`);
  } else if (inspection.availableBytes < minimumBytes) {
    errors.push(
      `${label} has ${formatGiB(inspection.availableBytes)} available; at least ${minimumGiB} GiB is required`,
    );
  }
  return errors;
}

function formatGiB(bytes: number | undefined): string {
  return bytes === undefined ? "unknown" : `${(bytes / GIB).toFixed(2)} GiB`;
}

async function assertDataRootOnExternal(
  config: StorageConfig,
  resolvePath: RealpathPath,
): Promise<void> {
  if (!isPathInside(config.dataRoot, config.externalVolumePath, config.platform))
    throw new Error(
      `data root ${config.dataRoot} is outside external volume ${config.externalVolumePath}; refusing system-disk fallback`,
    );

  const externalRealPath = normalizePath(
    await resolvePath(config.externalVolumePath),
    config.platform,
  );
  if (!samePath(externalRealPath, config.externalVolumePath, config.platform))
    throw new Error(
      `external volume path resolves to ${externalRealPath}; refusing a symlink/system-disk fallback`,
    );
  const dataRealPath = normalizePath(await resolvePath(config.dataRoot), config.platform);
  if (!isPathInside(dataRealPath, externalRealPath, config.platform))
    throw new Error(
      `data root resolves outside external volume (${dataRealPath}); refusing a system-disk fallback`,
    );
}

async function assertWritable(config: StorageConfig, accessPath: AccessPath): Promise<void> {
  try {
    await accessPath(config.dataRoot, fsConstants.W_OK);
  } catch {
    throw new Error(
      `external data root is not writable: ${config.dataRoot}; refusing a system-disk fallback`,
    );
  }
}

/** Run the fail-closed storage preflight. It never creates a fallback path. */
export async function runStoragePreflight(
  options: StoragePreflightOptions = {},
): Promise<StoragePreflightResult> {
  const platform = options.platform ?? process.platform;
  const config = resolveStorageConfig(options.env ?? process.env, platform);
  const runner = options.runCommand ?? defaultCommandRunner;
  const accessPath = options.accessPath ?? ((path, mode) => access(path, mode));
  const resolvePath = options.realpathPath ?? realpath;
  const [external, systemData] = await Promise.all([
    inspectVolume(config.externalVolumePath, runner, platform),
    inspectVolume(config.systemDataVolumePath, runner, platform),
  ]);
  const errors = [
    ...validateVolume(external, config, "external"),
    ...validateVolume(systemData, config, "system"),
  ];

  if (
    samePath(config.externalVolumePath, config.systemDataVolumePath, platform) ||
    (platform !== "linux" &&
      (isPathInside(config.externalVolumePath, config.systemDataVolumePath, platform) ||
        isPathInside(config.systemDataVolumePath, config.externalVolumePath, platform)))
  )
    errors.push(`external and system data volume paths overlap; refusing a system-disk fallback`);

  if (!errors.length) {
    try {
      await assertDataRootOnExternal(config, resolvePath);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!errors.length) {
    try {
      await assertWritable(config, accessPath);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: errors.length === 0, config, external, systemData, errors };
}

function printResult(result: StoragePreflightResult): void {
  if (result.ok) {
    console.log("Data storage preflight passed.");
    console.log(`  data root: ${result.config.dataRoot}`);
    console.log(
      `  external volume: ${result.external.filesystem?.toUpperCase() ?? "unknown"}, ${formatGiB(result.external.availableBytes)} available (minimum ${result.config.externalMinFreeGiB} GiB)`,
    );
    console.log(
      `  system data volume: ${formatGiB(result.systemData.availableBytes)} available (minimum ${result.config.systemDataMinFreeGiB} GiB)`,
    );
    return;
  }
  console.error("Data storage preflight failed; no system-disk fallback is permitted.");
  for (const error of result.errors) console.error(`  - ${error}`);
}

export async function main(options: StoragePreflightOptions = {}): Promise<number> {
  try {
    const result = await runStoragePreflight(options);
    printResult(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error("Data storage preflight failed; no system-disk fallback is permitted.");
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedScript === fileURLToPath(import.meta.url)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

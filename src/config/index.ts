/**
 * @fileoverview Loads, validates, and exports application configuration.
 * This module centralizes configuration management, sourcing values from
 * environment variables and `package.json`. It uses Zod for schema validation
 * to ensure type safety and correctness of configuration parameters.
 *
 * Key responsibilities:
 * - Load environment variables from a `.env` file.
 * - Read `package.json` for default server name and version.
 * - Define a Zod schema for all expected environment variables.
 * - Validate environment variables against the schema.
 * - Construct and export a comprehensive `config` object.
 * - Export individual configuration values like `logLevel` and `environment` for convenience.
 *
 * @module src/config/index
 */

import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

dotenv.config();

// --- Determine Project Root ---
/**
 * Finds the project root directory by searching upwards for package.json.
 * @param startDir The directory to start searching from.
 * @returns The absolute path to the project root, or throws an error if not found.
 */
const findProjectRoot = (startDir: string): string => {
  let currentDir = startDir;
  while (true) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached the root of the filesystem without finding package.json
      throw new Error(
        `Could not find project root (package.json) starting from ${startDir}`,
      );
    }
    currentDir = parentDir;
  }
};

let projectRoot: string;
try {
  // For ESM, __dirname is not available directly.
  // import.meta.url gives the URL of the current module.
  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  projectRoot = findProjectRoot(currentModuleDir);
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`FATAL: Error determining project root: ${errorMessage}`);
  // Fallback to process.cwd() if project root cannot be determined.
  // This might happen in unusual execution environments.
  projectRoot = process.cwd();
  console.warn(
    `Warning: Using process.cwd() (${projectRoot}) as fallback project root.`,
  );
}
// --- End Determine Project Root ---

const pkgPath = join(projectRoot, "package.json"); // Use determined projectRoot
let pkg = { name: "git-mcp-server", version: "0.0.0" };

try {
  pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
} catch (error) {
  if (process.stdout.isTTY) {
    console.error(
      "Warning: Could not read package.json for default config values. Using hardcoded defaults.",
      error,
    );
  }
}

/**
 * Zod schema for validating environment variables.
 * Provides type safety, validation, defaults, and clear error messages.
 * @private
 */
const EnvSchema = z.object({
  /** Optional. The desired name for the MCP server. Defaults to `package.json` name. */
  MCP_SERVER_NAME: z.string().optional(),
  /** Optional. The version of the MCP server. Defaults to `package.json` version. */
  MCP_SERVER_VERSION: z.string().optional(),
  /** Minimum logging level. See `McpLogLevel` in logger utility. Default: "info". */
  MCP_LOG_LEVEL: z.string().default("info"),
  /** Directory for log files. Defaults to "logs" in project root. */
  LOGS_DIR: z.string().default(path.join(projectRoot, "logs")),
  /** Force console logging regardless of TTY status. Default: false. */
  MCP_FORCE_CONSOLE_LOGGING: z.coerce.boolean().default(false),
  /** Runtime environment (e.g., "development", "production"). Default: "development". */
  NODE_ENV: z.string().default("development"),
  /** MCP communication transport ("stdio" or "http"). Default: "stdio". */
  MCP_TRANSPORT_TYPE: z.enum(["stdio", "http"]).default("stdio"),
  /** MCP session mode ('stateless', 'stateful', 'auto'). Default: 'auto'. */
  MCP_SESSION_MODE: z.enum(["stateless", "stateful", "auto"]).default("auto"),
  /** HTTP server port (if MCP_TRANSPORT_TYPE is "http"). Default: 3010. */
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3010),
  /** HTTP server host (if MCP_TRANSPORT_TYPE is "http"). Default: "127.0.0.1". */
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  /** The endpoint path for the MCP server. Default: "/mcp". */
  MCP_HTTP_ENDPOINT_PATH: z.string().default("/mcp"),
  /** Max retries for binding to a port if the initial one is in use. Default: 15. */
  MCP_HTTP_MAX_PORT_RETRIES: z.coerce.number().int().nonnegative().default(15),
  /** Delay in ms between port binding retries. Default: 50. */
  MCP_HTTP_PORT_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(50),
  /** Timeout in ms for considering a stateful session stale and eligible for cleanup. Default: 1800000 (30 minutes). */
  MCP_STATEFUL_SESSION_STALE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_800_000),
  /** Optional. Comma-separated allowed origins for CORS (HTTP transport). */
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  /** Optional. Secret key (min 32 chars) for auth tokens (HTTP transport). CRITICAL for production. */
  MCP_AUTH_SECRET_KEY: z
    .string()
    .min(
      32,
      "MCP_AUTH_SECRET_KEY must be at least 32 characters long for security reasons.",
    )
    .optional(),
  /** The authentication mode to use. 'jwt' for internal simple JWTs, 'oauth' for OAuth 2.1, or 'none'. Default: 'none'. */
  MCP_AUTH_MODE: z.enum(["jwt", "oauth", "none"]).default("none"),
  /** The expected issuer URL for OAuth 2.1 access tokens. CRITICAL for validation. */
  OAUTH_ISSUER_URL: z.string().url().optional(),
  /** The JWKS (JSON Web Key Set) URI for the OAuth 2.1 provider. If not provided, it's often discoverable from the issuer URL. */
  OAUTH_JWKS_URI: z.string().url().optional(),
  /** The audience claim for the OAuth 2.1 access tokens. This server will reject tokens not intended for it. */
  OAUTH_AUDIENCE: z.string().optional(),

  /** Optional. Client ID to use in development mode for JWT strategy. Default: "dev-client-id". */
  DEV_MCP_CLIENT_ID: z.string().optional(),
  /** Optional. Comma-separated scopes for development mode JWT strategy. Default: "dev-scope". */
  DEV_MCP_SCOPES: z.string().optional(),
  
  /** Flag to enable GPG signing for commits made by the git_commit tool. */
  GIT_SIGN_COMMITS: z.string().transform((val) => val === "true").optional(),
});

const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  if (process.stdout.isTTY) {
    console.error(
      "❌ Invalid environment variables found:",
      parsedEnv.error.flatten().fieldErrors,
    );
  }
  // Consider throwing an error in production for critical misconfigurations.
}

const env = parsedEnv.success ? parsedEnv.data : EnvSchema.parse({});

// --- Directory Ensurance Function ---
const ensureDirectory = (
  dirPath: string,
  rootDir: string,
  dirName: string,
): string | null => {
  const resolvedDirPath = path.isAbsolute(dirPath)
    ? dirPath
    : path.resolve(rootDir, dirPath);

  if (
    !resolvedDirPath.startsWith(rootDir + path.sep) &&
    resolvedDirPath !== rootDir
  ) {
    if (process.stdout.isTTY) {
      console.error(
        `Error: ${dirName} path "${dirPath}" resolves to "${resolvedDirPath}", which is outside the project boundary "${rootDir}".`,
      );
    }
    return null;
  }

  if (!existsSync(resolvedDirPath)) {
    try {
      mkdirSync(resolvedDirPath, { recursive: true });
      if (process.stdout.isTTY) {
        console.log(`Created ${dirName} directory: ${resolvedDirPath}`);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (process.stdout.isTTY) {
        console.error(
          `Error creating ${dirName} directory at ${resolvedDirPath}: ${errorMessage}`,
        );
      }
      return null;
    }
  } else {
    try {
      const stats = statSync(resolvedDirPath);
      if (!stats.isDirectory()) {
        if (process.stdout.isTTY) {
          console.error(
            `Error: ${dirName} path ${resolvedDirPath} exists but is not a directory.`,
          );
        }
        return null;
      }
    } catch (statError: unknown) {
      if (process.stdout.isTTY) {
        const statErrorMessage =
          statError instanceof Error ? statError.message : String(statError);
        console.error(
          `Error accessing ${dirName} path ${resolvedDirPath}: ${statErrorMessage}`,
        );
      }
      return null;
    }
  }
  return resolvedDirPath;
};
// --- End Directory Ensurance Function ---

// --- Logs Directory Handling ---
let validatedLogsPath: string | null = ensureDirectory(
  env.LOGS_DIR,
  projectRoot,
  "logs",
);

if (!validatedLogsPath) {
  if (process.stdout.isTTY) {
    console.warn(
      `Warning: Custom logs directory ('${env.LOGS_DIR}') is invalid or outside the project boundary. Falling back to default.`,
    );
  }
  const defaultLogsDir = path.join(projectRoot, "logs");
  validatedLogsPath = ensureDirectory(defaultLogsDir, projectRoot, "logs");

  if (!validatedLogsPath) {
    if (process.stdout.isTTY) {
      console.warn(
        "Warning: Default logs directory could not be created. File logging will be disabled.",
      );
    }
  }
}
// --- End Logs Directory Handling ---

/**
 * Main application configuration object.
 * Aggregates settings from validated environment variables and `package.json`.
 */
export const config = {
  /** Information from package.json. */
  pkg,
  /** MCP server name. Env `MCP_SERVER_NAME` > `package.json` name > "git-mcp-server". */
  mcpServerName: env.MCP_SERVER_NAME || pkg.name,
  /** MCP server version. Env `MCP_SERVER_VERSION` > `package.json` version > "0.0.0". */
  mcpServerVersion: env.MCP_SERVER_VERSION || pkg.version,
  /** Logging level. From `MCP_LOG_LEVEL` env var. Default: "info". */
  logLevel: env.MCP_LOG_LEVEL,
  /** Absolute path to the logs directory. From `LOGS_DIR` env var. */
  logsPath: validatedLogsPath,
  /** Force console logging regardless of TTY status. From `MCP_FORCE_CONSOLE_LOGGING` env var. Default: false. */
  forceConsoleLogging: env.MCP_FORCE_CONSOLE_LOGGING,
  /** Runtime environment. From `NODE_ENV` env var. Default: "development". */
  environment: env.NODE_ENV,
  /** MCP transport type ('stdio' or 'http'). From `MCP_TRANSPORT_TYPE` env var. Default: "stdio". */
  mcpTransportType: env.MCP_TRANSPORT_TYPE,
  /** MCP session mode ('stateless', 'stateful', 'auto'). From `MCP_SESSION_MODE` env var. Default: "auto". */
  mcpSessionMode: env.MCP_SESSION_MODE,
  /** HTTP server port (if http transport). From `MCP_HTTP_PORT` env var. Default: 3010. */
  mcpHttpPort: env.MCP_HTTP_PORT,
  /** HTTP server host (if http transport). From `MCP_HTTP_HOST` env var. Default: "127.0.0.1". */
  mcpHttpHost: env.MCP_HTTP_HOST,
  /** MCP endpoint path for HTTP transport. From `MCP_HTTP_ENDPOINT_PATH`. Default: "/mcp". */
  mcpHttpEndpointPath: env.MCP_HTTP_ENDPOINT_PATH,
  /** Max retries for port binding. From `MCP_HTTP_MAX_PORT_RETRIES`. Default: 15. */
  mcpHttpMaxPortRetries: env.MCP_HTTP_MAX_PORT_RETRIES,
  /** Delay between port binding retries. From `MCP_HTTP_PORT_RETRY_DELAY_MS`. Default: 50. */
  mcpHttpPortRetryDelayMs: env.MCP_HTTP_PORT_RETRY_DELAY_MS,
  /** Timeout for stale stateful sessions. From `MCP_STATEFUL_SESSION_STALE_TIMEOUT_MS`. Default: 1800000. */
  mcpStatefulSessionStaleTimeoutMs: env.MCP_STATEFUL_SESSION_STALE_TIMEOUT_MS,
  /** Array of allowed CORS origins (http transport). From `MCP_ALLOWED_ORIGINS` (comma-separated). */
  mcpAllowedOrigins: env.MCP_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Auth secret key (JWTs, http transport). From `MCP_AUTH_SECRET_KEY`. CRITICAL. */
  mcpAuthSecretKey: env.MCP_AUTH_SECRET_KEY,
  /** The authentication mode ('jwt' or 'oauth'). From `MCP_AUTH_MODE`. */
  mcpAuthMode: env.MCP_AUTH_MODE,
  /** OAuth 2.1 Issuer URL. From `OAUTH_ISSUER_URL`. */
  oauthIssuerUrl: env.OAUTH_ISSUER_URL,
  /** OAuth 2.1 JWKS URI. From `OAUTH_JWKS_URI`. */
  oauthJwksUri: env.OAUTH_JWKS_URI,
  /** OAuth 2.1 Audience. From `OAUTH_AUDIENCE`. */
  oauthAudience: env.OAUTH_AUDIENCE,
  /** Development mode client ID. From `DEV_MCP_CLIENT_ID`. */
  devMcpClientId: env.DEV_MCP_CLIENT_ID,
  /** Development mode scopes. From `DEV_MCP_SCOPES`. */
  devMcpScopes: env.DEV_MCP_SCOPES?.split(",").map((s) => s.trim()),
  /** Flag to enable GPG signing for commits made by the git_commit tool. Requires server-side GPG setup. */
  gitSignCommits: env.GIT_SIGN_COMMITS,
  /** Security-related configurations. */
  security: {
    /** Indicates if authentication is required for server operations. */
    authRequired: env.MCP_AUTH_MODE !== "none",
  },
};

/**
 * Configured logging level for the application.
 * Exported for convenience.
 */
export const logLevel: string = config.logLevel;

/**
 * Configured runtime environment ("development", "production", etc.).
 * Exported for convenience.
 */
export const environment: string = config.environment;

/**
 * Force console logging flag.
 * Exported for convenience.
 */
export const forceConsoleLogging: boolean = config.forceConsoleLogging;

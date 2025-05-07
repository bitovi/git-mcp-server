import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
// Import utils from barrel (logger from ../utils/internal/logger.js)
import { logger } from '../../../utils/index.js';
// Import utils from barrel (RequestContext from ../utils/internal/requestContext.js)
import { BaseErrorCode, McpError } from '../../../types-global/errors.js'; // Keep direct import for types-global
import { RequestContext } from '../../../utils/index.js';
// Import utils from barrel (sanitization from ../utils/security/sanitization.js)
import { sanitization } from '../../../utils/index.js';

const execAsync = promisify(exec);

// Define the input schema for the git_pull tool using Zod
export const GitPullInputSchema = z.object({
  path: z.string().min(1).optional().default('.').describe("Path to the Git repository. Defaults to the directory set via `git_set_working_dir` for the session; set 'git_set_working_dir' if not set."),
  remote: z.string().optional().describe("The remote repository to pull from (e.g., 'origin'). Defaults to the tracked upstream or 'origin'."),
  branch: z.string().optional().describe("The remote branch to pull (e.g., 'main'). Defaults to the current branch's upstream."),
  rebase: z.boolean().optional().default(false).describe("Use 'git pull --rebase' instead of merge."),
  ffOnly: z.boolean().optional().default(false).describe("Use '--ff-only' to only allow fast-forward merges."),
  // Add other relevant git pull options as needed (e.g., --prune, --tags, --depth)
});

// Infer the TypeScript type from the Zod schema
export type GitPullInput = z.infer<typeof GitPullInputSchema>;

// Define the structure for the JSON output
export interface GitPullResult {
  success: boolean;
  message: string; // General status message (e.g., "Already up to date.", "Fast-forward", "Merge made by...")
  summary?: string; // More detailed summary if available (e.g., files changed, insertions/deletions)
  conflict?: boolean; // Flag if a merge conflict occurred
}

/**
 * Executes the 'git pull' command and returns structured JSON output.
 *
 * @param {GitPullInput} input - The validated input object.
 * @param {RequestContext} context - The request context for logging and error handling, including session info and working dir getter.
 * @returns {Promise<GitPullResult>} A promise that resolves with the structured pull result.
 * @throws {McpError} Throws an McpError if path resolution, validation, or the git command fails unexpectedly.
 */
export async function pullGitChanges(
  input: GitPullInput,
  context: RequestContext & { sessionId?: string; getWorkingDirectory: () => string | undefined }
): Promise<GitPullResult> {
  const operation = 'pullGitChanges';
  logger.debug(`Executing ${operation}`, { ...context, input });

  let targetPath: string;
  try {
    // Resolve the target path
    if (input.path && input.path !== '.') {
      targetPath = input.path;
      logger.debug(`Using provided path: ${targetPath}`, { ...context, operation });
    } else {
      const workingDir = context.getWorkingDirectory();
      if (!workingDir) {
        throw new McpError(BaseErrorCode.VALIDATION_ERROR, "No path provided and no working directory set for the session.", { context, operation });
      }
      targetPath = workingDir;
      logger.debug(`Using session working directory: ${targetPath}`, { ...context, operation, sessionId: context.sessionId });
    }
    // Sanitize the resolved path
    targetPath = sanitization.sanitizePath(targetPath, { allowAbsolute: true });
    logger.debug('Sanitized path', { ...context, operation, sanitizedPath: targetPath });

  } catch (error) {
    logger.error('Path resolution or sanitization failed', { ...context, operation, error });
    if (error instanceof McpError) throw error;
    throw new McpError(BaseErrorCode.VALIDATION_ERROR, `Invalid path: ${error instanceof Error ? error.message : String(error)}`, { context, operation, originalError: error });
  }

  try {
    // Construct the git pull command
    let command = `git -C "${targetPath}" pull`;

    if (input.rebase) {
      command += ' --rebase';
    }
    if (input.ffOnly) {
      command += ' --ff-only';
    }
    if (input.remote) {
      // Sanitize remote and branch names - basic alphanumeric + common chars
      const safeRemote = input.remote.replace(/[^a-zA-Z0-9_.\-/]/g, '');
      command += ` ${safeRemote}`;
      if (input.branch) {
        const safeBranch = input.branch.replace(/[^a-zA-Z0-9_.\-/]/g, '');
        command += ` ${safeBranch}`;
      }
    } else if (input.branch) {
      // If only branch is specified, assume 'origin' or tracked remote
      const safeBranch = input.branch.replace(/[^a-zA-Z0-9_.\-/]/g, '');
      command += ` origin ${safeBranch}`; // Defaulting to origin if remote not specified but branch is
      logger.warning(`Remote not specified, defaulting to 'origin' for branch pull`, { ...context, operation });
    }

    logger.debug(`Executing command: ${command}`, { ...context, operation });

    const { stdout, stderr } = await execAsync(command);

    logger.info(`Git pull stdout: ${stdout}`, { ...context, operation });
    if (stderr) {
      // Stderr might contain progress or non-error info, log as warning unless it indicates a clear failure handled below
      logger.warning(`Git pull stderr: ${stderr}`, { ...context, operation });
    }

    // Analyze stdout/stderr to determine the outcome
    let message = stdout.trim() || stderr.trim(); // Use stdout first, fallback to stderr for message
    let success = true;
    let conflict = false;
    let summary: string | undefined = undefined;

    if (message.includes('Already up to date')) {
      message = 'Already up to date.';
    } else if (message.includes('Fast-forward')) {
      message = 'Pull successful (fast-forward).';
      // Try to extract summary
      const summaryMatch = stdout.match(/(\d+ files? changed.*)/);
      if (summaryMatch) summary = summaryMatch[1];
    } else if (message.includes('Merge made by the') || message.includes('merging')) { // Covers recursive and octopus
      message = 'Pull successful (merge).';
      const summaryMatch = stdout.match(/(\d+ files? changed.*)/);
      if (summaryMatch) summary = summaryMatch[1];
    } else if (message.includes('Automatic merge failed; fix conflicts and then commit the result.')) {
      message = 'Pull resulted in merge conflicts.';
      success = false; // Indicate failure due to conflicts
      conflict = true;
    } else if (message.includes('fatal:')) {
        // If a fatal error wasn't caught by the execAsync catch block but is in stdout/stderr
        success = false;
        message = `Pull failed: ${message}`;
        logger.error(`Git pull command indicated failure: ${message}`, { ...context, operation, stdout, stderr });
    }
    // Add more specific checks based on git pull output variations if needed

    logger.info(`${operation} completed`, { ...context, operation, path: targetPath, success, message, conflict });
    return { success, message, summary, conflict };

  } catch (error: any) {
    logger.error(`Failed to execute git pull command`, { ...context, operation, path: targetPath, error: error.message, stderr: error.stderr, stdout: error.stdout });

    const errorMessage = error.stderr || error.stdout || error.message || ''; // Check stdout too for errors

    // Handle specific error cases
    if (errorMessage.toLowerCase().includes('not a git repository')) {
      throw new McpError(BaseErrorCode.NOT_FOUND, `Path is not a Git repository: ${targetPath}`, { context, operation, originalError: error });
    }
    if (errorMessage.includes('resolve host') || errorMessage.includes('Could not read from remote repository')) {
      throw new McpError(BaseErrorCode.SERVICE_UNAVAILABLE, `Failed to connect to remote repository. Error: ${errorMessage}`, { context, operation, originalError: error });
    }
    if (errorMessage.includes('merge conflict') || errorMessage.includes('fix conflicts')) {
       // This might be caught here if execAsync throws due to non-zero exit code during conflict
       logger.warning('Pull resulted in merge conflicts (caught as error)', { ...context, operation, path: targetPath, errorMessage });
       return { success: false, message: 'Pull resulted in merge conflicts.', conflict: true };
    }
     if (errorMessage.includes('You have unstaged changes') || errorMessage.includes('Your local changes to the following files would be overwritten by merge')) {
      throw new McpError(BaseErrorCode.CONFLICT, `Pull failed due to uncommitted local changes. Please commit or stash them first. Error: ${errorMessage}`, { context, operation, originalError: error });
    }
    if (errorMessage.includes('refusing to merge unrelated histories')) {
        throw new McpError(BaseErrorCode.VALIDATION_ERROR, `Pull failed: Refusing to merge unrelated histories. Use '--allow-unrelated-histories' if intended.`, { context, operation, originalError: error });
    }

    // Generic internal error for other failures
    throw new McpError(BaseErrorCode.INTERNAL_ERROR, `Failed to pull changes for path: ${targetPath}. Error: ${errorMessage}`, { context, operation, originalError: error });
  }
}

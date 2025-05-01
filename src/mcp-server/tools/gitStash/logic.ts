import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { BaseErrorCode, McpError } from '../../../types-global/errors.js'; // Direct import for types-global
import { logger, RequestContext, sanitization } from '../../../utils/index.js'; // logger (./utils/internal/logger.js), RequestContext (./utils/internal/requestContext.js), sanitization (./utils/security/sanitization.js)

const execAsync = promisify(exec);

// Define the BASE input schema for the git_stash tool using Zod
export const GitStashBaseSchema = z.object({
  path: z.string().min(1).optional().default('.').describe("Path to the local Git repository. If omitted, defaults to the path set by `git_set_working_dir` for the current session, or the server's CWD if no session path is set."),
  mode: z.enum(['list', 'apply', 'pop', 'drop', 'save']).describe("The stash operation to perform: 'list', 'apply', 'pop', 'drop', 'save'."),
  stashRef: z.string().optional().describe("Stash reference (e.g., 'stash@{1}'). Required for 'apply', 'pop', 'drop' modes."),
  message: z.string().optional().describe("Optional descriptive message used only for 'save' mode."),
  // includeUntracked: z.boolean().default(false).describe("Include untracked files in 'save' mode (-u)"), // Consider adding later
  // keepIndex: z.boolean().default(false).describe("Keep staged changes in 'save' mode (--keep-index)"), // Consider adding later
});

// Apply refinements and export the FINAL schema for validation within the handler
export const GitStashInputSchema = GitStashBaseSchema.refine(data => !(['apply', 'pop', 'drop'].includes(data.mode) && !data.stashRef), {
    message: "A 'stashRef' (e.g., 'stash@{0}') is required for 'apply', 'pop', and 'drop' modes.",
    path: ["stashRef"], // Point error to the stashRef field
});

// Infer the TypeScript type from the FINAL Zod schema
export type GitStashInput = z.infer<typeof GitStashInputSchema>;

// Define the structure for the result (using a discriminated union)
interface GitStashListResult {
  success: true;
  mode: 'list';
  stashes: { ref: string; branch: string; description: string }[];
}

interface GitStashApplyPopResult {
  success: true;
  mode: 'apply' | 'pop';
  message: string;
  conflicts: boolean; // Indicates if merge conflicts occurred
}

interface GitStashDropResult {
  success: true;
  mode: 'drop';
  message: string;
  stashRef: string;
}

interface GitStashSaveResult {
  success: true;
  mode: 'save';
  message: string;
  stashCreated: boolean; // Indicates if a stash was actually created (vs. no changes)
}

interface GitStashFailureResult {
    success: false;
    mode: GitStashInput['mode'];
    message: string;
    error?: string; // Optional detailed error message
    conflicts?: boolean; // Specifically for apply/pop failures due to conflicts
}

export type GitStashResult =
  | GitStashListResult
  | GitStashApplyPopResult
  | GitStashDropResult
  | GitStashSaveResult
  | GitStashFailureResult;


/**
 * Executes git stash commands based on the specified mode.
 *
 * @param {GitStashInput} input - The validated input object (validated against GitStashInputSchema).
 * @param {RequestContext} context - The request context for logging and error handling.
 * @returns {Promise<GitStashResult>} A promise that resolves with the structured result.
 * @throws {McpError} Throws an McpError for path resolution/validation failures or unexpected errors.
 */
export async function gitStashLogic(
  input: GitStashInput,
  context: RequestContext & { sessionId?: string; getWorkingDirectory: () => string | undefined }
): Promise<GitStashResult> {
  const operation = `gitStashLogic:${input.mode}`;
  logger.debug(`Executing ${operation}`, { ...context, input });

  let targetPath: string;
  try {
    // Resolve and sanitize the target path
    const workingDir = context.getWorkingDirectory();
    targetPath = (input.path && input.path !== '.')
      ? input.path
      : workingDir ?? '.';

    if (targetPath === '.' && !workingDir) {
         logger.warning("Executing git stash in server's CWD as no path provided and no session WD set.", { ...context, operation });
         targetPath = process.cwd();
    } else if (targetPath === '.' && workingDir) {
        targetPath = workingDir;
        logger.debug(`Using session working directory: ${targetPath}`, { ...context, operation, sessionId: context.sessionId });
    } else {
         logger.debug(`Using provided path: ${targetPath}`, { ...context, operation });
    }

    targetPath = sanitization.sanitizePath(targetPath);
    logger.debug('Sanitized path', { ...context, operation, sanitizedPath: targetPath });

  } catch (error) {
    logger.error('Path resolution or sanitization failed', { ...context, operation, error });
    if (error instanceof McpError) throw error;
    throw new McpError(BaseErrorCode.VALIDATION_ERROR, `Invalid path: ${error instanceof Error ? error.message : String(error)}`, { context, operation, originalError: error });
  }

  // Validate stashRef format if provided (simple validation)
  if (input.stashRef && !/^stash@\{[0-9]+\}$/.test(input.stashRef)) {
      throw new McpError(BaseErrorCode.VALIDATION_ERROR, `Invalid stash reference format: ${input.stashRef}. Expected format: stash@{n}`, { context, operation });
  }

  try {
    let command: string;
    let result: GitStashResult;

    switch (input.mode) {
      case 'list':
        command = `git -C "${targetPath}" stash list`;
        logger.debug(`Executing command: ${command}`, { ...context, operation });
        const { stdout: listStdout } = await execAsync(command);
        const stashes: GitStashListResult['stashes'] = listStdout.trim().split('\n')
          .filter(line => line)
          .map(line => {
            // Improved regex to handle different stash list formats
            const match = line.match(/^(stash@\{(\d+)\}):\s*(?:(?:WIP on|On)\s*([^:]+):\s*)?(.*)$/);
            return match
              ? { ref: match[1], branch: match[3] || 'unknown', description: match[4] }
              : { ref: 'unknown', branch: 'unknown', description: line }; // Fallback parsing
          });
        result = { success: true, mode: 'list', stashes };
        break;

      case 'apply':
      case 'pop':
        // stashRef is validated by Zod refine
        const stashRefApplyPop = input.stashRef!;
        command = `git -C "${targetPath}" stash ${input.mode} ${stashRefApplyPop}`;
        logger.debug(`Executing command: ${command}`, { ...context, operation });
        try {
            const { stdout, stderr } = await execAsync(command);
            // Check stdout/stderr for conflict messages, although exit code 0 usually means success
            const conflicts = /conflict/i.test(stdout) || /conflict/i.test(stderr);
            const message = conflicts
                ? `Stash ${input.mode} resulted in conflicts that need manual resolution.`
                : `Stash ${stashRefApplyPop} ${input.mode === 'apply' ? 'applied' : 'popped'} successfully.`;
            logger.info(message, { ...context, operation, path: targetPath, conflicts });
            result = { success: true, mode: input.mode, message, conflicts };
        } catch (applyError: any) {
            const applyErrorMessage = applyError.stderr || applyError.message || '';
            if (/conflict/i.test(applyErrorMessage)) {
                 logger.warning(`Stash ${input.mode} failed due to conflicts.`, { ...context, operation, path: targetPath, error: applyErrorMessage });
                 // Return failure but indicate conflicts
                 return { success: false, mode: input.mode, message: `Failed to ${input.mode} stash ${stashRefApplyPop} due to conflicts. Resolve conflicts manually.`, error: applyErrorMessage, conflicts: true };
            }
            // Rethrow other errors
            throw applyError;
        }
        break;

      case 'drop':
        // stashRef is validated by Zod refine
        const stashRefDrop = input.stashRef!;
        command = `git -C "${targetPath}" stash drop ${stashRefDrop}`;
        logger.debug(`Executing command: ${command}`, { ...context, operation });
        await execAsync(command);
        result = { success: true, mode: 'drop', message: `Dropped ${stashRefDrop} successfully.`, stashRef: stashRefDrop };
        break;

      case 'save':
        command = `git -C "${targetPath}" stash save`;
        if (input.message) {
          // Ensure message is properly quoted for the shell
          command += ` "${input.message.replace(/"/g, '\\"')}"`;
        }
        logger.debug(`Executing command: ${command}`, { ...context, operation });
        const { stdout: saveStdout } = await execAsync(command);
        const stashCreated = !/no local changes to save/i.test(saveStdout);
        const saveMessage = stashCreated
            ? `Changes stashed successfully.` + (input.message ? ` Message: "${input.message}"` : '')
            : "No local changes to save.";
        result = { success: true, mode: 'save', message: saveMessage, stashCreated };
        break;

      default:
        // Should not happen due to Zod validation
        throw new McpError(BaseErrorCode.VALIDATION_ERROR, `Invalid mode: ${input.mode}`, { context, operation });
    }

    logger.info(`${operation} executed successfully`, { ...context, operation, path: targetPath });
    return result;

  } catch (error: any) {
    const errorMessage = error.stderr || error.message || '';
    logger.error(`Failed to execute git stash command`, { ...context, operation, path: targetPath, error: errorMessage, stderr: error.stderr, stdout: error.stdout });

    // Specific error handling
    if (errorMessage.toLowerCase().includes('not a git repository')) {
      throw new McpError(BaseErrorCode.NOT_FOUND, `Path is not a Git repository: ${targetPath}`, { context, operation, originalError: error });
    }
    if ((input.mode === 'apply' || input.mode === 'pop' || input.mode === 'drop') && /no such stash/i.test(errorMessage)) {
       return { success: false, mode: input.mode, message: `Failed to ${input.mode} stash: Stash '${input.stashRef}' not found.`, error: errorMessage };
    }
     if ((input.mode === 'apply' || input.mode === 'pop') && /conflict/i.test(errorMessage)) {
        // This case might be caught above, but double-check here
       return { success: false, mode: input.mode, message: `Failed to ${input.mode} stash '${input.stashRef}' due to conflicts. Resolve conflicts manually.`, error: errorMessage, conflicts: true };
    }


    // Return structured failure for other git errors
    return {
        success: false,
        mode: input.mode,
        message: `Git stash ${input.mode} failed for path: ${targetPath}.`,
        error: errorMessage
    };
  }
}

/**
 * @module FileWalker
 * Recursively walks the repository directory tree, yielding file paths.
 */

export class FileWalker {
    /**
     * Walks a directory recursively, yielding file paths.
     * @param rootPath - The root directory to walk.
     * @param ignorePatterns - Patterns to ignore (e.g., from .gitignore).
     * @returns An async generator yielding file paths.
     */
    public async walk(_rootPath: string, _ignorePatterns: string[]): Promise<string[]> {
        // TODO: Implement file walking
        // 1. Read directory contents.
        // 2. Filter files and directories based on ignorePatterns (gitignore-aware).
        // 3. Yield file paths.
        // 4. Recursively walk subdirectories.
        throw new Error('Not implemented');
    }
}

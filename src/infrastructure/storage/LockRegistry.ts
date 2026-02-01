import { NotePath } from '../../core/model/NotePath.value';

export class LockRegistry {
	private lockedFiles = new Set<string>();
	private lockedFolders = new Set<string>();
	private passwordHashes = new Map<string, string>();

	addFile(filePath: NotePath, passwordHash?: string): void {
		this.lockedFiles.add(filePath.getValue());
		if (passwordHash) {
			this.passwordHashes.set(filePath.getValue(), passwordHash);
		}
	}

	removeFile(filePath: NotePath): void {
		this.lockedFiles.delete(filePath.getValue());
		this.passwordHashes.delete(filePath.getValue());
	}

	addFolder(folderPath: string): void {
		this.lockedFolders.add(folderPath);
	}

	removeFolder(folderPath: string): void {
		this.lockedFolders.delete(folderPath);
	}

	isFileLocked(filePath: NotePath): boolean {
		if (this.lockedFiles.has(filePath.getValue())) {
			return true;
		}

		const pathValue = filePath.getValue();
		const pathParts = pathValue.split('/');
		for (let i = 1; i < pathParts.length; i++) {
			const folderPath = pathParts.slice(0, i).join('/');
			if (this.lockedFolders.has(folderPath)) {
				return true;
			}
		}

		return false;
	}

	isFolderLocked(folderPath: string): boolean {
		return this.lockedFolders.has(folderPath);
	}

	getPasswordHash(filePath: NotePath): string | undefined {
		return this.passwordHashes.get(filePath.getValue());
	}

	getAllLockedFiles(): string[] {
		return Array.from(this.lockedFiles);
	}

	getAllLockedFolders(): string[] {
		return Array.from(this.lockedFolders);
	}

	/**
	 * Update the path of a locked file when it is moved or renamed.
	 * This preserves the lock status and password hash across path changes.
	 * @param oldPath - The previous file path
	 * @param newPath - The new file path
	 * @returns true if the file was tracked and updated, false otherwise
	 */
	updateFilePath(oldPath: string, newPath: string): boolean {
		if (!this.lockedFiles.has(oldPath)) {
			return false;
		}

		// Move the file entry from old path to new path
		this.lockedFiles.delete(oldPath);
		this.lockedFiles.add(newPath);

		// Move the password hash if it exists
		const passwordHash = this.passwordHashes.get(oldPath);
		if (passwordHash) {
			this.passwordHashes.delete(oldPath);
			this.passwordHashes.set(newPath, passwordHash);
		}

		return true;
	}

	/**
	 * Update the path of a locked folder when it is moved or renamed.
	 * This preserves the lock status across path changes.
	 * @param oldPath - The previous folder path
	 * @param newPath - The new folder path
	 * @returns true if the folder was tracked and updated, false otherwise
	 */
	updateFolderPath(oldPath: string, newPath: string): boolean {
		if (!this.lockedFolders.has(oldPath)) {
			return false;
		}

		// Move the folder entry from old path to new path
		this.lockedFolders.delete(oldPath);
		this.lockedFolders.add(newPath);

		return true;
	}

	/**
	 * Update all locked file paths that are children of a renamed folder.
	 * @param oldFolderPath - The previous folder path
	 * @param newFolderPath - The new folder path
	 * @returns Number of files updated
	 */
	updateChildFilePaths(oldFolderPath: string, newFolderPath: string): number {
		let updatedCount = 0;
		const oldPrefix = oldFolderPath + '/';
		const filesToUpdate: Array<{ oldPath: string; newPath: string }> = [];

		// Find all locked files that are children of the old folder path
		for (const filePath of this.lockedFiles) {
			if (filePath.startsWith(oldPrefix)) {
				const relativePath = filePath.substring(oldPrefix.length);
				const newFilePath = newFolderPath + '/' + relativePath;
				filesToUpdate.push({ oldPath: filePath, newPath: newFilePath });
			}
		}

		// Update each file path
		for (const { oldPath, newPath } of filesToUpdate) {
			this.lockedFiles.delete(oldPath);
			this.lockedFiles.add(newPath);

			const passwordHash = this.passwordHashes.get(oldPath);
			if (passwordHash) {
				this.passwordHashes.delete(oldPath);
				this.passwordHashes.set(newPath, passwordHash);
			}

			updatedCount++;
		}

		return updatedCount;
	}

	/**
	 * Update all locked folder paths that are children of a renamed folder.
	 * @param oldFolderPath - The previous folder path
	 * @param newFolderPath - The new folder path
	 * @returns Number of folders updated
	 */
	updateChildFolderPaths(oldFolderPath: string, newFolderPath: string): number {
		let updatedCount = 0;
		const oldPrefix = oldFolderPath + '/';
		const foldersToUpdate: Array<{ oldPath: string; newPath: string }> = [];

		// Find all locked folders that are children of the old folder path
		for (const folderPath of this.lockedFolders) {
			if (folderPath.startsWith(oldPrefix)) {
				const relativePath = folderPath.substring(oldPrefix.length);
				const newChildFolderPath = newFolderPath + '/' + relativePath;
				foldersToUpdate.push({ oldPath: folderPath, newPath: newChildFolderPath });
			}
		}

		// Update each folder path
		for (const { oldPath, newPath } of foldersToUpdate) {
			this.lockedFolders.delete(oldPath);
			this.lockedFolders.add(newPath);
			updatedCount++;
		}

		return updatedCount;
	}

	clear(): void {
		this.lockedFiles.clear();
		this.lockedFolders.clear();
		this.passwordHashes.clear();
	}

	loadFromData(data: { 
		lockedFiles?: string[]; 
		lockedFolders?: string[];
		passwordHashes?: Record<string, string>;
	}): void {
		if (data.lockedFiles) {
			this.lockedFiles = new Set(data.lockedFiles);
		}
		if (data.lockedFolders) {
			this.lockedFolders = new Set(data.lockedFolders);
		}
		if (data.passwordHashes) {
			this.passwordHashes = new Map(Object.entries(data.passwordHashes));
		}
	}

	toData(): {
		lockedFiles: string[];
		lockedFolders: string[];
		passwordHashes: Record<string, string>;
	} {
		return {
			lockedFiles: Array.from(this.lockedFiles),
			lockedFolders: Array.from(this.lockedFolders),
			passwordHashes: Object.fromEntries(this.passwordHashes)
		};
	}
}

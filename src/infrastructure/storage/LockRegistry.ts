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

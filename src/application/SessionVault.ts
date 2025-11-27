import { Password } from '../core/model/Password.value';

interface PasswordEntry {
	password: Password;
	timestamp: number;
}

export class SessionVault {
	private readonly cache = new Map<string, PasswordEntry>();
	private rootPassword: Password | null = null;
	private timeoutHandle: number | null = null;

	constructor(
		private readonly timeoutMinutes: number,
		private readonly onTimeout?: () => void
	) {}

	storeFilePassword(filePath: string, password: Password): void {
		this.cache.set(filePath, {
			password,
			timestamp: Date.now()
		});
		this.resetTimeout();
	}

	getFilePassword(filePath: string): Password | null {
		const entry = this.cache.get(filePath);
		if (!entry) return null;

		if (this.isExpired(entry.timestamp)) {
			this.cache.delete(filePath);
			return null;
		}

		return entry.password;
	}

	storeRootPassword(password: Password): void {
		this.rootPassword = password;
		this.resetTimeout();
	}

	getRootPassword(): Password | null {
		return this.rootPassword;
	}

	clear(): void {
		this.cache.clear();
		this.rootPassword = null;
		this.clearTimeout();
	}

	clearFile(filePath: string): void {
		this.cache.delete(filePath);
	}

	private isExpired(timestamp: number): boolean {
		if (this.timeoutMinutes <= 0) return false;
		const now = Date.now();
		const elapsed = now - timestamp;
		return elapsed > this.timeoutMinutes * 60 * 1000;
	}

	private resetTimeout(): void {
		if (this.timeoutMinutes <= 0) return;

		this.clearTimeout();

		this.timeoutHandle = window.setTimeout(() => {
			this.clear();
			if (this.onTimeout) {
				this.onTimeout();
			}
		}, this.timeoutMinutes * 60 * 1000);
	}

	private clearTimeout(): void {
		if (this.timeoutHandle !== null) {
			window.clearTimeout(this.timeoutHandle);
			this.timeoutHandle = null;
		}
	}
}

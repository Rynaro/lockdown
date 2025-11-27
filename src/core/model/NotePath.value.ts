export class NotePath {
	private constructor(private readonly path: string) {}

	static create(path: string): NotePath {
		return new NotePath(path);
	}

	getValue(): string {
		return this.path;
	}

	getFileName(): string {
		return this.path.split('/').pop() || this.path;
	}

	getFolderPath(): string | null {
		const lastSlash = this.path.lastIndexOf('/');
		if (lastSlash === -1) return null;
		return this.path.substring(0, lastSlash);
	}

	toAdditionalData(): Uint8Array {
		const encoder = new TextEncoder();
		return encoder.encode(this.path);
	}

	equals(other: NotePath): boolean {
		return this.path === other.path;
	}
}

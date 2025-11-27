export class Plaintext {
	private constructor(private readonly content: string) {}

	static create(content: string): Plaintext {
		return new Plaintext(content);
	}

	getValue(): string {
		return this.content;
	}

	toBytes(): Uint8Array {
		const encoder = new TextEncoder();
		return encoder.encode(this.content);
	}

	isEmpty(): boolean {
		return this.content.trim().length === 0;
	}
}

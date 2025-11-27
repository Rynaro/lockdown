import { ValidationError } from '../errors/DomainErrors';

export class Password {
	private constructor(private readonly value: string) {}

	static create(value: string): Password {
		if (!value || value.length === 0) {
			throw new ValidationError('Password cannot be empty');
		}
		return new Password(value);
	}

	getValue(): string {
		return this.value;
	}

	async hash(): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(this.value);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	matches(hash: string): Promise<boolean> {
		return this.hash().then(h => h === hash);
	}
}

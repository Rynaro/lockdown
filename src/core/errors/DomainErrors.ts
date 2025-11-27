export class WrongPasswordError extends Error {
	constructor(message: string = 'Incorrect password or corrupted data') {
		super(message);
		this.name = 'WrongPasswordError';
	}
}

export class EncryptionError extends Error {
	constructor(message: string) {
		super(`Encryption failed: ${message}`);
		this.name = 'EncryptionError';
	}
}

export class DecryptionError extends Error {
	constructor(message: string) {
		super(`Decryption failed: ${message}`);
		this.name = 'DecryptionError';
	}
}

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

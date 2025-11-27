import { IKeyDeriver } from './IKeyDeriver';

export class Pbkdf2KeyDeriver implements IKeyDeriver {
	constructor(
		private readonly iterations: number = 1_000_000,
		private readonly hashAlgorithm: string = 'SHA-512'
	) {}

	async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
		const encoder = new TextEncoder();
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			encoder.encode(password),
			'PBKDF2',
			false,
			['deriveBits', 'deriveKey']
		);

		return crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt: salt,
				iterations: this.iterations,
				hash: this.hashAlgorithm
			},
			keyMaterial,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);
	}
}

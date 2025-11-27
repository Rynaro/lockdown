import { IAeadEncryptor } from './IAeadEncryptor';
import { WrongPasswordError } from '../errors/DomainErrors';

export class AesGcmEncryptor implements IAeadEncryptor {
	async encrypt(
		plaintext: Uint8Array,
		key: CryptoKey,
		iv: Uint8Array,
		additionalData: Uint8Array
	): Promise<Uint8Array> {
		const encrypted = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: iv, additionalData: additionalData },
			key,
			plaintext
		);

		return new Uint8Array(encrypted);
	}

	async decrypt(
		ciphertextAndTag: Uint8Array,
		key: CryptoKey,
		iv: Uint8Array,
		additionalData: Uint8Array
	): Promise<Uint8Array> {
		try {
			const decrypted = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: iv, additionalData: additionalData },
				key,
				ciphertextAndTag
			);

			return new Uint8Array(decrypted);
		} catch (error: unknown) {
			if (error instanceof Error && 
				(error.name === 'OperationError' || error.name === 'InvalidAccessError')) {
				throw new WrongPasswordError();
			}
			throw error;
		}
	}
}

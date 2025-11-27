import { IKeyDeriver } from './IKeyDeriver';
import { IAeadEncryptor } from './IAeadEncryptor';
import { Plaintext } from '../model/Plaintext.value';
import { Password } from '../model/Password.value';
import { NotePath } from '../model/NotePath.value';
import { EncryptedBlob } from '../model/EncryptedBlob.value';
import { EncryptionError, DecryptionError, ValidationError } from '../errors/DomainErrors';

export class EncryptionService {
	constructor(
		private readonly keyDeriver: IKeyDeriver,
		private readonly encryptor: IAeadEncryptor
	) {}

	async encrypt(
		plaintext: Plaintext,
		password: Password,
		notePath: NotePath
	): Promise<EncryptedBlob> {
		try {
			const plaintextBytes = plaintext.toBytes();
			const salt = crypto.getRandomValues(new Uint8Array(16));
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const key = await this.keyDeriver.deriveKey(password.getValue(), salt);
			const additionalData = notePath.toAdditionalData();

			const ciphertext = await this.encryptor.encrypt(
				plaintextBytes,
				key,
				iv,
				additionalData
			);

			const combined = new Uint8Array(salt.length + iv.length + ciphertext.length);
			combined.set(salt);
			combined.set(iv, salt.length);
			combined.set(ciphertext, salt.length + iv.length);

			const base64 = this.arrayBufferToBase64(combined);
			return EncryptedBlob.create(base64);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			throw new EncryptionError(message);
		}
	}

	async decrypt(
		encrypted: EncryptedBlob,
		password: Password,
		notePath: NotePath
	): Promise<Plaintext> {
		try {
			const base64 = encrypted.extractBase64();
			const combined = this.base64ToArrayBuffer(base64);

			if (combined.byteLength < 28) {
				throw new ValidationError('Data too short to contain salt and IV');
			}

			const salt = combined.slice(0, 16);
			const iv = combined.slice(16, 28);
			const ciphertext = combined.slice(28);

			const key = await this.keyDeriver.deriveKey(password.getValue(), salt);
			const additionalData = notePath.toAdditionalData();

			const decrypted = await this.encryptor.decrypt(
				ciphertext,
				key,
				iv,
				additionalData
			);

			const decoder = new TextDecoder();
			const decryptedText = decoder.decode(decrypted);

			if (decryptedText.includes(EncryptedBlob.getMarker())) {
				throw new ValidationError('Decryption result contains encryption marker');
			}

			return Plaintext.create(decryptedText);
		} catch (error) {
			if (error instanceof ValidationError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error';
			throw new DecryptionError(message);
		}
	}

	private arrayBufferToBase64(buffer: Uint8Array): string {
		let binary = '';
		const len = buffer.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(buffer[i]);
		}
		return window.btoa(binary);
	}

	private base64ToArrayBuffer(base64: string): Uint8Array {
		const binary_string = window.atob(base64);
		const len = binary_string.length;
		const bytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) {
			bytes[i] = binary_string.charCodeAt(i);
		}
		return bytes;
	}
}

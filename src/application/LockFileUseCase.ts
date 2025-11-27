import { EncryptionService } from '../core/crypto/EncryptionService';
import { Plaintext } from '../core/model/Plaintext.value';
import { Password } from '../core/model/Password.value';
import { NotePath } from '../core/model/NotePath.value';

export class LockFileUseCase {
	constructor(private readonly encryptionService: EncryptionService) {}

	async execute(
		content: string,
		password: string,
		filePath: string
	): Promise<string> {
		const plaintext = Plaintext.create(content);
		const pwd = Password.create(password);
		const notePath = NotePath.create(filePath);

		const encrypted = await this.encryptionService.encrypt(plaintext, pwd, notePath);

		const verification = await this.encryptionService.decrypt(encrypted, pwd, notePath);
		if (verification.getValue() !== content) {
			throw new Error('Encryption verification failed');
		}

		return encrypted.getValue();
	}
}

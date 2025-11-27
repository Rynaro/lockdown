import { EncryptionService } from '../core/crypto/EncryptionService';
import { Password } from '../core/model/Password.value';
import { NotePath } from '../core/model/NotePath.value';
import { EncryptedBlob } from '../core/model/EncryptedBlob.value';

export class UnlockFileUseCase {
	constructor(private readonly encryptionService: EncryptionService) {}

	async execute(
		encryptedContent: string,
		password: string,
		filePath: string
	): Promise<string> {
		const encrypted = EncryptedBlob.fromRaw(encryptedContent);
		const pwd = Password.create(password);
		const notePath = NotePath.create(filePath);

		const decrypted = await this.encryptionService.decrypt(encrypted, pwd, notePath);
		return decrypted.getValue();
	}
}

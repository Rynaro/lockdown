export interface IAeadEncryptor {
	encrypt(
		plaintext: Uint8Array,
		key: CryptoKey,
		iv: Uint8Array,
		additionalData: Uint8Array
	): Promise<Uint8Array>;

	decrypt(
		ciphertextAndTag: Uint8Array,
		key: CryptoKey,
		iv: Uint8Array,
		additionalData: Uint8Array
	): Promise<Uint8Array>;
}

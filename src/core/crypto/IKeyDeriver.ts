export interface IKeyDeriver {
	deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
}

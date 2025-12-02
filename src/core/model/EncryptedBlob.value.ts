import { ValidationError } from '../errors/DomainErrors';

const ENCRYPTION_MARKER = '<!-- LOCKDOWN_ENCRYPTED -->';
const ENCRYPTION_HEADER = `${ENCRYPTION_MARKER}\n`;

export class EncryptedBlob {
	private constructor(private readonly data: string) {}

	static create(base64Data: string): EncryptedBlob {
		const fullData = `${ENCRYPTION_HEADER}${base64Data}`;
		return new EncryptedBlob(fullData);
	}

	static fromRaw(rawData: string): EncryptedBlob {
		if (!rawData.includes(ENCRYPTION_MARKER)) {
			throw new ValidationError('Data is not encrypted');
		}
		return new EncryptedBlob(rawData);
	}

	getValue(): string {
		return this.data;
	}

	extractBase64(): string {
		let base64 = this.data;

		if (base64.startsWith(ENCRYPTION_HEADER)) {
			base64 = base64.substring(ENCRYPTION_HEADER.length).trim();
		} else if (base64.includes(ENCRYPTION_MARKER)) {
			const markerIndex = base64.indexOf(ENCRYPTION_MARKER);
			base64 = base64.substring(markerIndex + ENCRYPTION_MARKER.length).trim();

			const nextMarkerIndex = base64.indexOf(ENCRYPTION_MARKER);
			if (nextMarkerIndex !== -1) {
				base64 = base64.substring(0, nextMarkerIndex).trim();
			}
		}

		base64 = base64.trim().replace(/\s+/g, '');

		const doublePaddingPattern = /==([A-Za-z0-9+/])/g;
		let doubleMatch;
		let lastMatchIndex = -1;

		while ((doubleMatch = doublePaddingPattern.exec(base64)) !== null) {
			if (lastMatchIndex === -1) {
				lastMatchIndex = doubleMatch.index;
			}
		}

		if (lastMatchIndex !== -1) {
			base64 = base64.substring(0, lastMatchIndex + 2);
		} else {
			const singlePaddingPattern = /([A-Za-z0-9+/])=([A-Za-z0-9+/])/;
			const singleMatch = base64.match(singlePaddingPattern);

			if (singleMatch && singleMatch.index !== undefined) {
				base64 = base64.substring(0, singleMatch.index + 2);
			} else if (base64.length > 300) {
				const estimatedBlockSize = Math.floor(base64.length / 3);
				const searchStart = Math.max(0, estimatedBlockSize - 50);
				const searchEnd = Math.min(base64.length, estimatedBlockSize + 50);
				const searchRegion = base64.substring(searchStart, searchEnd);
				const paddingIndex = searchRegion.indexOf('=');

				if (paddingIndex !== -1) {
					const actualIndex = searchStart + paddingIndex;
					if (actualIndex + 1 < base64.length && /[A-Za-z0-9+/]/.test(base64[actualIndex + 1])) {
						base64 = base64.substring(0, actualIndex + 1);
					}
				}
			}
		}

		if (!base64) {
			throw new ValidationError('No base64 data found');
		}

		if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
			throw new ValidationError('Invalid base64 format: contains invalid characters');
		}

		return base64;
	}

	isEncrypted(): boolean {
		return this.data.includes(ENCRYPTION_MARKER);
	}

	static getMarker(): string {
		return ENCRYPTION_MARKER;
	}

	static getHeader(): string {
		return ENCRYPTION_HEADER;
	}
}

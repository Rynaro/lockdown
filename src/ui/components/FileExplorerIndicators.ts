export class FileExplorerIndicators {
	private indicators = new Map<string, HTMLElement>();

	updateAll(
		lockedFiles: Set<string>,
		lockedFolders: Set<string>,
		lockIcon: string,
		isFileEncrypted: (path: string) => boolean
	): void {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const fileExplorer = document.querySelector('.nav-files-container');
				if (!fileExplorer) return;

			const existingFileIndicators = Array.from(document.querySelectorAll('.ld-file-explorer-indicator:not(.ld-file-explorer-indicator--folder)'));
			const existingFolderIndicators = Array.from(document.querySelectorAll('.ld-file-explorer-indicator--folder'));

				existingFileIndicators.forEach(indicator => {
					const fileItem = indicator.closest('[data-path]') as HTMLElement;
					if (fileItem) {
						const filePath = fileItem.getAttribute('data-path');
						if (filePath && !lockedFiles.has(filePath)) {
							setTimeout(() => indicator.parentNode && indicator.remove(), 0);
						}
					}
				});

				existingFolderIndicators.forEach(indicator => {
					const folderItem = indicator.closest('[data-path]') as HTMLElement;
					if (folderItem) {
						const folderPath = folderItem.getAttribute('data-path');
						if (folderPath && !lockedFolders.has(folderPath)) {
							setTimeout(() => indicator.parentNode && indicator.remove(), 0);
						}
					}
				});

				setTimeout(() => {
				lockedFiles.forEach(filePath => {
					const exists = document.querySelector(`[data-path="${filePath}"] .ld-file-explorer-indicator`);
					if (!exists) {
							this.addFileIndicator(filePath, lockIcon, isFileEncrypted(filePath));
						}
					});

				lockedFolders.forEach(folderPath => {
					const exists = document.querySelector(`[data-path="${folderPath}"] .ld-file-explorer-indicator--folder`);
					if (!exists) {
							this.addFolderIndicator(folderPath, lockIcon);
						}
					});
				}, 50);
			});
		});
	}

	private addFileIndicator(filePath: string, lockIcon: string, isEncrypted: boolean): void {
		const selectors = [
			'.nav-file-title[data-path]',
			'.nav-file-title-content',
			'.tree-item-inner[data-path]',
			'.nav-file-title'
		];

		for (const selector of selectors) {
			const fileItems = document.querySelectorAll(selector);

			for (const item of Array.from(fileItems)) {
				const titleEl = item as HTMLElement;
				const fileTitle = titleEl.getAttribute('data-path') ||
					titleEl.textContent?.trim() ||
					titleEl.closest('[data-path]')?.getAttribute('data-path');

			if (fileTitle === filePath) {
				if (titleEl.querySelector('.ld-file-explorer-indicator') ||
					titleEl.parentElement?.querySelector('.ld-file-explorer-indicator')) {
					return;
				}

					const indicator = document.createElement('span');
					indicator.className = 'ld-file-explorer-indicator';
					indicator.textContent = lockIcon || '🔒';
					indicator.title = isEncrypted ? 'Locked and encrypted file' : 'Locked file';
					indicator.style.marginLeft = '4px';
					indicator.style.opacity = isEncrypted ? '1' : '0.7';
					indicator.style.background = 'transparent';
					indicator.style.backgroundColor = 'transparent';
					indicator.style.pointerEvents = 'none';

					requestAnimationFrame(() => {
					const targetEl = titleEl.querySelector('.nav-file-title-content') || titleEl;
					if (targetEl && !targetEl.querySelector('.ld-file-explorer-indicator')) {
						targetEl.appendChild(indicator);
							this.indicators.set(filePath, indicator);
						}
					});
					return;
				}
			}
		}
	}

	private addFolderIndicator(folderPath: string, lockIcon: string): void {
		const selectors = [
			'.nav-folder-title[data-path]',
			'.nav-folder-title',
			'.tree-item-inner[data-path]'
		];

		for (const selector of selectors) {
			const folderItems = document.querySelectorAll(selector);

			for (const item of Array.from(folderItems)) {
				const titleEl = item as HTMLElement;
				const folderTitle = titleEl.getAttribute('data-path') ||
					titleEl.textContent?.trim() ||
					titleEl.closest('[data-path]')?.getAttribute('data-path');

			if (folderTitle === folderPath) {
				if (titleEl.querySelector('.ld-file-explorer-indicator--folder') ||
					titleEl.parentElement?.querySelector('.ld-file-explorer-indicator--folder')) {
					return;
				}

					const indicator = document.createElement('span');
					indicator.className = 'ld-file-explorer-indicator ld-file-explorer-indicator--folder';
					indicator.textContent = lockIcon || '🔒';
					indicator.title = 'Locked folder';
					indicator.style.marginLeft = '4px';
					indicator.style.opacity = '0.8';
					indicator.style.background = 'transparent';
					indicator.style.backgroundColor = 'transparent';
					indicator.style.pointerEvents = 'none';

					requestAnimationFrame(() => {
					const targetEl = titleEl.querySelector('.nav-folder-title-content') || titleEl;
					if (targetEl && !targetEl.querySelector('.ld-file-explorer-indicator--folder')) {
						targetEl.appendChild(indicator);
						}
					});
					break;
				}
			}
		}
	}

	removeAll(): void {
		requestAnimationFrame(() => {
			this.indicators.forEach((indicator) => {
				if (indicator && indicator.parentNode) {
					indicator.remove();
				}
			});
			this.indicators.clear();

		const orphanedIndicators = document.querySelectorAll('.ld-file-explorer-indicator');
		orphanedIndicators.forEach(el => el.parentNode && el.remove());
		});
	}
}

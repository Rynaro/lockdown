export class LockOverlay {
	private overlays = new Map<string, HTMLElement>();

	show(
		filePath: string,
		container: HTMLElement,
		lockIcon: string,
		onUnlock: () => Promise<void>
	): void {
		this.remove(filePath);

		if (container) {
			const computedStyle = getComputedStyle(container);
			if (computedStyle.position === 'static') {
				container.style.position = 'relative';
			}
			container.style.isolation = 'isolate';
			container.style.willChange = 'auto';
		}

		const overlay = document.createElement('div');
		overlay.className = 'lockdown-overlay';
		overlay.setAttribute('data-file-path', filePath);

		const lockIconEl = document.createElement('div');
		lockIconEl.className = 'lockdown-overlay-icon';
		lockIconEl.textContent = lockIcon || '🔒';

		const message = document.createElement('div');
		message.className = 'lockdown-overlay-message';
		message.textContent = 'This note is locked';

		const unlockButton = document.createElement('button');
		unlockButton.className = 'lockdown-overlay-button';
		unlockButton.textContent = 'Unlock';
		unlockButton.onclick = async () => {
			await onUnlock();
		};

		overlay.appendChild(lockIconEl);
		overlay.appendChild(message);
		overlay.appendChild(unlockButton);

		container.appendChild(overlay);
		this.overlays.set(filePath, overlay);
	}

	remove(filePath: string): void {
		const overlay = this.overlays.get(filePath);
		if (overlay) {
			const container = overlay.parentElement;
			if (container) {
				if (container.style.isolation === 'isolate') {
					container.style.isolation = '';
				}
			}
			overlay.remove();
			this.overlays.delete(filePath);
		}

		const orphanedOverlays = document.querySelectorAll(`.lockdown-overlay[data-file-path="${filePath}"]`);
		orphanedOverlays.forEach(el => {
			const container = el.parentElement;
			if (container && container.style.isolation === 'isolate') {
				container.style.isolation = '';
			}
			el.remove();
		});
	}

	removeAll(): void {
		this.overlays.forEach((overlay) => {
			const container = overlay.parentElement;
			if (container && container.style.isolation === 'isolate') {
				container.style.isolation = '';
			}
			overlay.remove();
		});
		this.overlays.clear();

		const allOverlays = document.querySelectorAll('.lockdown-overlay');
		allOverlays.forEach(el => {
			const container = el.parentElement;
			if (container && container.style.isolation === 'isolate') {
				container.style.isolation = '';
			}
			el.remove();
		});
	}

	has(filePath: string): boolean {
		return this.overlays.has(filePath);
	}
}

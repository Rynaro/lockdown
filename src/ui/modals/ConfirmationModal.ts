import { App, Modal } from 'obsidian';

export class ConfirmationModal extends Modal {
	private resolver: (value: boolean) => void;

	constructor(
		app: App,
		private readonly message: string
	) {
		super(app);
	}

	confirm(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.contentEl.addClass('ld-modal');

		const titleContainer = this.contentEl.createDiv({ cls: 'ld-modal__title-container' });
		titleContainer.createSpan({ text: '🔒', cls: 'ld-modal__icon' });
		titleContainer.createEl('h2', { text: 'Lockdown', cls: 'ld-modal__title' });

		this.contentEl.createEl('p', { text: this.message, cls: 'ld-modal__message' });

		this.contentEl.createDiv({ cls: 'ld-modal__button-container' }, (container) => {
			const cancelBtn = container.createEl('button', {
				text: 'Cancel',
				cls: 'ld-button ld-button--secondary'
			});
			cancelBtn.onClickEvent(() => {
				this.resolver(false);
				this.close();
			});

			const confirmBtn = container.createEl('button', {
				text: 'Confirm',
				cls: 'ld-button ld-button--primary'
			});
			confirmBtn.onClickEvent(() => {
				this.resolver(true);
				this.close();
			});
		});
	}
}

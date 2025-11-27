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
		this.contentEl.addClass('lockdown-modal');

		const titleContainer = this.contentEl.createDiv({ cls: 'lockdown-modal-title-container' });
		titleContainer.createSpan({ text: '🔒', cls: 'lockdown-modal-icon' });
		titleContainer.createEl('h2', { text: 'Lockdown', cls: 'lockdown-modal-title' });

		this.contentEl.createEl('p', { text: this.message, cls: 'lockdown-modal-message' });

		this.contentEl.createDiv({ cls: 'lockdown-modal-button-container' }, (container) => {
			const cancelBtn = container.createEl('button', {
				text: 'Cancel',
				cls: 'lockdown-modal-button lockdown-modal-button-secondary'
			});
			cancelBtn.onClickEvent(() => {
				this.resolver(false);
				this.close();
			});

			const confirmBtn = container.createEl('button', {
				text: 'Confirm',
				cls: 'lockdown-modal-button lockdown-modal-button-primary'
			});
			confirmBtn.onClickEvent(() => {
				this.resolver(true);
				this.close();
			});
		});
	}
}

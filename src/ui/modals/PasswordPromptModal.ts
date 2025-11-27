import { App, Modal } from 'obsidian';
import { PasswordStrength, PasswordStrengthCalculator } from '../../application/PasswordStrengthCalculator';

export class PasswordPromptModal extends Modal {
	private passwordInput: HTMLInputElement;
	private confirmInput: HTMLInputElement | null = null;
	private confirmBtn: HTMLButtonElement;
	private strengthMeter: HTMLElement | null = null;
	private strengthText: HTMLElement | null = null;
	private strengthCalculator: PasswordStrengthCalculator;
	private resolver: (value: string | undefined) => void;

	constructor(
		app: App,
		private readonly message: string,
		private readonly isNewPassword: boolean,
		strengthCalculator: PasswordStrengthCalculator
	) {
		super(app);
		this.strengthCalculator = strengthCalculator;
	}

	prompt(): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.contentEl.addClass('ld-modal', 'ld-modal--password');

		const titleContainer = this.contentEl.createDiv({ cls: 'ld-modal__title-container' });
		titleContainer.createSpan({ text: '🔐', cls: 'ld-modal__icon' });
		titleContainer.createEl('h2', { text: 'Password Required', cls: 'ld-modal__title' });

		this.contentEl.createEl('p', { text: this.message, cls: 'ld-modal__message' });

		const passwordContainer = this.contentEl.createDiv({ cls: 'ld-input-container' });
		passwordContainer.createEl('label', {
			text: 'Password',
			attr: { for: 'lockdown-password' },
			cls: 'ld-input__label'
		});
		this.passwordInput = passwordContainer.createEl('input', {
			type: 'password',
			attr: { id: 'lockdown-password', placeholder: 'Enter your password' },
			cls: 'ld-input ld-input--password'
		});

		if (this.isNewPassword) {
			const strengthContainer = passwordContainer.createDiv({ cls: 'ld-password-strength' });
			const strengthBarContainer = strengthContainer.createDiv({ cls: 'ld-password-strength__bar-container' });
			this.strengthMeter = strengthBarContainer.createDiv({ cls: 'ld-password-strength__meter' });
			this.strengthText = strengthContainer.createDiv({ cls: 'ld-password-strength__text' });

			this.passwordInput.oninput = () => {
				const password = this.passwordInput.value;
				const strength = this.strengthCalculator.calculate(password);
				this.updateStrengthIndicator(strength);
			};
		}

		if (this.isNewPassword) {
			const confirmContainer = this.contentEl.createDiv({ cls: 'ld-input-container' });
			confirmContainer.createEl('label', {
				text: 'Confirm Password',
				attr: { for: 'lockdown-confirm' },
				cls: 'ld-input__label'
			});
			this.confirmInput = confirmContainer.createEl('input', {
				type: 'password',
				attr: { id: 'lockdown-confirm', placeholder: 'Re-enter your password' },
				cls: 'ld-input ld-input--password'
			});
		}

		this.contentEl.createDiv({ cls: 'ld-modal__button-container' }, (container) => {
			const cancelBtn = container.createEl('button', {
				text: 'Cancel',
				cls: 'ld-button ld-button--secondary'
			});
			cancelBtn.onClickEvent(() => {
				this.resolver(undefined);
				this.close();
			});

			this.confirmBtn = container.createEl('button', {
				text: 'Confirm',
				cls: 'ld-button ld-button--primary'
			});
			this.confirmBtn.onClickEvent(() => this.handleConfirm());
		});

		this.passwordInput.focus();
		this.passwordInput.onkeydown = (e) => {
			if (e.key === 'Enter') {
				if (this.isNewPassword && this.confirmInput) {
					this.confirmInput.focus();
				} else {
					this.confirmBtn.click();
				}
			}
		};
		if (this.confirmInput) {
			this.confirmInput.onkeydown = (e) => {
				if (e.key === 'Enter') {
					this.confirmBtn.click();
				}
			};
		}
	}

	private handleConfirm(): void {
		const password = this.passwordInput.value;
		if (!password) {
			return;
		}
		if (this.isNewPassword && this.confirmInput && password !== this.confirmInput.value) {
			return;
		}
		this.resolver(password);
		this.close();
	}

	private updateStrengthIndicator(strength: PasswordStrength): void {
		if (!this.strengthMeter || !this.strengthText) return;

		this.strengthMeter.style.width = `${strength.score}%`;

		this.strengthMeter.className = 'ld-password-strength__meter';
		if (strength.score < 30) {
			this.strengthMeter.classList.add('ld-password-strength__meter--weak');
		} else if (strength.score < 60) {
			this.strengthMeter.classList.add('ld-password-strength__meter--fair');
		} else if (strength.score < 80) {
			this.strengthMeter.classList.add('ld-password-strength__meter--good');
		} else {
			this.strengthMeter.classList.add('ld-password-strength__meter--strong');
		}

		this.strengthText.textContent = strength.feedback;
		this.strengthText.className = 'ld-password-strength__text';
		if (strength.score < 30) {
			this.strengthText.classList.add('ld-password-strength__text--weak');
		} else if (strength.score < 60) {
			this.strengthText.classList.add('ld-password-strength__text--fair');
		} else if (strength.score < 80) {
			this.strengthText.classList.add('ld-password-strength__text--good');
		} else {
			this.strengthText.classList.add('ld-password-strength__text--strong');
		}
	}
}

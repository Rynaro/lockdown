import { Plugin, PluginSettingTab, Setting, TFile, TFolder, Notice, MarkdownView, Modal, App } from 'obsidian';
import { EditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { EditorState } from '@codemirror/state';

import { Pbkdf2KeyDeriver } from './src/core/crypto/Pbkdf2KeyDeriver';
import { AesGcmEncryptor } from './src/core/crypto/AesGcmEncryptor';
import { EncryptionService } from './src/core/crypto/EncryptionService';
import { LockFileUseCase } from './src/application/LockFileUseCase';
import { UnlockFileUseCase } from './src/application/UnlockFileUseCase';
import { SessionVault } from './src/application/SessionVault';
import { PasswordStrengthCalculator } from './src/application/PasswordStrengthCalculator';
import { LockRegistry } from './src/infrastructure/storage/LockRegistry';
import { LockOverlay } from './src/ui/components/LockOverlay';
import { FileExplorerIndicators } from './src/ui/components/FileExplorerIndicators';
import { PasswordPromptModal } from './src/ui/modals/PasswordPromptModal';
import { ConfirmationModal } from './src/ui/modals/ConfirmationModal';
import { Password } from './src/core/model/Password.value';

interface LockdownSettings {
	lockIcon: string;
	showStatusBar: boolean;
	requireConfirmation: boolean;
	lockOnClose: boolean;
	useEncryption: boolean;
	rootPasswordHash?: string; // Hash of the root password (for verification only)
	showFileExplorerIndicators: boolean;
	sessionTimeoutMinutes: number;
	enableBackup: boolean;
	backupLocation?: string;
}

const DEFAULT_SETTINGS: LockdownSettings = {
	lockIcon: '🔒',
	showStatusBar: true,
	requireConfirmation: false,
	lockOnClose: false,
	useEncryption: true,
	showFileExplorerIndicators: true,
	sessionTimeoutMinutes: 0, // 0 = disabled
	enableBackup: true,
	backupLocation: undefined // Use default backup location
}

// Encryption marker to identify encrypted files
const ENCRYPTION_MARKER = '<!-- LOCKDOWN_ENCRYPTED -->';
const ENCRYPTION_HEADER = `${ENCRYPTION_MARKER}\n`;

export default class LockdownPlugin extends Plugin {
	settings: LockdownSettings;
	private statusBarEl: HTMLElement | null = null;
	private filePasswords: Map<string, string> = new Map();
	passwordHashes: Map<string, string> = new Map();
	private rootPassword: string | null = null;
	private previousActiveFile: TFile | null = null;
	private lockOverlays: Map<string, HTMLElement> = new Map();
	private fileExplorerIndicators: Map<string, HTMLElement> = new Map();
	sessionTimeoutTimer: number | null = null;
	private lastActivityTime: number = Date.now();
	lockedFolders: Set<string> = new Set();
	lockedFiles: Set<string> = new Set();
	private isUnlocking = false;
	private isLocking: Set<string> = new Set();
	private activeLeafChangeTimeout: number | null = null;

	private encryptionService: EncryptionService;
	private lockFileUseCase: LockFileUseCase;
	private unlockFileUseCase: UnlockFileUseCase;
	private sessionVault: SessionVault;
	private passwordStrengthCalculator: PasswordStrengthCalculator;
	private lockRegistry: LockRegistry;
	private lockOverlayManager: LockOverlay;
	private fileExplorerIndicatorsManager: FileExplorerIndicators;

	private initializeServices(): void {
		const keyDeriver = new Pbkdf2KeyDeriver(1_000_000, 'SHA-512');
		const encryptor = new AesGcmEncryptor();
		this.encryptionService = new EncryptionService(keyDeriver, encryptor);
		this.lockFileUseCase = new LockFileUseCase(this.encryptionService);
		this.unlockFileUseCase = new UnlockFileUseCase(this.encryptionService);
		this.sessionVault = new SessionVault(
			this.settings.sessionTimeoutMinutes,
			() => this.handleSessionTimeout()
		);
		this.passwordStrengthCalculator = new PasswordStrengthCalculator();
		this.lockRegistry = new LockRegistry();
		this.lockOverlayManager = new LockOverlay();
		this.fileExplorerIndicatorsManager = new FileExplorerIndicators();

		this.lockRegistry.loadFromData({
			lockedFiles: Array.from(this.lockedFiles),
			lockedFolders: Array.from(this.lockedFolders),
			passwordHashes: Object.fromEntries(this.passwordHashes)
		});
	}

	async onload() {
		await this.loadSettings();
		await this.loadLockedFiles();

		this.initializeServices();

		if (this.settings.showStatusBar) {
			this.statusBarEl = this.addStatusBarItem();
			this.updateStatusBar();
		}

		// Register commands
		this.addCommand({
			id: 'lockdown-toggle-lock',
			name: 'Toggle lock on current file',
			callback: () => this.toggleLock(),
		});

		this.addCommand({
			id: 'lockdown-lock',
			name: 'Lock current file',
			callback: () => this.lockCurrentFile(),
		});

		this.addCommand({
			id: 'lockdown-unlock',
			name: 'Unlock current file',
			callback: () => this.unlockCurrentFile(),
		});

		this.addCommand({
			id: 'lockdown-set-root-password',
			name: 'Set root password',
			callback: () => this.setRootPassword(),
		});

		// Register file menu
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					const isLocked = this.isFileLocked(file.path);
					menu.addItem((item) => {
						item
							.setTitle(isLocked ? 'Unlock file' : 'Lock file')
							.setIcon(isLocked ? 'unlock' : 'lock')
							.onClick(() => {
								if (isLocked) {
									this.unlockFile(file.path);
								} else {
									this.lockFile(file.path);
								}
							});
					});
				} else if (file instanceof TFolder) {
					const isLocked = this.isFolderLocked(file.path);
					menu.addItem((item) => {
						item
							.setTitle(isLocked ? 'Unlock folder' : 'Lock folder')
							.setIcon(isLocked ? 'unlock' : 'lock')
							.onClick(async () => {
								if (isLocked) {
									await this.unlockFolder(file.path);
								} else {
									await this.lockFolder(file.path);
								}
							});
					});
				}
			})
		);

		// Register CodeMirror extension to prevent edits on locked files
		this.registerEditorExtension(
			this.createLockdownExtension()
		);

		// Update status bar when switching files
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				// Debounce to prevent rapid-fire updates that cause glitching
				if (this.activeLeafChangeTimeout) {
					clearTimeout(this.activeLeafChangeTimeout);
				}
				
				this.activeLeafChangeTimeout = window.setTimeout(() => {
					// Get the new active file
					const currentFile = this.app.workspace.getActiveFile();
					
					// Only remove overlays if we're actually switching to a different file
					// Don't remove if clicking in sidebar doesn't change the active file
					if (this.previousActiveFile && currentFile) {
						if (this.previousActiveFile.path !== currentFile.path) {
							// Different file - remove overlays from previous file only
							this.removeLockOverlay(this.previousActiveFile.path);
						} else {
							// Same file - don't do anything, overlay should already be there
							this.updateStatusBar();
							return;
						}
					} else if (this.previousActiveFile && !currentFile) {
						// No active file (clicked in sidebar) - keep overlays for locked files
						// Don't remove overlays, don't show new ones, don't update status bar aggressively
						// Just update status bar once
						this.updateStatusBar();
						return;
					} else if (!this.previousActiveFile && currentFile) {
						// First file - only show overlay if needed, don't remove all
						// (file-open handler will handle showing overlay)
					}
					
					// Auto-lock previous file on close if enabled
					if (this.settings.lockOnClose && this.previousActiveFile && 
						this.previousActiveFile.extension === 'md' && 
						!this.isFileLocked(this.previousActiveFile.path)) {
						this.lockFile(this.previousActiveFile.path);
					}
					
					// Update previous active file
					this.previousActiveFile = currentFile instanceof TFile ? currentFile : null;
					
					this.updateStatusBar();
					
					// Show overlay for current file if it's locked (only if not already shown)
					if (currentFile && currentFile.extension === 'md' && this.isFileLocked(currentFile.path)) {
								// Check if overlay already exists before showing
								if (!this.lockOverlayManager.has(currentFile.path)) {
									setTimeout(() => {
										// Double-check file is still locked and overlay doesn't exist
										if (this.isFileLocked(currentFile.path) && 
											!this.lockOverlayManager.has(currentFile.path)) {
											this.showLockOverlay(currentFile.path);
										}
									}, 100);
								}
					}
				}, 100); // Debounce delay to prevent glitching
			})
		);

		// Intercept file saving to re-encrypt locked files
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				// Skip re-encryption if we're currently unlocking or locking this file
				if (this.isUnlocking || (file instanceof TFile && this.isLocking.has(file.path))) {
					return;
				}
				
				if (file instanceof TFile && file.extension === 'md' && this.isFileLocked(file.path)) {
					// File was modified - if it's locked and encryption is enabled, re-encrypt it
					if (this.settings.useEncryption) {
						// Longer delay to ensure unlock operations complete first
						setTimeout(async () => {
							// Triple-check we're not locking/unlocking this file now
							if (this.isUnlocking || this.isLocking.has(file.path)) {
								return;
							}
							
							// Check again if file is still locked (might have been unlocked)
							if (!this.isFileLocked(file.path)) {
								return;
							}
							
							try {
								const content = await this.app.vault.read(file);
								
								// Only re-encrypt if content is NOT already encrypted
								// This prevents re-encrypting already encrypted content
								if (!this.isFileEncrypted(content)) {
									// File was edited while unlocked, re-encrypt if password is cached
									const password = this.filePasswords.get(file.path);
									if (password) {
										try {
											const encryptedContent = await this.encryptContent(content, password);
											
											// Verify the encrypted content doesn't already exist in the file
											// (safety check to prevent duplication)
											const currentContent = await this.app.vault.read(file);
											if (currentContent === encryptedContent) {
												// Already encrypted, skip
												return;
											}
											
											// Final check - make sure file is still locked
											if (!this.isFileLocked(file.path)) {
												return;
											}
											
											// Use requestAnimationFrame to avoid recursion
											requestAnimationFrame(async () => {
												// One more check before writing
												if (!this.isUnlocking && !this.isLocking.has(file.path) && this.isFileLocked(file.path)) {
													await this.app.vault.modify(file, encryptedContent);
												}
											});
										} catch (error) {
											console.error('Failed to re-encrypt file:', error);
										}
									}
								}
							} catch (error) {
								// File might be in use, ignore
							}
						}, 300); // Increased delay to give unlock more time
					}
				}
			})
		);

		// Intercept file opening to show overlay for locked files
		this.registerEvent(
			this.app.workspace.on('file-open', async (file) => {
				if (file && file instanceof TFile && file.extension === 'md') {
					// Skip if we're currently unlocking this file (prevents re-showing overlay after unlock)
					if (this.isUnlocking) {
						return;
					}
					
					// Remove overlays from previous files (but not the current one if we're locking it)
					// Check if we're currently locking this file to avoid removing overlay we just added
					if (!this.isLocking.has(file.path)) {
						// Only remove overlays for other files, keep overlay for this file if it's locked
						// Use a small delay to prevent rapid DOM manipulation
						setTimeout(() => {
							const leaves = this.app.workspace.getLeavesOfType('markdown');
							for (const leaf of leaves) {
								const view = leaf.view as MarkdownView;
								if (view.file && view.file.path !== file.path) {
									this.removeLockOverlay(view.file.path);
								}
							}
						}, 50);
					}
					
					// Check if file is locked
					if (this.isFileLocked(file.path)) {
					// Check if overlay already exists to prevent flickering
					if (this.lockOverlayManager.has(file.path)) {
						return; // Overlay already exists, don't recreate
					}
						
						// Clear editor content to hide encrypted data
						// We do this regardless of whether it's actually encrypted on disk
						// to prevent any flash of content
						const view = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (view && view.file === file) {
							view.editor.setValue('');
						}
						
						// Show lock overlay
					// Small delay ensures the view is ready
					setTimeout(() => {
						// Double-check file is still locked and overlay doesn't exist
						if (this.isFileLocked(file.path) && 
							!this.lockOverlayManager.has(file.path)) {
							this.showLockOverlay(file.path);
						}
					}, 100);
					}
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new LockdownSettingTab(this.app, this));

		// Initialize file explorer indicators
		if (this.settings.showFileExplorerIndicators) {
			// Initial update with delay to ensure DOM is ready
			setTimeout(() => {
				this.updateFileExplorerIndicators();
			}, 500);
			
			// Only update indicators when files are actually locked/unlocked, not on every vault event
			// This prevents constant DOM manipulation that causes glitching
			// We'll update indicators manually in lockFile/unlockFile methods instead
		}

		// Initialize session timeout if enabled
		if (this.settings.sessionTimeoutMinutes > 0) {
			this.startSessionTimeout();
			// Reset timeout on user activity
			this.registerEvent(
				this.app.workspace.on('active-leaf-change', () => this.resetSessionTimeout())
			);
		}

		// Add command for locked files manager
		this.addCommand({
			id: 'lockdown-show-locked-files',
			name: 'Show locked files manager',
			callback: () => this.showLockedFilesManager(),
		});

		// Add command for changing password
		this.addCommand({
			id: 'lockdown-change-password',
			name: 'Change password for current file',
			callback: () => this.changeFilePassword(),
		});

		// Add command for bulk unlock
		this.addCommand({
			id: 'lockdown-unlock-all',
			name: 'Unlock all files',
			callback: () => this.unlockAllFiles(),
		});

		// Add command for locking current folder
		this.addCommand({
			id: 'lockdown-lock-folder',
			name: 'Lock current folder',
			callback: () => this.lockCurrentFolder(),
		});

		// Add command for unlocking current folder
		this.addCommand({
			id: 'lockdown-unlock-folder',
			name: 'Unlock current folder',
			callback: () => this.unlockCurrentFolder(),
		});

		console.log('Lockdown plugin loaded');
	}

	onunload() {
		// Clear root password from memory for security
		this.rootPassword = null;
		// Clear session timeout
		if (this.sessionTimeoutTimer) {
			clearTimeout(this.sessionTimeoutTimer);
			this.sessionTimeoutTimer = null;
		}
		
		// Clear active leaf change timeout
		if (this.activeLeafChangeTimeout) {
			clearTimeout(this.activeLeafChangeTimeout);
			this.activeLeafChangeTimeout = null;
		}
		
		// Remove file explorer indicators
		this.removeAllFileExplorerIndicators();
		console.log('Lockdown plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadLockedFiles() {
		const data = await this.loadData();
		if (data && data.lockedFiles) {
			this.lockedFiles = new Set(data.lockedFiles);
		}
		if (data && data.passwordHashes) {
			this.passwordHashes = new Map(Object.entries(data.passwordHashes));
		}
		if (data && data.lockedFolders) {
			this.lockedFolders = new Set(data.lockedFolders);
		}
	}

	async saveLockedFiles() {
		const data = await this.loadData() || {};
		data.lockedFiles = Array.from(this.lockedFiles);
		data.passwordHashes = Object.fromEntries(this.passwordHashes);
		data.lockedFolders = Array.from(this.lockedFolders);
		await this.saveData(data);
	}

	async encryptContent(content: string, password: string): Promise<string> {
		const activeFile = this.app.workspace.getActiveFile();
		const filePath = activeFile?.path || '';
		
		try {
			return await this.lockFileUseCase.execute(content, password, filePath);
		} catch (error) {
			throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	async decryptContent(encryptedContent: string, password: string): Promise<string> {
		const activeFile = this.app.workspace.getActiveFile();
		const filePath = activeFile?.path || '';
		
		try {
			return await this.unlockFileUseCase.execute(encryptedContent, password, filePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			if (message.includes('Incorrect password')) {
				throw new Error('Incorrect password or corrupted data');
			}
			throw new Error(`Decryption error: ${message}`);
		}
	}

	async hashPassword(password: string): Promise<string> {
		const pwd = Password.create(password);
		return await pwd.hash();
	}

	isFileEncrypted(content: string): boolean {
		return content.startsWith(ENCRYPTION_HEADER) || content.includes(ENCRYPTION_MARKER);
	}

	isFileLocked(filePath: string): boolean {
		// Check if file is directly locked
		if (this.lockedFiles.has(filePath)) {
			return true;
		}
		
		// Check if file is in a locked folder
		const pathParts = filePath.split('/');
		for (let i = 1; i < pathParts.length; i++) {
			const folderPath = pathParts.slice(0, i).join('/');
			if (this.lockedFolders.has(folderPath)) {
				return true;
			}
		}
		
		return false;
	}

	isFolderLocked(folderPath: string): boolean {
		return this.lockedFolders.has(folderPath);
	}

	/**
	 * Get all markdown files in a folder recursively
	 */
	getMarkdownFilesInFolder(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		
		const processFolder = (currentFolder: TFolder) => {
			for (const child of currentFolder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					files.push(child);
				} else if (child instanceof TFolder) {
					processFolder(child);
				}
			}
		};
		
		processFolder(folder);
		return files;
	}

	showLockOverlay(filePath: string): void {
		let view: MarkdownView | null = null;
		
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file?.path === filePath) {
			view = activeView;
		} else {
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				const leafView = leaf.view as MarkdownView;
				if (leafView.file?.path === filePath) {
					view = leafView;
					break;
				}
			}
		}
		
		if (!view || view.file?.path !== filePath) {
			return;
		}

		const viewContent = view.contentEl;
		if (!viewContent) {
			return;
		}

		let container: HTMLElement | null = viewContent.querySelector('.cm-scroller') as HTMLElement;
		if (!container) container = viewContent.querySelector('.cm-editor') as HTMLElement;
		if (!container) container = viewContent.querySelector('.markdown-source-view') as HTMLElement;
		if (!container) container = viewContent.querySelector('.markdown-reading-view') as HTMLElement;
		if (!container) {
			const editorArea = viewContent.querySelector('[class*="editor"], [class*="content"]') as HTMLElement;
			if (editorArea) container = editorArea;
		}
		if (!container) container = viewContent;
		
		if (!container) {
			return;
		}

		this.lockOverlayManager.show(
			filePath,
			container,
			this.settings.lockIcon,
			async () => await this.unlockFile(filePath)
		);
		
		const overlay = document.querySelector(`.lockdown-overlay[data-file-path="${filePath}"]`) as HTMLElement;
		if (overlay) {
			this.lockOverlays.set(filePath, overlay);
		}
	}

	removeLockOverlay(filePath: string): void {
		this.lockOverlayManager.remove(filePath);
		this.lockOverlays.delete(filePath);
	}

	removeAllLockOverlays(): void {
		this.lockOverlayManager.removeAll();
		this.lockOverlays.clear();
	}

	/**
	 * Get root password, prompting user if not cached in memory
	 */
	async getRootPassword(): Promise<string | null> {
		// Return cached password if available
		if (this.rootPassword) {
			return this.rootPassword;
		}

		// If no root password is set, return null
		if (!this.settings.rootPasswordHash) {
			return null;
		}

		// Prompt user for root password
		const password = await this.promptPassword('Enter root password:', false);
		if (!password) {
			return null; // User cancelled
		}

		// Verify password matches stored hash
		const passwordHash = await this.hashPassword(password);
		if (passwordHash !== this.settings.rootPasswordHash) {
			new Notice('Incorrect root password');
			return null;
		}

		// Cache password in memory
		this.rootPassword = password;
		return password;
	}

	/**
	 * Set or change the root password
	 */
	async setRootPassword(): Promise<void> {
		const password = await this.promptPassword('Enter new root password:', true);
		if (!password) {
			return; // User cancelled
		}

		// Store password hash (never store plain password)
		const passwordHash = await this.hashPassword(password);
		this.settings.rootPasswordHash = passwordHash;
		await this.saveSettings();

		// Cache password in memory for this session
		this.rootPassword = password;

		new Notice('Root password set successfully');
	}

	/**
	 * Clear root password from memory (public method for settings)
	 */
	clearRootPassword(): void {
		this.rootPassword = null;
	}

	async lockFile(filePath: string, password?: string): Promise<void> {
		if (this.isFileLocked(filePath)) {
			return;
		}

		if (this.settings.requireConfirmation) {
			const confirmed = await this.showConfirmationDialog('Lock this file?');
			if (!confirmed) {
				return;
			}
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return;
		}

		// Set flag to prevent re-encryption during lock
		this.isLocking.add(filePath);

		try {
			// Get password if encryption is enabled
			if (this.settings.useEncryption) {
			if (!password) {
				// Try to use root password first
				const rootPassword = await this.getRootPassword();
				if (rootPassword) {
					password = rootPassword;
				} else {
					// No root password set or user cancelled, prompt for file-specific password
					const promptResult = await this.promptPassword('Enter password to lock this file:', true);
					if (!promptResult) {
						return; // User cancelled
					}
					password = promptResult;
				}
			}

			// Create backup before encryption
			await this.createBackup(file);

			// Read current content
			let content = await this.app.vault.read(file);
			
			// If already encrypted, decrypt first to get original content
			// This handles the edge case where a user manually locked an encrypted file 
			// (which shouldn't happen normally, but safety first)
			if (this.isFileEncrypted(content)) {
				const cachedPassword = this.filePasswords.get(filePath);
				if (cachedPassword) {
					try {
						// Use the improved decryptContent which handles duplicated data
						content = await this.decryptContent(content, cachedPassword);
					} catch (e) {
						new Notice('Failed to decrypt existing content. Please unlock first.');
						return;
					}
				} else {
					new Notice('File is already encrypted. Please unlock first.');
					return;
				}
			}
			
			// Safety check: ensure content doesn't contain the encryption marker
			// (shouldn't happen, but prevents accidental double-encryption)
			if (content.includes(ENCRYPTION_MARKER)) {
				new Notice('File appears to already contain encrypted data. Please unlock first.');
				return;
			}

				// Encrypt content
				try {
					const encryptedContent = await this.encryptContent(content, password);
					
					// SAFETY CHECK: Verify decryption works before writing
					const verification = await this.decryptContent(encryptedContent, password);
					if (verification !== content) {
						throw new Error('Encryption verification failed (decrypted content mismatch)');
					}

					// Verify encrypted content doesn't contain duplicates
					// Count occurrences of the base64 part (without header)
					const base64Part = encryptedContent.replace(ENCRYPTION_HEADER, '').trim();
					const base64Matches = base64Part.match(/[A-Za-z0-9+\/]+={0,2}/g);
					if (base64Matches && base64Matches.length > 1) {
						// Multiple base64 blocks detected - this shouldn't happen
						console.warn('Warning: Encrypted content appears to contain duplicates');
					}

					// Write encrypted content only after verification
					await this.app.vault.modify(file, encryptedContent);
					
					// Verify what was written matches what we intended
					const writtenContent = await this.app.vault.read(file);
					if (writtenContent !== encryptedContent) {
						console.warn('Warning: Written content differs from intended encrypted content');
						// Try to fix it by writing again
						await this.app.vault.modify(file, encryptedContent);
					}
					
					// Store password hash for verification
					const passwordHash = await this.hashPassword(password);
					this.passwordHashes.set(filePath, passwordHash);
					
					// Cache password in memory (will be cleared on unlock)
					this.filePasswords.set(filePath, password);
				} catch (error) {
					new Notice(`Failed to encrypt file: ${error.message}. File was NOT modified.`);
					console.error(error);
					return;
				}
			}

			this.lockedFiles.add(filePath);
			await this.saveLockedFiles();
			this.updateStatusBar();
			this.updateFileExplorerIndicators();
			
			// If file is currently open, show overlay and clear editor immediately
			// Check all open views, not just the active one
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			let foundView: MarkdownView | null = null;
			
			for (const leaf of leaves) {
				const view = leaf.view as MarkdownView;
				if (view.file?.path === filePath) {
					foundView = view;
					break;
				}
			}
			
			// Also check active file as fallback
			if (!foundView) {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.path === filePath) {
					foundView = this.app.workspace.getActiveViewOfType(MarkdownView);
				}
			}
			
			if (foundView && foundView.file?.path === filePath) {
				// Clear editor content to hide encrypted data
				foundView.editor.setValue('');
				
				// Show lock overlay with multiple attempts to ensure it appears
				// Sometimes the DOM isn't ready immediately
				const showOverlay = () => {
					this.showLockOverlay(filePath);
					// Verify overlay was created, if not try again
					setTimeout(() => {
						if (!this.lockOverlays.has(filePath)) {
							console.log('Overlay not found, retrying...');
							this.showLockOverlay(filePath);
						}
					}, 200);
				};
				
				// Try immediately with a small delay
				setTimeout(showOverlay, 100);
				// Also try after longer delays as fallback
				setTimeout(showOverlay, 300);
				setTimeout(showOverlay, 500);
			}
			
			// Small delay before clearing flag to ensure modify event handler sees it
			setTimeout(() => {
				this.isLocking.delete(filePath);
			}, 500);
			
			new Notice(`File locked: ${filePath.split('/').pop()}`);
		} catch (error) {
			// Clear flag on error
			this.isLocking.delete(filePath);
			throw error;
		}
	}

	async unlockFile(filePath: string, password?: string): Promise<void> {
		if (!this.isFileLocked(filePath)) {
			return;
		}

		if (this.settings.requireConfirmation) {
			const confirmed = await this.showConfirmationDialog('Unlock this file?');
			if (!confirmed) {
				return;
			}
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return;
		}

		// Set flag to prevent re-encryption during unlock
		this.isUnlocking = true;

		try {
			// Always read fresh content from disk
			let content = await this.app.vault.read(file);
			const isEncrypted = this.isFileEncrypted(content);

			// Decrypt if encrypted
			if (isEncrypted && this.settings.useEncryption) {
			// Get password if not provided
			if (!password) {
				// Try cached password first
				const cachedPassword = this.filePasswords.get(filePath);
				if (cachedPassword) {
					password = cachedPassword;
				} else {
					// Try root password
					const rootPassword = await this.getRootPassword();
					if (rootPassword) {
						password = rootPassword;
					} else {
						// Prompt user
						const promptResult = await this.promptPassword('Enter password to unlock this file:', false);
						if (!promptResult) {
							return; // User cancelled
						}
						password = promptResult;
					}
				}
			}

				// Decrypt content
				try {
					const decryptedContent = await this.decryptContent(content, password);
					
					// Verify decryption succeeded - decrypted content should NOT contain encryption marker
					if (decryptedContent.includes(ENCRYPTION_MARKER)) {
						throw new Error('Decryption failed: result still contains encryption marker');
					}
					
					// Verify we got actual content, not just whitespace or empty
					if (!decryptedContent.trim()) {
						throw new Error('Decryption returned empty content');
					}
					
					// IMPORTANT: Remove from locked files BEFORE writing decrypted content
					// This prevents the modify event handler from re-encrypting the file
					this.lockedFiles.delete(filePath);
					await this.saveLockedFiles();
					
					// Update password hash and cache BEFORE writing
					const passwordHash = await this.hashPassword(password);
					this.passwordHashes.set(filePath, passwordHash);
					this.filePasswords.set(filePath, password);
					
					// Remove overlay BEFORE modifying file to prevent file-open event from re-showing it
					this.removeLockOverlay(filePath);
					
					// Now save decrypted content to disk
					// The modify handler won't re-encrypt because:
					// 1. File is no longer in lockedFiles (checked above)
					// 2. isUnlocking flag is set (checked in modify handler)
					await this.app.vault.modify(file, decryptedContent);
					
					// Longer delay to let disk write complete and modify event settle
					await new Promise(resolve => setTimeout(resolve, 300));
					
					// Update editor AFTER disk write to ensure we show the correct content
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view && view.file?.path === filePath) {
						// Read fresh content from disk to ensure we have the latest
						const freshContent = await this.app.vault.read(file);
						if (!this.isFileEncrypted(freshContent)) {
							view.editor.setValue(freshContent);
						} else {
							// If somehow still encrypted, use decrypted content
							view.editor.setValue(decryptedContent);
						}
					}
					
					// Update local content variable
					content = decryptedContent;
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : 'Unknown error';
					new Notice(`Failed to decrypt: ${errorMsg}`);
					console.error('Decryption error:', error);
					return;
				}
			} else {
				// File is not encrypted, just remove from locked files
				this.lockedFiles.delete(filePath);
				await this.saveLockedFiles();
			}

			// Update UI
			this.updateStatusBar();
			this.updateFileExplorerIndicators();
			
			// Overlay was already removed above (before vault.modify)
			// Just ensure it's gone
			this.removeLockOverlay(filePath);
			
			// Ensure editor is updated (in case it wasn't updated above)
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view && view.file?.path === filePath) {
				// Read fresh content to ensure editor shows correct content
				const freshContent = await this.app.vault.read(file);
				if (!this.isFileEncrypted(freshContent)) {
					view.editor.setValue(freshContent);
				}
			}
			
			new Notice(`File unlocked: ${filePath.split('/').pop()}`);
		} finally {
			// Clear the unlocking flag after a short delay to ensure all events have settled
			setTimeout(() => {
				this.isUnlocking = false;
			}, 500);
		}
	}

	async toggleLock() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md') {
			new Notice('Please open a markdown file to lock/unlock');
			return;
		}

		if (this.isFileLocked(activeFile.path)) {
			await this.unlockFile(activeFile.path);
		} else {
			await this.lockFile(activeFile.path);
		}
	}

	async lockCurrentFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md') {
			new Notice('Please open a markdown file to lock');
			return;
		}
		await this.lockFile(activeFile.path);
	}

	async unlockCurrentFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md') {
			new Notice('Please open a markdown file to unlock');
			return;
		}
		await this.unlockFile(activeFile.path);
	}

	updateStatusBar() {
		if (!this.statusBarEl) return;

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === 'md') {
			const isLocked = this.isFileLocked(activeFile.path);
			this.statusBarEl.textContent = isLocked 
				? `${this.settings.lockIcon} Locked` 
				: '';
			this.statusBarEl.style.cursor = 'pointer';
			this.statusBarEl.onclick = () => this.toggleLock();
		} else {
			this.statusBarEl.textContent = '';
		}
	}

	setStatusBarEl(element: HTMLElement | null): void {
		this.statusBarEl = element;
	}

	getStatusBarEl(): HTMLElement | null {
		return this.statusBarEl;
	}

	updateFileExplorerIndicators(): void {
		if (!this.settings.showFileExplorerIndicators) {
			this.removeAllFileExplorerIndicators();
			return;
		}

		const allFiles = this.app.vault.getMarkdownFiles();
		const filesInLockedFolders = new Set<string>();
		allFiles.forEach(file => {
			if (this.isFileLocked(file.path) && !this.lockedFiles.has(file.path)) {
				filesInLockedFolders.add(file.path);
			}
		});

		const allLockedFiles = new Set([...this.lockedFiles, ...filesInLockedFolders]);

		this.fileExplorerIndicatorsManager.updateAll(
			allLockedFiles,
			this.lockedFolders,
			this.settings.lockIcon,
			(path) => this.passwordHashes.has(path)
		);
	}

	removeAllFileExplorerIndicators(): void {
		this.fileExplorerIndicatorsManager.removeAll();
		this.fileExplorerIndicators.clear();
	}

	/**
	 * Start session timeout timer
	 */
	startSessionTimeout(): void {
		if (this.settings.sessionTimeoutMinutes <= 0) return;

		this.resetSessionTimeout();
	}

	/**
	 * Reset session timeout timer
	 */
	resetSessionTimeout(): void {
		if (this.settings.sessionTimeoutMinutes <= 0) return;

		this.lastActivityTime = Date.now();

		// Clear existing timer
		if (this.sessionTimeoutTimer) {
			clearTimeout(this.sessionTimeoutTimer);
		}

		// Set new timer
		const timeoutMs = this.settings.sessionTimeoutMinutes * 60 * 1000;
		this.sessionTimeoutTimer = window.setTimeout(() => {
			this.handleSessionTimeout();
		}, timeoutMs);
	}

	/**
	 * Handle session timeout - lock all files and clear passwords
	 */
	async handleSessionTimeout(): Promise<void> {
		new Notice('Session timeout: Locking all files and clearing passwords');

		// Lock all unlocked files
		const unlockedFiles: string[] = [];
		this.lockedFiles.forEach(filePath => {
			// Check if file is actually unlocked (password cached means it was unlocked)
			if (this.filePasswords.has(filePath)) {
				unlockedFiles.push(filePath);
			}
		});

		// Lock files that were unlocked
		for (const filePath of unlockedFiles) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile && this.settings.useEncryption) {
				try {
					const content = await this.app.vault.read(file);
					if (!this.isFileEncrypted(content)) {
						const password = this.filePasswords.get(filePath);
						if (password) {
							const encryptedContent = await this.encryptContent(content, password);
							await this.app.vault.modify(file, encryptedContent);
						}
					}
				} catch (error) {
					console.error('Failed to lock file on timeout:', filePath, error);
				}
			}
		}

		// Clear all cached passwords
		this.filePasswords.clear();
		this.rootPassword = null;

		// Update UI
		this.updateStatusBar();
		this.updateFileExplorerIndicators();

		// Show lock overlays for currently open locked files
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && this.isFileLocked(activeFile.path)) {
			this.showLockOverlay(activeFile.path);
		}
	}

	/**
	 * Create backup of file before encryption
	 */
	async createBackup(file: TFile): Promise<string | null> {
		if (!this.settings.enableBackup) {
			return null;
		}

		try {
			const content = await this.app.vault.read(file);
			const backupPath = this.getBackupPath(file.path);
			
			// Ensure backup directory exists
			const backupDir = backupPath.substring(0, backupPath.lastIndexOf('/'));
			if (!(await this.app.vault.adapter.exists(backupDir))) {
				await this.app.vault.adapter.mkdir(backupDir);
			}

			// Write backup
			await this.app.vault.adapter.write(backupPath, content);
			return backupPath;
		} catch (error) {
			console.error('Failed to create backup:', error);
			new Notice('Warning: Could not create backup before encryption');
			return null;
		}
	}

	/**
	 * Get backup path for a file
	 */
	getBackupPath(filePath: string): string {
		const backupLocation = this.settings.backupLocation || '.lockdown-backups';
		const timestamp = Date.now();
		const fileName = filePath.split('/').pop() || 'file';
		const backupFileName = `${fileName}.backup.${timestamp}`;
		// Use the file's directory structure within backup location
		const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
		if (fileDir) {
			return `${backupLocation}${fileDir}/${backupFileName}`;
		}
		return `${backupLocation}/${backupFileName}`;
	}

	/**
	 * Change password for a locked file
	 */
	async changeFilePassword(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md') {
			new Notice('Please open a markdown file to change its password');
			return;
		}

		if (!this.isFileLocked(activeFile.path)) {
			new Notice('File is not locked');
			return;
		}

		if (!this.settings.useEncryption) {
			new Notice('Encryption is disabled. Enable encryption in settings to use passwords.');
			return;
		}

		// Get old password
		const oldPassword = await this.promptPassword('Enter current password:', false);
		if (!oldPassword) {
			return; // User cancelled
		}

		// Verify old password by trying to decrypt
		let content = await this.app.vault.read(activeFile);
		if (!this.isFileEncrypted(content)) {
			new Notice('File is not encrypted');
			return;
		}

		try {
			content = await this.decryptContent(content, oldPassword);
		} catch (error) {
			new Notice('Incorrect password');
			return;
		}

		// Get new password
		const newPassword = await this.promptPassword('Enter new password:', true);
		if (!newPassword) {
			return; // User cancelled
		}

		// Encrypt with new password
		try {
			const encryptedContent = await this.encryptContent(content, newPassword);
			
			// Verify encryption works
			const verification = await this.decryptContent(encryptedContent, newPassword);
			if (verification !== content) {
				throw new Error('Encryption verification failed');
			}

			// Write encrypted content
			await this.app.vault.modify(activeFile, encryptedContent);

			// Update password hash and cache
			const passwordHash = await this.hashPassword(newPassword);
			this.passwordHashes.set(activeFile.path, passwordHash);
			this.filePasswords.set(activeFile.path, newPassword);

			new Notice('Password changed successfully');
		} catch (error) {
			new Notice(`Failed to change password: ${error.message}`);
			console.error(error);
		}
	}

	/**
	 * Show locked files manager modal
	 */
	showLockedFilesManager(): void {
		new LockedFilesManagerModal(this.app, this).open();
	}

	/**
	 * Unlock all files (with confirmation)
	 */
	async unlockAllFiles(): Promise<void> {
		if (this.lockedFiles.size === 0 && this.lockedFolders.size === 0) {
			new Notice('No files or folders are locked');
			return;
		}

		const totalLocked = this.lockedFiles.size + this.lockedFolders.size;
		const confirmed = await this.showConfirmationDialog(
			`Are you sure you want to unlock all ${totalLocked} locked items (${this.lockedFiles.size} files, ${this.lockedFolders.size} folders)?`
		);
		if (!confirmed) {
			return;
		}

		const filesToUnlock = Array.from(this.lockedFiles);
		const foldersToUnlock = Array.from(this.lockedFolders);
		let successCount = 0;
		let failCount = 0;

		// Unlock all files
		for (const filePath of filesToUnlock) {
			try {
				await this.unlockFile(filePath);
				successCount++;
			} catch (error) {
				failCount++;
				console.error(`Failed to unlock ${filePath}:`, error);
			}
		}

		// Unlock all folders
		for (const folderPath of foldersToUnlock) {
			try {
				await this.unlockFolder(folderPath);
				successCount++;
			} catch (error) {
				failCount++;
				console.error(`Failed to unlock folder ${folderPath}:`, error);
			}
		}

		new Notice(`Unlocked ${successCount} items${failCount > 0 ? `, ${failCount} failed` : ''}`);
	}

	/**
	 * Lock a folder and all markdown files within it recursively
	 */
	async lockFolder(folderPath: string, password?: string): Promise<void> {
		if (this.isFolderLocked(folderPath)) {
			return;
		}

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			new Notice('Folder not found');
			return;
		}

		if (this.settings.requireConfirmation) {
			const files = this.getMarkdownFilesInFolder(folder);
			const confirmed = await this.showConfirmationDialog(
				`Lock folder "${folderPath}" and all ${files.length} markdown files within it?`
			);
			if (!confirmed) {
				return;
			}
		}

		// Get password if encryption is enabled
		if (this.settings.useEncryption && !password) {
			const rootPassword = await this.getRootPassword();
			if (rootPassword) {
				password = rootPassword;
			} else {
				const promptResult = await this.promptPassword('Enter password to lock this folder:', true);
				if (!promptResult) {
					return; // User cancelled
				}
				password = promptResult;
			}
		}

		// Lock all markdown files in the folder recursively
		const files = this.getMarkdownFilesInFolder(folder);
		let lockedCount = 0;
		let failedCount = 0;

		for (const file of files) {
			try {
				await this.lockFile(file.path, password);
				lockedCount++;
			} catch (error) {
				failedCount++;
				console.error(`Failed to lock file ${file.path}:`, error);
			}
		}

		// Mark folder as locked
		this.lockedFolders.add(folderPath);
		await this.saveLockedFiles();
		this.updateFileExplorerIndicators();

		if (failedCount > 0) {
			new Notice(`Locked folder "${folderPath}" (${lockedCount} files locked, ${failedCount} failed)`);
		} else {
			new Notice(`Locked folder "${folderPath}" (${lockedCount} files)`);
		}
	}

	/**
	 * Unlock a folder and all markdown files within it recursively
	 */
	async unlockFolder(folderPath: string, password?: string): Promise<void> {
		if (!this.isFolderLocked(folderPath)) {
			return;
		}

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			// Folder might have been deleted, just remove from locked folders
			this.lockedFolders.delete(folderPath);
			await this.saveLockedFiles();
			return;
		}

		if (this.settings.requireConfirmation) {
			const files = this.getMarkdownFilesInFolder(folder);
			const confirmed = await this.showConfirmationDialog(
				`Unlock folder "${folderPath}" and all ${files.length} markdown files within it?`
			);
			if (!confirmed) {
				return;
			}
		}

		// Unlock all markdown files in the folder recursively
		const files = this.getMarkdownFilesInFolder(folder);
		let unlockedCount = 0;
		let failedCount = 0;

		for (const file of files) {
			try {
				await this.unlockFile(file.path, password);
				unlockedCount++;
			} catch (error) {
				failedCount++;
				console.error(`Failed to unlock file ${file.path}:`, error);
			}
		}

		// Remove folder from locked folders
		this.lockedFolders.delete(folderPath);
		await this.saveLockedFiles();
		this.updateFileExplorerIndicators();

		if (failedCount > 0) {
			new Notice(`Unlocked folder "${folderPath}" (${unlockedCount} files unlocked, ${failedCount} failed)`);
		} else {
			new Notice(`Unlocked folder "${folderPath}" (${unlockedCount} files)`);
		}
	}

	/**
	 * Lock the folder containing the current file
	 */
	async lockCurrentFolder(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('Please open a file to lock its folder');
			return;
		}

		const folderPath = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));
		if (!folderPath) {
			new Notice('File is in the root directory');
			return;
		}

		await this.lockFolder(folderPath);
	}

	/**
	 * Unlock the folder containing the current file
	 */
	async unlockCurrentFolder(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('Please open a file to unlock its folder');
			return;
		}

		const folderPath = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));
		if (!folderPath) {
			new Notice('File is in the root directory');
			return;
		}

		// Find the locked folder (could be a parent folder)
		let currentPath = folderPath;
		let lockedFolderPath: string | null = null;

		while (currentPath) {
			if (this.lockedFolders.has(currentPath)) {
				lockedFolderPath = currentPath;
				break;
			}
			const lastSlash = currentPath.lastIndexOf('/');
			if (lastSlash === -1) break;
			currentPath = currentPath.substring(0, lastSlash);
		}

		if (!lockedFolderPath) {
			new Notice('No locked folder found containing this file');
			return;
		}

		await this.unlockFolder(lockedFolderPath);
	}

	createLockdownExtension() {
		const plugin = this;
		
		// Effect to set lock state
		const setLockedEffect = StateEffect.define<{ locked: boolean; content: string }>();
		
		// State field to track lock status and original content
		const lockdownState = StateField.define<{ locked: boolean; originalContent: string; filePath: string | null }>({
			create() {
				return { locked: false, originalContent: '', filePath: null };
			},
			update(value, tr) {
				// Check for lock state changes
				for (const effect of tr.effects) {
					if (effect.is(setLockedEffect)) {
						return {
							locked: effect.value.locked,
							originalContent: effect.value.content,
							filePath: effect.value.locked ? plugin.app.workspace.getActiveFile()?.path || null : null
						};
					}
				}
				
				// If locked and document changed, prevent the change
				if (value.locked && tr.docChanged) {
					const currentContent = tr.newDoc.toString();
					if (currentContent !== value.originalContent) {
						// Return transaction that restores original content
						setTimeout(() => {
							new Notice('This file is locked and cannot be edited');
						}, 0);
						
						// Return state with restored content
						return {
							...value,
							locked: true
						};
					}
				}
				
				return value;
			}
		});

		// View plugin to update lock state when file changes
		const lockdownViewPlugin = ViewPlugin.fromClass(
			class {
				private updateTimeout: number | null = null;
				private isUpdating = false;

			constructor(private view: EditorView) {
				// Don't update in constructor - let the update() method handle it
			}

			update(update: ViewUpdate) {
					// Update lock state when file changes
					// Use a longer delay to ensure we're outside any update cycle
					if (this.updateTimeout) {
						clearTimeout(this.updateTimeout);
					}
					this.updateTimeout = window.setTimeout(() => {
						this.scheduleUpdate(update.view);
					}, 150);
				}

				scheduleUpdate(view: EditorView) {
					// Use multiple deferrals to ensure we're outside CodeMirror's update cycle
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							this.updateLockState(view);
						});
					});
				}

				updateLockState(view: EditorView) {
					// Prevent concurrent updates
					if (this.isUpdating) {
						return;
					}

					// Check if view is still valid
					if (!view.dom.isConnected) {
						return;
					}

					this.isUpdating = true;

					try {
						const activeFile = plugin.app.workspace.getActiveFile();
						if (activeFile && activeFile.extension === 'md') {
							const isLocked = plugin.isFileLocked(activeFile.path);
							const state = view.state.field(lockdownState);
							
							// Only update if lock status changed or file changed
							if (state.filePath !== activeFile.path || state.locked !== isLocked) {
								// Read file content asynchronously but don't wait for it in the update cycle
								if (isLocked) {
									// Schedule async read, then update state
									plugin.app.vault.read(activeFile).then(content => {
										// Use multiple requestAnimationFrame calls to ensure we're safe
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								try {
									if (!this.view.dom.isConnected) {
										this.isUpdating = false;
										return;
									}
									
									this.view.dispatch({
										effects: setLockedEffect.of({ locked: true, content })
									});
									
									// Restore content if needed (defer this too)
									requestAnimationFrame(() => {
										requestAnimationFrame(() => {
											try {
												if (!this.view.dom.isConnected) {
													this.isUpdating = false;
													return;
												}
												
												const currentContent = this.view.state.doc.toString();
												if (currentContent !== content) {
													this.view.dispatch({
														changes: {
															from: 0,
															to: this.view.state.doc.length,
															insert: content
														}
													});
												}
												this.isUpdating = false;
											} catch (error) {
												console.error('Error updating locked content:', error);
												this.isUpdating = false;
											}
										});
									});
								} catch (error) {
									console.error('Error updating lock state:', error);
									this.isUpdating = false;
								}
											});
										});
									}).catch(error => {
										console.error('Failed to read file for lock state:', error);
										this.isUpdating = false;
									});
								} else {
									// Not locked - update immediately (synchronously)
									requestAnimationFrame(() => {
										requestAnimationFrame(() => {
											try {
												if (!this.view.dom.isConnected) {
													this.isUpdating = false;
													return;
												}
												this.view.dispatch({
													effects: setLockedEffect.of({ locked: false, content: '' })
												});
												this.isUpdating = false;
											} catch (error) {
												console.error('Error updating lock state:', error);
												this.isUpdating = false;
											}
										});
									});
								}
							} else {
								this.isUpdating = false;
							}
						} else {
							const state = this.view.state.field(lockdownState);
							if (state.locked || state.filePath !== null) {
								// Defer this dispatch too
								requestAnimationFrame(() => {
									requestAnimationFrame(() => {
										try {
											if (!this.view.dom.isConnected) {
												this.isUpdating = false;
												return;
											}
											this.view.dispatch({
												effects: setLockedEffect.of({ locked: false, content: '' })
											});
											this.isUpdating = false;
										} catch (error) {
											console.error('Error clearing lock state:', error);
											this.isUpdating = false;
										}
									});
								});
							} else {
								this.isUpdating = false;
							}
						}
					} catch (error) {
						console.error('Error in updateLockState:', error);
						this.isUpdating = false;
					}
				}

				destroy() {
					if (this.updateTimeout) {
						clearTimeout(this.updateTimeout);
					}
				}
			}
		);

		// Transaction filter to prevent edits on locked files
		const lockdownFilter = EditorState.transactionFilter.of((tr) => {
			try {
				const state = tr.startState.field(lockdownState);
				if (state.locked && tr.docChanged) {
					const newContent = tr.newDoc.toString();
					if (newContent !== state.originalContent && state.originalContent) {
						// Block the transaction and restore original content
					// Use requestAnimationFrame to defer the restoration
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							try {
								const _view = tr.startState.field(lockdownState, false);
								// Actually, we can't access the view here, so just return the blocked transaction
							} catch (e) {
								// Ignore
							}
						});
					});
						
						return {
							changes: {
								from: 0,
								to: tr.newDoc.length,
								insert: state.originalContent
							}
						};
					}
				}
			} catch (error) {
				// If there's an error accessing state, just allow the transaction
				console.error('Error in transaction filter:', error);
			}
			return tr;
		});

		return [lockdownState, lockdownViewPlugin, lockdownFilter];
	}

	async showConfirmationDialog(message: string): Promise<boolean> {
		const modal = new ConfirmationModal(this.app, message);
		return await modal.confirm();
	}

	calculatePasswordStrength(password: string): { score: number; feedback: string } {
		return this.passwordStrengthCalculator.calculate(password);
	}

	async promptPassword(message: string, isNewPassword: boolean): Promise<string | undefined> {
		const modal = new PasswordPromptModal(
			this.app,
			message,
			isNewPassword,
			this.passwordStrengthCalculator
		);
		return await modal.prompt();
	}
}

/**
 * Modal for managing locked files
 */
class LockedFilesManagerModal extends Modal {
	plugin: LockdownPlugin;

	constructor(app: App, plugin: LockdownPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lockdown-modal', 'lockdown-manager-modal');

		// Title with icon
		const titleContainer = contentEl.createDiv({ cls: 'lockdown-modal-title-container' });
		titleContainer.createSpan({ text: '🔐', cls: 'lockdown-modal-icon' });
		titleContainer.createEl('h2', { text: 'Locked Items Manager', cls: 'lockdown-modal-title' });

		const lockedFiles = Array.from(this.plugin.lockedFiles);
		const lockedFolders = Array.from(this.plugin.lockedFolders);
		
		if (lockedFiles.length === 0 && lockedFolders.length === 0) {
			const emptyState = contentEl.createDiv({ cls: 'lockdown-empty-state' });
			emptyState.createSpan({ text: '🔓', cls: 'lockdown-empty-state-icon' });
			emptyState.createEl('p', { text: 'No files or folders are currently locked', cls: 'lockdown-empty-state-message' });
			return;
		}

		// Tabs for files and folders
		const tabsContainer = contentEl.createDiv({ cls: 'lockdown-tabs' });
		const filesTab = tabsContainer.createEl('button', { 
			text: `Files (${lockedFiles.length})`,
			cls: 'lockdown-tab active'
		});
		const foldersTab = tabsContainer.createEl('button', { 
			text: `Folders (${lockedFolders.length})`,
			cls: 'lockdown-tab'
		});

		// Search/filter input
		const searchContainer = contentEl.createDiv({ cls: 'lockdown-search-container' });
		const searchInputEl = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search...',
			cls: 'lockdown-search-input'
		});

		// Files list container
		const filesList = contentEl.createDiv({ cls: 'lockdown-files-list' });

		let currentTab: 'files' | 'folders' = 'files';

		const renderFiles = (filter = '') => {
			filesList.empty();
			
			if (currentTab === 'files') {
				const filteredFiles = lockedFiles.filter(path => 
					path.toLowerCase().includes(filter.toLowerCase())
				);

				if (filteredFiles.length === 0) {
					filesList.createEl('p', { text: 'No files match your search.' });
					return;
				}

				filteredFiles.forEach(filePath => {
				const fileItem = filesList.createDiv({ cls: 'lockdown-file-item' });
				
				// File name
				const fileName = filePath.split('/').pop() || filePath;
				const nameEl = fileItem.createEl('div', { cls: 'lockdown-file-name', text: fileName });
				nameEl.title = filePath;
				
				// File path (smaller)
				fileItem.createEl('div', { cls: 'lockdown-file-path', text: filePath });
				
				// Status indicators
				const statusEl = fileItem.createDiv({ cls: 'lockdown-file-status' });
				const isEncrypted = this.plugin.passwordHashes.has(filePath);
				statusEl.createSpan({ 
					text: this.plugin.settings.lockIcon || '🔒',
					title: isEncrypted ? 'Locked and encrypted' : 'Locked'
				});
				if (isEncrypted) {
					statusEl.createSpan({ text: '🔐', title: 'Encrypted' });
				}

				// Action buttons
				const actionsEl = fileItem.createDiv({ cls: 'lockdown-file-actions' });
				
				// Unlock button
				const unlockBtn = actionsEl.createEl('button', { text: 'Unlock', cls: 'mod-cta' });
				unlockBtn.onclick = async () => {
					await this.plugin.unlockFile(filePath);
					this.onOpen(); // Refresh list
				};

				// Open button
				const openBtn = actionsEl.createEl('button', { text: 'Open' });
				openBtn.onclick = () => {
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						this.app.workspace.openLinkText(filePath, '', true);
					}
				};
			});
			} else {
				// Render folders
				const filteredFolders = lockedFolders.filter(path => 
					path.toLowerCase().includes(filter.toLowerCase())
				);

				if (filteredFolders.length === 0) {
					filesList.createEl('p', { text: 'No folders match your search.' });
					return;
				}

				filteredFolders.forEach(folderPath => {
					const folderItem = filesList.createDiv({ cls: 'lockdown-file-item' });
					
					// Folder name
					const folderName = folderPath.split('/').pop() || folderPath;
					const nameEl = folderItem.createEl('div', { cls: 'lockdown-file-name', text: folderName });
					nameEl.textContent = `📁 ${folderName}`;
					nameEl.title = folderPath;
					
					// Folder path (smaller)
					folderItem.createEl('div', { cls: 'lockdown-file-path', text: folderPath });
					
					// Status indicators
					const statusEl = folderItem.createDiv({ cls: 'lockdown-file-status' });
					statusEl.createSpan({ 
						text: this.plugin.settings.lockIcon || '🔒',
						title: 'Locked folder'
					});

					// Action buttons
					const actionsEl = folderItem.createDiv({ cls: 'lockdown-file-actions' });
					
					// Unlock button
					const unlockBtn = actionsEl.createEl('button', { text: 'Unlock', cls: 'mod-cta' });
					unlockBtn.onclick = async () => {
						await this.plugin.unlockFolder(folderPath);
						this.onOpen(); // Refresh list
					};
				});
			}
		};

		// Tab switching
		filesTab.onclick = () => {
			currentTab = 'files';
			filesTab.classList.add('active');
			foldersTab.classList.remove('active');
			renderFiles(searchInputEl.value);
		};

		foldersTab.onclick = () => {
			currentTab = 'folders';
			foldersTab.classList.add('active');
			filesTab.classList.remove('active');
			renderFiles(searchInputEl.value);
		};

		// Initial render
		renderFiles();

		// Search functionality
		searchInputEl.oninput = (e) => {
			const filter = (e.target as HTMLInputElement).value;
			renderFiles(filter);
		};

		// Bulk actions
		const bulkActions = contentEl.createDiv({ cls: 'lockdown-bulk-actions' });
		
		const unlockAllBtn = bulkActions.createEl('button', { 
			text: `Unlock All (${lockedFiles.length + lockedFolders.length})`,
			cls: 'lockdown-modal-button lockdown-modal-button-warning'
		});
		unlockAllBtn.onclick = async () => {
			await this.plugin.unlockAllFiles();
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class LockdownSettingTab extends PluginSettingTab {
	plugin: LockdownPlugin;

	constructor(app: App, plugin: LockdownPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Lockdown Settings' });

		new Setting(containerEl)
			.setName('Root password')
			.setDesc('Set a root password to use for all locked files. This avoids prompting for passwords each time. You can also use the command "Set root password" from the command palette.')
			.addButton(button => button
				.setButtonText(this.plugin.settings.rootPasswordHash ? 'Change root password' : 'Set root password')
				.setCta()
				.onClick(async () => {
					await this.plugin.setRootPassword();
					button.setButtonText(this.plugin.settings.rootPasswordHash ? 'Change root password' : 'Set root password');
				}));

		if (this.plugin.settings.rootPasswordHash) {
			new Setting(containerEl)
				.setName('Remove root password')
				.setDesc('Remove the root password. You will need to enter passwords for each file individually.')
				.addButton(button => button
					.setButtonText('Remove')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.rootPasswordHash = undefined;
						this.plugin.clearRootPassword();
						await this.plugin.saveSettings();
						new Notice('Root password removed');
						this.display(); // Refresh settings UI
					}));
		}

		new Setting(containerEl)
			.setName('Lock icon')
			.setDesc('Icon to display in status bar for locked files')
			.addText(text => text
				.setPlaceholder('🔒')
				.setValue(this.plugin.settings.lockIcon)
				.onChange(async (value) => {
					this.plugin.settings.lockIcon = value || '🔒';
					await this.plugin.saveSettings();
					this.plugin.updateStatusBar();
				}));

		new Setting(containerEl)
			.setName('Use encryption')
			.setDesc('Encrypt file content when locking (files cannot be read without password)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useEncryption)
				.onChange(async (value) => {
					this.plugin.settings.useEncryption = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show status bar')
			.setDesc('Display lock status in the status bar')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showStatusBar)
				.onChange(async (value) => {
					this.plugin.settings.showStatusBar = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.setStatusBarEl(this.plugin.addStatusBarItem());
					} else {
						const statusBarEl = this.plugin.getStatusBarEl();
						statusBarEl?.remove();
						this.plugin.setStatusBarEl(null);
					}
					this.plugin.updateStatusBar();
				}));

		new Setting(containerEl)
			.setName('Require confirmation')
			.setDesc('Show confirmation dialog when locking/unlocking files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.requireConfirmation)
				.onChange(async (value) => {
					this.plugin.settings.requireConfirmation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-lock on close')
			.setDesc('Automatically lock files when you close them')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.lockOnClose)
				.onChange(async (value) => {
					this.plugin.settings.lockOnClose = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show file explorer indicators')
			.setDesc('Display lock icons next to locked files in the file explorer')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showFileExplorerIndicators)
				.onChange(async (value) => {
					this.plugin.settings.showFileExplorerIndicators = value;
					await this.plugin.saveSettings();
					this.plugin.updateFileExplorerIndicators();
				}));

		new Setting(containerEl)
			.setName('Session timeout (minutes)')
			.setDesc('Automatically lock all files and clear passwords after inactivity (0 = disabled)')
			.addText(text => text
				.setPlaceholder('0')
				.setValue(this.plugin.settings.sessionTimeoutMinutes.toString())
				.onChange(async (value) => {
					const minutes = parseInt(value) || 0;
					this.plugin.settings.sessionTimeoutMinutes = minutes;
					await this.plugin.saveSettings();
					if (minutes > 0) {
						this.plugin.startSessionTimeout();
					} else {
						if (this.plugin.sessionTimeoutTimer) {
							clearTimeout(this.plugin.sessionTimeoutTimer);
							this.plugin.sessionTimeoutTimer = null;
						}
					}
				}));

		new Setting(containerEl)
			.setName('Enable backup before encryption')
			.setDesc('Create automatic backups before encrypting files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableBackup)
				.onChange(async (value) => {
					this.plugin.settings.enableBackup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Backup location')
			.setDesc('Directory where backups are stored (default: .lockdown-backups)')
			.addText(text => text
				.setPlaceholder('.lockdown-backups')
				.setValue(this.plugin.settings.backupLocation || '')
				.onChange(async (value) => {
					this.plugin.settings.backupLocation = value || undefined;
					await this.plugin.saveSettings();
				}));
	}
}

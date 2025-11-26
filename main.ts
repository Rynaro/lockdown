import { Plugin, PluginSettingTab, Setting, TFile, TFolder, Notice, MarkdownView, Editor, Modal, App } from 'obsidian';
import { EditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { EditorState } from '@codemirror/state';

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
	private filePasswords: Map<string, string> = new Map(); // In-memory password cache
	passwordHashes: Map<string, string> = new Map(); // Password hashes for verification (made public for modal access)
	private rootPassword: string | null = null; // In-memory root password cache (cleared on unload)
	private previousActiveFile: TFile | null = null;
	private lockOverlays: Map<string, HTMLElement> = new Map(); // Track lock overlays by file path
	private fileExplorerIndicators: Map<string, HTMLElement> = new Map(); // Track file explorer indicators
	sessionTimeoutTimer: number | null = null; // Session timeout timer
	private lastActivityTime: number = Date.now(); // Track last activity for session timeout
	lockedFolders: Set<string> = new Set(); // Track locked folders
	lockedFiles: Set<string> = new Set(); // Track locked files (made public for modal access)
	private isUnlocking: boolean = false; // Flag to prevent re-encryption during unlock
	private isLocking: Set<string> = new Set(); // Track files currently being locked to prevent re-encryption
	private activeLeafChangeTimeout: number | null = null; // Debounce timer for active-leaf-change

	async onload() {
		await this.loadSettings();
		await this.loadLockedFiles();

		// Add status bar
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
						const existingOverlay = document.querySelector(`.lockdown-overlay[data-file-path="${currentFile.path}"]`);
						if (!existingOverlay) {
							setTimeout(() => {
								// Double-check file is still locked and overlay doesn't exist
								if (this.isFileLocked(currentFile.path) && 
									!document.querySelector(`.lockdown-overlay[data-file-path="${currentFile.path}"]`)) {
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
						const existingOverlay = document.querySelector(`.lockdown-overlay[data-file-path="${file.path}"]`);
						if (existingOverlay) {
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
								!document.querySelector(`.lockdown-overlay[data-file-path="${file.path}"]`)) {
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

	// Encryption utilities
	async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
		const encoder = new TextEncoder();
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			encoder.encode(password),
			'PBKDF2',
			false,
			['deriveBits', 'deriveKey']
		);

		return crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt: salt,
				iterations: 100000,
				hash: 'SHA-256'
			},
			keyMaterial,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);
	}

	// Helper to convert Uint8Array to Base64 robustly
	arrayBufferToBase64(buffer: Uint8Array): string {
		let binary = '';
		const len = buffer.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(buffer[i]);
		}
		return window.btoa(binary);
	}

	// Helper to convert Base64 to Uint8Array robustly
	base64ToArrayBuffer(base64: string): Uint8Array {
		const binary_string = window.atob(base64);
		const len = binary_string.length;
		const bytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) {
			bytes[i] = binary_string.charCodeAt(i);
		}
		return bytes;
	}

	async encryptContent(content: string, password: string): Promise<string> {
		try {
			if (!content && content !== '') throw new Error('Content is null/undefined');
			if (!password) throw new Error('Password is empty');

			const encoder = new TextEncoder();
			const data = encoder.encode(content);

			const salt = crypto.getRandomValues(new Uint8Array(16));
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const key = await this.deriveKey(password, salt);

			const encrypted = await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv: iv },
				key,
				data
			);

			const encryptedArray = new Uint8Array(encrypted);
			const combined = new Uint8Array(salt.length + iv.length + encryptedArray.length);
			combined.set(salt);
			combined.set(iv, salt.length);
			combined.set(encryptedArray, salt.length + iv.length);

			const base64 = this.arrayBufferToBase64(combined);
			return `${ENCRYPTION_HEADER}${base64}`;
		} catch (error) {
			throw new Error(`Encryption failed: ${error.message}`);
		}
	}

	async decryptContent(encryptedContent: string, password: string): Promise<string> {
		try {
			if (!encryptedContent) throw new Error('Encrypted content is empty');
			
			// 1. Extract Base64 - handle marker properly
			let base64 = encryptedContent;
			
			// If content starts with the header, remove it
			if (base64.startsWith(ENCRYPTION_HEADER)) {
				base64 = base64.substring(ENCRYPTION_HEADER.length).trim();
			} else if (base64.includes(ENCRYPTION_MARKER)) {
				// Find the first occurrence of the marker and take everything after it
				const markerIndex = base64.indexOf(ENCRYPTION_MARKER);
				base64 = base64.substring(markerIndex + ENCRYPTION_MARKER.length).trim();
				
				// If there are multiple markers (corrupted data), take only the first block
				// Find the next newline or end of first base64 block
				// Base64 strings don't contain newlines typically, so look for the first valid base64 block
				const nextMarkerIndex = base64.indexOf(ENCRYPTION_MARKER);
				if (nextMarkerIndex !== -1) {
					// There's another marker, take only the content before it
					base64 = base64.substring(0, nextMarkerIndex).trim();
				}
			}
			
			// 2. Clean whitespace (strict) - remove all whitespace including newlines
			base64 = base64.trim().replace(/\s+/g, '');
			
			// 3. Handle duplicated encrypted data - extract only the first valid base64 block
			// (We'll validate after extraction to avoid false positives from duplicates)
			// Base64 strings end with = or == padding. If we see padding followed by base64-like characters,
			// it's likely duplicated data. Try to find the first complete base64 block.
			// We know the structure: 16 bytes salt + 12 bytes IV + encrypted data + 16 bytes GCM tag
			// Minimum size is around 44 bytes (16+12+16), which is ~59 base64 characters
			let extractedBase64 = base64;
			
			// Try to find where the first base64 block ends
			// Base64 padding: = means 2 bytes of padding, == means 1 byte of padding
			// Look for padding followed by a character that could start a new base64 string
			
			// First, try double == padding (more definitive)
			// Look for == followed by a base64 character (start of next block)
			const doublePaddingPattern = /==([A-Za-z0-9+\/])/g;
			let doubleMatch;
			let lastMatchIndex = -1;
			
			// Find all occurrences to get the first one
			while ((doubleMatch = doublePaddingPattern.exec(base64)) !== null) {
				if (lastMatchIndex === -1) {
					lastMatchIndex = doubleMatch.index;
				}
			}
			
			if (lastMatchIndex !== -1) {
				// Found == followed by a base64 character - likely duplicated data
				// Extract only up to and including the ==
				extractedBase64 = base64.substring(0, lastMatchIndex + 2);
			} else {
				// Try single = padding - look for = followed immediately by a base64 character
				// This pattern: [base64 char]=[base64 char] indicates end of one block and start of another
				const singlePaddingPattern = /([A-Za-z0-9+\/])=([A-Za-z0-9+\/])/;
				const singleMatch = base64.match(singlePaddingPattern);
				
				if (singleMatch && singleMatch.index !== undefined) {
					// Found = followed by a base64 character - likely duplicated data
					// The match is [char]=[char], so match.index points to the char before =
					// We want to include the =, so we need match.index + 2 (char + =)
					extractedBase64 = base64.substring(0, singleMatch.index + 2);
				} else {
					// Fallback: if the string is suspiciously long (suggests duplication),
					// try to find a reasonable split point
					// A typical encrypted block for small content should be around 100-200 chars
					// If we have much more, it's likely duplicated
					if (base64.length > 300) {
						// Try to find the first occurrence of a pattern that looks like the end
						// Look for = followed by what might be the start of another block
						// We'll take roughly the first third as a heuristic
						const estimatedBlockSize = Math.floor(base64.length / 3);
						// Find the first = near that position
						const searchStart = Math.max(0, estimatedBlockSize - 50);
						const searchEnd = Math.min(base64.length, estimatedBlockSize + 50);
						const searchRegion = base64.substring(searchStart, searchEnd);
						const paddingIndex = searchRegion.indexOf('=');
						
						if (paddingIndex !== -1) {
							const actualIndex = searchStart + paddingIndex;
							// Check if next char is base64-like
							if (actualIndex + 1 < base64.length && /[A-Za-z0-9+\/]/.test(base64[actualIndex + 1])) {
								extractedBase64 = base64.substring(0, actualIndex + 1);
							}
						}
					}
				}
			}
			
			base64 = extractedBase64;
			
			if (!base64) throw new Error('No base64 data found');
			
			// Validate base64 format (should only contain base64 characters and padding)
			// Now that we've extracted just the first block, validation should pass
			if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(base64)) {
				throw new Error('Invalid base64 format: contains invalid characters');
			}

			// 4. Decode
			let combined: Uint8Array;
			try {
				combined = this.base64ToArrayBuffer(base64);
			} catch (e) {
				throw new Error('Invalid Base64 string');
			}

			// 5. Validate Size (16 salt + 12 IV + min 1 byte data = 29, but empty data is possible? Encrypted empty string?)
			// AES-GCM tag is usually 16 bytes, so min size is 16+12+16 = 44 bytes roughly.
			// Let's just check header size.
			if (combined.byteLength < 28) {
				throw new Error('Data too short to contain Salt and IV');
			}

			const salt = combined.slice(0, 16);
			const iv = combined.slice(16, 28);
			const data = combined.slice(28);

			const key = await this.deriveKey(password, salt);
			
			let decrypted: ArrayBuffer;
			try {
				decrypted = await crypto.subtle.decrypt(
					{ name: 'AES-GCM', iv: iv },
					key,
					data
				);
			} catch (decryptError: any) {
				if (decryptError.name === 'OperationError' || decryptError.name === 'InvalidAccessError') {
					throw new Error('Incorrect password or corrupted data');
				}
				throw new Error(`Decryption failed: ${decryptError.message || 'Unknown error'}`);
			}

			const decoder = new TextDecoder();
			const decryptedText = decoder.decode(decrypted);
			
			// Final safety check: decrypted text should not contain the encryption marker
			if (decryptedText.includes(ENCRYPTION_MARKER)) {
				throw new Error('Decryption failed: result contains encryption marker (likely wrong password or corrupted data)');
			}
			
			return decryptedText;
		} catch (error) {
			// Re-throw with more context if it's not already a formatted error
			if (error instanceof Error && !error.message.includes('Decryption failed') && !error.message.includes('Incorrect password')) {
				throw new Error(`Decryption error: ${error.message}`);
			}
			throw error;
		}
	}

	async hashPassword(password: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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

	/**
	 * Show lock overlay for a locked file
	 */
	showLockOverlay(filePath: string): void {
		// Remove any existing overlay for this file
		this.removeLockOverlay(filePath);

		// Try to find the view - check all markdown views, not just active
		let view: MarkdownView | null = null;
		
		// First try active view
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file?.path === filePath) {
			view = activeView;
		} else {
			// Check all open markdown views
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
			console.log('showLockOverlay: View not found or file path mismatch', {
				view: !!view,
				viewFile: view?.file?.path,
				targetPath: filePath
			});
			return;
		}

		// Find the view content container (markdown view content area)
		const viewContent = view.contentEl;
		if (!viewContent) {
			console.log('showLockOverlay: viewContent not found');
			return;
		}

		// Find the actual editor container - we want to overlay ONLY the editor area
		// Try to find .cm-scroller first (the scrollable editor area)
		let container: HTMLElement | null = viewContent.querySelector('.cm-scroller') as HTMLElement;
		
		// If not found, try .cm-editor (the editor wrapper)
		if (!container) {
			container = viewContent.querySelector('.cm-editor') as HTMLElement;
		}
		
		// If still not found, try .markdown-source-view (source mode)
		if (!container) {
			container = viewContent.querySelector('.markdown-source-view') as HTMLElement;
		}
		
		// If still not found, try .markdown-reading-view (reading mode)
		if (!container) {
			container = viewContent.querySelector('.markdown-reading-view') as HTMLElement;
		}
		
		// Last resort: find the editor content area within viewContent
		if (!container) {
			// Look for any element with class containing 'editor' or 'content'
			const editorArea = viewContent.querySelector('[class*="editor"], [class*="content"]') as HTMLElement;
			if (editorArea) {
				container = editorArea;
			}
		}
		
		// Final fallback: use viewContent but only if we can't find anything else
		if (!container) {
			console.log('showLockOverlay: Could not find editor container, using viewContent');
			container = viewContent;
		}
		
		// Ensure container has relative positioning and creates a stacking context
		if (container) {
			const computedStyle = getComputedStyle(container);
			if (computedStyle.position === 'static') {
				container.style.position = 'relative';
			}
			// Create a stacking context to isolate the overlay from affecting other UI elements
			container.style.isolation = 'isolate';
			// Ensure the container doesn't have transform or filter that could affect other elements
			container.style.willChange = 'auto';
		}
		
		if (!container) {
			console.log('showLockOverlay: Could not find container');
			return;
		}

		// Create overlay element
		const overlay = document.createElement('div');
		overlay.className = 'lockdown-overlay';
		overlay.setAttribute('data-file-path', filePath);

		// Create lock icon
		const lockIcon = document.createElement('div');
		lockIcon.className = 'lockdown-overlay-icon';
		lockIcon.textContent = this.settings.lockIcon || '🔒';
		
		// Create message
		const message = document.createElement('div');
		message.className = 'lockdown-overlay-message';
		message.textContent = 'This note is locked';

		// Create unlock button
		const unlockButton = document.createElement('button');
		unlockButton.className = 'lockdown-overlay-button';
		unlockButton.textContent = 'Unlock';
		unlockButton.onclick = async () => {
			await this.unlockFile(filePath);
		};

		overlay.appendChild(lockIcon);
		overlay.appendChild(message);
		overlay.appendChild(unlockButton);

		// Append overlay to container
		container.appendChild(overlay);
		this.lockOverlays.set(filePath, overlay);
	}

	/**
	 * Remove lock overlay for a file
	 */
	removeLockOverlay(filePath: string): void {
		const overlay = this.lockOverlays.get(filePath);
		if (overlay) {
			// Clean up container styles that were set for the overlay
			const container = overlay.parentElement;
			if (container) {
				// Reset isolation style to prevent lingering stacking context issues
				// Only reset if we set it (check if it's 'isolate')
				if (container.style.isolation === 'isolate') {
					container.style.isolation = '';
				}
			}
			overlay.remove();
			this.lockOverlays.delete(filePath);
		}

		// Also remove any orphaned overlays
		const orphanedOverlays = document.querySelectorAll(`.lockdown-overlay[data-file-path="${filePath}"]`);
		orphanedOverlays.forEach(el => {
			// Clean up parent container styles
			const container = el.parentElement;
			if (container && container.style.isolation === 'isolate') {
				container.style.isolation = '';
			}
			el.remove();
		});
	}

	/**
	 * Remove all lock overlays
	 */
	removeAllLockOverlays(): void {
		this.lockOverlays.forEach((overlay) => {
			// Clean up container styles
			const container = overlay.parentElement;
			if (container && container.style.isolation === 'isolate') {
				container.style.isolation = '';
			}
			overlay.remove();
		});
		this.lockOverlays.clear();
		
		// Also remove any orphaned overlays
		const allOverlays = document.querySelectorAll('.lockdown-overlay');
		allOverlays.forEach(el => {
			// Clean up parent container styles
			const container = el.parentElement;
			if (container && container.style.isolation === 'isolate') {
				container.style.isolation = '';
			}
			el.remove();
		});
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

	/**
	 * Update file explorer indicators for locked files and folders
	 * Uses double requestAnimationFrame to ensure DOM is stable before updating
	 */
	updateFileExplorerIndicators(): void {
		if (!this.settings.showFileExplorerIndicators) {
			this.removeAllFileExplorerIndicators();
			return;
		}

		// Use double requestAnimationFrame to ensure DOM is completely stable
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				// Find all file items in the file explorer
				const fileExplorer = document.querySelector('.nav-files-container');
				if (!fileExplorer) return;

				// Get current locked files and folders
				const currentLockedFiles = new Set(this.lockedFiles);
				const currentLockedFolders = new Set(this.lockedFolders);
				
				// Find all existing indicators to see what needs to be removed
				const existingFileIndicators = Array.from(document.querySelectorAll('.lockdown-file-indicator'));
				const existingFolderIndicators = Array.from(document.querySelectorAll('.lockdown-folder-indicator'));
				
				// Remove indicators for files/folders that are no longer locked
				// Use a document fragment to batch removals
				existingFileIndicators.forEach(indicator => {
					const fileItem = indicator.closest('[data-path]') as HTMLElement;
					if (fileItem) {
						const filePath = fileItem.getAttribute('data-path');
						if (filePath && !this.isFileLocked(filePath)) {
							// Remove with a small delay to prevent style recalculation
							setTimeout(() => {
								if (indicator.parentNode) {
									indicator.remove();
								}
							}, 0);
						}
					}
				});
				
				existingFolderIndicators.forEach(indicator => {
					const folderItem = indicator.closest('[data-path]') as HTMLElement;
					if (folderItem) {
						const folderPath = folderItem.getAttribute('data-path');
						if (folderPath && !this.lockedFolders.has(folderPath)) {
							// Remove with a small delay to prevent style recalculation
							setTimeout(() => {
								if (indicator.parentNode) {
									indicator.remove();
								}
							}, 0);
						}
					}
				});

				// Add indicators for locked files (only if they don't exist)
				// Use setTimeout to defer additions
				setTimeout(() => {
					currentLockedFiles.forEach(filePath => {
						const existingIndicator = document.querySelector(`[data-path="${filePath}"] .lockdown-file-indicator`);
						if (!existingIndicator) {
							this.addFileExplorerIndicator(filePath);
						}
					});

					// Add indicators for files in locked folders
					const allFiles = this.app.vault.getMarkdownFiles();
					allFiles.forEach(file => {
						if (this.isFileLocked(file.path) && !currentLockedFiles.has(file.path)) {
							const existingIndicator = document.querySelector(`[data-path="${file.path}"] .lockdown-file-indicator`);
							if (!existingIndicator) {
								this.addFileExplorerIndicator(file.path);
							}
						}
					});

					// Add indicators for locked folders (only if they don't exist)
					currentLockedFolders.forEach(folderPath => {
						const existingIndicator = document.querySelector(`[data-path="${folderPath}"] .lockdown-folder-indicator`);
						if (!existingIndicator) {
							this.addFolderExplorerIndicator(folderPath);
						}
					});
				}, 50);
			});
		});
	}

	/**
	 * Add lock indicator to a folder in the file explorer
	 */
	addFolderExplorerIndicator(folderPath: string): void {
		// Try multiple selectors for folder items
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
					// Check if indicator already exists
					if (titleEl.querySelector('.lockdown-folder-indicator') || 
						titleEl.parentElement?.querySelector('.lockdown-folder-indicator')) {
						return;
					}

					// Create indicator element
					const indicator = document.createElement('span');
					indicator.className = 'lockdown-folder-indicator';
					indicator.textContent = this.settings.lockIcon || '🔒';
					indicator.title = 'Locked folder';
					indicator.style.marginLeft = '4px';
					indicator.style.opacity = '0.8';
					// Ensure indicator doesn't affect parent styling
					indicator.style.background = 'transparent';
					indicator.style.backgroundColor = 'transparent';
					// CRITICAL: Don't capture pointer events - let hover pass through to parent
					indicator.style.pointerEvents = 'none';

					// Insert indicator using requestAnimationFrame to prevent glitching
					requestAnimationFrame(() => {
						const targetEl = titleEl.querySelector('.nav-folder-title-content') || titleEl;
						if (targetEl && !targetEl.querySelector('.lockdown-folder-indicator')) {
							targetEl.appendChild(indicator);
						}
					});
					break;
				}
			}
		}
	}

	/**
	 * Add lock indicator to a file in the file explorer
	 */
	addFileExplorerIndicator(filePath: string): void {
		// Try multiple selectors for file explorer items
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
					// Check if indicator already exists
					if (titleEl.querySelector('.lockdown-file-indicator') || 
						titleEl.parentElement?.querySelector('.lockdown-file-indicator')) {
						return;
					}

					// Create indicator element
					const indicator = document.createElement('span');
					indicator.className = 'lockdown-file-indicator';
					indicator.textContent = this.settings.lockIcon || '🔒';
					indicator.title = 'Locked file';
					indicator.style.marginLeft = '4px';
					indicator.style.opacity = '0.7';
					// Ensure indicator doesn't affect parent styling
					indicator.style.background = 'transparent';
					indicator.style.backgroundColor = 'transparent';
					// CRITICAL: Don't capture pointer events - let hover pass through to parent
					indicator.style.pointerEvents = 'none';
					
					// Check if file is encrypted
					const isEncrypted = this.passwordHashes.has(filePath);
					if (isEncrypted) {
						indicator.title = 'Locked and encrypted file';
						indicator.style.opacity = '1';
					}

					// Insert indicator using requestAnimationFrame to prevent glitching
					requestAnimationFrame(() => {
						const targetEl = titleEl.querySelector('.nav-file-title-content') || titleEl;
						if (targetEl && !targetEl.querySelector('.lockdown-file-indicator')) {
							targetEl.appendChild(indicator);
							this.fileExplorerIndicators.set(filePath, indicator);
						}
					});
					return;
				}
			}
		}
	}

	/**
	 * Remove file explorer indicator for a specific file
	 */
	removeFileExplorerIndicator(filePath: string): void {
		const indicator = this.fileExplorerIndicators.get(filePath);
		if (indicator) {
			indicator.remove();
			this.fileExplorerIndicators.delete(filePath);
		}

		// Also remove any orphaned indicators
		const fileItems = document.querySelectorAll('.nav-file-title');
		for (const item of Array.from(fileItems)) {
			const titleEl = item as HTMLElement;
			const fileTitle = titleEl.getAttribute('data-path');
			if (fileTitle === filePath) {
				const orphaned = titleEl.querySelector('.lockdown-file-indicator');
				if (orphaned) {
					orphaned.remove();
				}
			}
		}
	}

	/**
	 * Remove all file explorer indicators
	 */
	removeAllFileExplorerIndicators(): void {
		// Use requestAnimationFrame to batch DOM updates
		requestAnimationFrame(() => {
			// Remove from tracked map
			this.fileExplorerIndicators.forEach((indicator) => {
				if (indicator && indicator.parentNode) {
					indicator.remove();
				}
			});
			this.fileExplorerIndicators.clear();

			// Also remove any orphaned indicators (files and folders)
			const orphanedFiles = document.querySelectorAll('.lockdown-file-indicator');
			orphanedFiles.forEach(el => {
				if (el.parentNode) {
					el.remove();
				}
			});
			
			const orphanedFolders = document.querySelectorAll('.lockdown-folder-indicator');
			orphanedFolders.forEach(el => {
				if (el.parentNode) {
					el.remove();
				}
			});
		});
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
				private isUpdating: boolean = false;

				constructor(view: EditorView) {
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
													if (!view.dom.isConnected) {
														this.isUpdating = false;
														return;
													}
													
													view.dispatch({
														effects: setLockedEffect.of({ locked: true, content })
													});
													
													// Restore content if needed (defer this too)
													requestAnimationFrame(() => {
														requestAnimationFrame(() => {
															try {
																if (!view.dom.isConnected) {
																	this.isUpdating = false;
																	return;
																}
																
																const currentContent = view.state.doc.toString();
																if (currentContent !== content) {
																	view.dispatch({
																		changes: {
																			from: 0,
																			to: view.state.doc.length,
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
												if (!view.dom.isConnected) {
													this.isUpdating = false;
													return;
												}
												view.dispatch({
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
							const state = view.state.field(lockdownState);
							if (state.locked || state.filePath !== null) {
								// Defer this dispatch too
								requestAnimationFrame(() => {
									requestAnimationFrame(() => {
										try {
											if (!view.dom.isConnected) {
												this.isUpdating = false;
												return;
											}
											view.dispatch({
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
									const view = tr.startState.field(lockdownState, false);
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
		return new Promise((resolve) => {
			const modal = new class extends Modal {
				onOpen() {
					this.contentEl.addClass('lockdown-modal');
					
					// Title with icon
					const titleContainer = this.contentEl.createDiv({ cls: 'lockdown-modal-title-container' });
					titleContainer.createSpan({ text: '🔒', cls: 'lockdown-modal-icon' });
					titleContainer.createEl('h2', { text: 'Lockdown', cls: 'lockdown-modal-title' });
					
					// Message
					this.contentEl.createEl('p', { text: message, cls: 'lockdown-modal-message' });
					
					// Buttons
					this.contentEl.createDiv({ cls: 'lockdown-modal-button-container' }, (container) => {
						const cancelBtn = container.createEl('button', { text: 'Cancel', cls: 'lockdown-modal-button lockdown-modal-button-secondary' });
						cancelBtn.onClickEvent(() => {
							resolve(false);
							this.close();
						});
						
						const confirmBtn = container.createEl('button', { text: 'Confirm', cls: 'lockdown-modal-button lockdown-modal-button-primary' });
						confirmBtn.onClickEvent(() => {
							resolve(true);
							this.close();
						});
					});
				}
			}(this.app);
			modal.open();
		});
	}

	/**
	 * Calculate password strength score (0-100)
	 */
	calculatePasswordStrength(password: string): { score: number; feedback: string } {
		let score = 0;
		const feedback: string[] = [];

		if (password.length === 0) {
			return { score: 0, feedback: 'Enter a password' };
		}

		// Length checks
		if (password.length >= 8) score += 20;
		else feedback.push('Use at least 8 characters');
		
		if (password.length >= 12) score += 10;
		if (password.length >= 16) score += 10;

		// Character variety
		if (/[a-z]/.test(password)) score += 10;
		else feedback.push('Add lowercase letters');
		
		if (/[A-Z]/.test(password)) score += 10;
		else feedback.push('Add uppercase letters');
		
		if (/[0-9]/.test(password)) score += 10;
		else feedback.push('Add numbers');
		
		if (/[^a-zA-Z0-9]/.test(password)) score += 10;
		else feedback.push('Add special characters');

		// Common patterns (penalize)
		if (/(.)\1{2,}/.test(password)) {
			score -= 10;
			feedback.push('Avoid repeated characters');
		}

		// Common words (penalize)
		const commonWords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
		if (commonWords.some(word => password.toLowerCase().includes(word))) {
			score -= 20;
			feedback.push('Avoid common words');
		}

		score = Math.max(0, Math.min(100, score));

		let strengthText = '';
		if (score < 30) strengthText = 'Weak';
		else if (score < 60) strengthText = 'Fair';
		else if (score < 80) strengthText = 'Good';
		else strengthText = 'Strong';

		return {
			score,
			feedback: feedback.length > 0 ? `${strengthText}. ${feedback[0]}` : strengthText
		};
	}

	async promptPassword(message: string, isNewPassword: boolean): Promise<string | undefined> {
		const plugin = this;
		return new Promise((resolve) => {
			const modal = new class extends Modal {
				passwordInput: HTMLInputElement;
				confirmInput: HTMLInputElement | null = null;
				confirmBtn: HTMLButtonElement;
				strengthMeter: HTMLElement | null = null;
				strengthText: HTMLElement | null = null;

				onOpen() {
					this.contentEl.addClass('lockdown-modal', 'lockdown-password-modal');
					
					// Title with icon
					const titleContainer = this.contentEl.createDiv({ cls: 'lockdown-modal-title-container' });
					titleContainer.createSpan({ text: '🔐', cls: 'lockdown-modal-icon' });
					titleContainer.createEl('h2', { text: 'Password Required', cls: 'lockdown-modal-title' });
					
					// Message
					this.contentEl.createEl('p', { text: message, cls: 'lockdown-modal-message' });
					
					// Password input container
					const passwordContainer = this.contentEl.createDiv({ cls: 'lockdown-input-container' });
					const passwordLabel = passwordContainer.createEl('label', { 
						text: 'Password', 
						attr: { for: 'lockdown-password' },
						cls: 'lockdown-input-label'
					});
					this.passwordInput = passwordContainer.createEl('input', {
						type: 'password',
						attr: { id: 'lockdown-password', placeholder: 'Enter your password' },
						cls: 'lockdown-password-input'
					});

					// Password strength indicator (only for new passwords)
					if (isNewPassword) {
						const strengthContainer = passwordContainer.createDiv({ cls: 'lockdown-password-strength-container' });
						const strengthBarContainer = strengthContainer.createDiv({ cls: 'lockdown-password-strength-bar-container' });
						this.strengthMeter = strengthBarContainer.createDiv({ cls: 'lockdown-password-strength-meter' });
						this.strengthText = strengthContainer.createDiv({ cls: 'lockdown-password-strength-text' });
						
						this.passwordInput.oninput = () => {
							const password = this.passwordInput.value;
							const strength = plugin.calculatePasswordStrength(password);
							this.updateStrengthIndicator(strength);
						};
					}
					
					// Confirm password input (only for new passwords)
					if (isNewPassword) {
						const confirmContainer = this.contentEl.createDiv({ cls: 'lockdown-input-container' });
						const confirmLabel = confirmContainer.createEl('label', { 
							text: 'Confirm Password', 
							attr: { for: 'lockdown-confirm' },
							cls: 'lockdown-input-label'
						});
						this.confirmInput = confirmContainer.createEl('input', {
							type: 'password',
							attr: { id: 'lockdown-confirm', placeholder: 'Re-enter your password' },
							cls: 'lockdown-password-input'
						});
					}
					
					// Buttons
					this.contentEl.createDiv({ cls: 'lockdown-modal-button-container' }, (container) => {
						const cancelBtn = container.createEl('button', { 
							text: 'Cancel', 
							cls: 'lockdown-modal-button lockdown-modal-button-secondary'
						});
						cancelBtn.onClickEvent(() => {
							resolve(undefined);
							this.close();
						});
						
						this.confirmBtn = container.createEl('button', { 
							text: 'Confirm', 
							cls: 'lockdown-modal-button lockdown-modal-button-primary'
						});
						this.confirmBtn.onClickEvent(() => {
							const password = this.passwordInput.value;
							if (!password) {
								new Notice('Password cannot be empty');
								return;
							}
							if (isNewPassword && this.confirmInput && password !== this.confirmInput.value) {
								new Notice('Passwords do not match');
								return;
							}
							resolve(password);
							this.close();
						});
					});
					
					// Focus password input and handle Enter key
					this.passwordInput.focus();
					this.passwordInput.onkeydown = (e) => {
						if (e.key === 'Enter') {
							if (isNewPassword && this.confirmInput) {
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

				updateStrengthIndicator(strength: { score: number; feedback: string }) {
					if (!this.strengthMeter || !this.strengthText) return;

					// Update meter width and color
					this.strengthMeter.style.width = `${strength.score}%`;
					
					// Update color based on strength
					this.strengthMeter.className = 'lockdown-password-strength-meter';
					if (strength.score < 30) {
						this.strengthMeter.classList.add('strength-weak');
					} else if (strength.score < 60) {
						this.strengthMeter.classList.add('strength-fair');
					} else if (strength.score < 80) {
						this.strengthMeter.classList.add('strength-good');
					} else {
						this.strengthMeter.classList.add('strength-strong');
					}

					// Update text
					this.strengthText.textContent = strength.feedback;
					this.strengthText.className = 'lockdown-password-strength-text';
					if (strength.score < 30) {
						this.strengthText.classList.add('strength-weak');
					} else if (strength.score < 60) {
						this.strengthText.classList.add('strength-fair');
					} else if (strength.score < 80) {
						this.strengthText.classList.add('strength-good');
					} else {
						this.strengthText.classList.add('strength-strong');
					}
				}
			}(this.app);
			modal.open();
		});
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

		const renderFiles = (filter: string = '') => {
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
				const pathEl = fileItem.createEl('div', { cls: 'lockdown-file-path', text: filePath });
				
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
					const pathEl = folderItem.createEl('div', { cls: 'lockdown-file-path', text: folderPath });
					
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

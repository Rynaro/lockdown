# Changelog

All notable changes to Lockdown will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.1] - 2025-12-03

### 🔧 Fixed
- Fix settings heading: Remove "Settings" word and plugin name, use sentence case
- Ensure all UI text follows sentence case guidelines

## [0.16.0] - 2025-12-03

### 🔧 Fixed
- Address all Obsidian Bot review feedback
- Remove plugin ID prefix from command IDs (Obsidian handles namespacing)
- Fix promise handling in callbacks and event handlers
- Remove async from event handlers that don't use await
- Convert all UI text to sentence case
- Replace direct style manipulation with CSS classes for better theming
- Use Setting.setHeading() instead of createEl for settings heading
- Add descriptive comment to eslint-disable directive
- Remove unused error variables

## [0.15.17] - 2025-12-02

### 🔧 Fixed
- Update manifest description to match Obsidian plugin submission requirements

## [0.15.16] - 2025-12-02

### 🚧 Beta Release

An early release of Lockdown for Obsidian - architecture and features are still being refined.

### ✨ Features

#### Core Security
- **AES-256-GCM Encryption** - Military-grade encryption for your sensitive notes
- **PBKDF2-SHA512 Key Derivation** - 1,000,000 iterations for maximum password security
- **Individual File Locking** - Lock any note with a unique password
- **Folder Locking** - Protect entire folders at once
- **Root Password Support** - Use one master password for all files
- **Password Management** - Change file passwords without data loss
- **Automatic Backups** - Backups created before encryption

#### User Interface
- **Lock Overlay** - Beautiful full-screen lock when viewing protected notes
- **Modern Modals** - Sleek password prompts with animations
- **Password Strength Indicator** - Real-time feedback on password quality
- **Status Bar Integration** - Quick-glance lock status
- **File Explorer Indicators** - See locked files in the sidebar
- **Smooth Animations** - Polished transitions throughout

#### Advanced Features
- **Locked Files Manager** - Manage all protected files from one modal
- **Session Timeout** - Auto-lock after inactivity
- **Bulk Operations** - Unlock all files at once
- **Context Menus** - Right-click to lock/unlock
- **Command Palette Integration** - All features accessible via commands
- **Configurable Settings** - Customize behavior to your needs

### 🎨 UI/UX Improvements
- Beautiful gradient password strength meter
- Icon animations and glowing effects
- Empty state designs for locked files manager
- Responsive modals with proper spacing
- Theme-compatible (light and dark modes)

### 🔐 Security Features
- Zero plain-text password storage
- Secure password hashing (SHA-512)
- Memory-only root password cache
- Encrypted content markers
- Verification before writing encrypted data

### ⚡ Performance
- Instant lock/unlock operations
- No impact on Obsidian performance
- Optimized encryption/decryption
- Efficient DOM manipulation
- Proper cleanup and memory management

### 📝 Documentation
- Comprehensive README
- Contributing guidelines
- Code of conduct
- Development setup guide
- Security best practices

---

## [Unreleased]

### Planned Features
- 📱 Mobile support (iOS/Android)
- 🔗 Secure sync integration
- 🎨 Custom overlay themes
- ⌨️ Customizable keyboard shortcuts
- 🌐 Multi-language support
- 📊 Security dashboard

---

## Version History

### Versioning Scheme

We use [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality additions
- **PATCH** version for backwards-compatible bug fixes

### Categories

- `Added` for new features
- `Changed` for changes in existing functionality
- `Deprecated` for soon-to-be removed features
- `Removed` for removed features
- `Fixed` for bug fixes
- `Security` for vulnerability fixes

---

[0.16.1]: https://github.com/Rynaro/lockdown/releases/tag/0.16.1
[0.16.0]: https://github.com/Rynaro/lockdown/releases/tag/0.16.0
[0.15.17]: https://github.com/Rynaro/lockdown/releases/tag/0.15.17
[0.15.16]: https://github.com/Rynaro/lockdown/releases/tag/0.15.16
[Unreleased]: https://github.com/Rynaro/lockdown/compare/0.16.1...HEAD

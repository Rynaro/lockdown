<div align="center">

<img width="240" height="240" alt="image" src="https://github.com/user-attachments/assets/a1eb2a71-9a12-4b42-a1ef-64dd298314b4" />


# Lockdown

**Lock your Markdown files in Obsidian**

*Military-grade encryption meets beautiful UX*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.16.1-blue.svg)](https://github.com/Rynaro/lockdown/releases)

</div>

## Why Lockdown?

Secure your sensitive notes with **AES-256-GCM encryption**. Perfect for journals, passwords, financial info, or any private content you want to protect.

**Key Features:**
- 🔐 **Military-grade encryption** - AES-256-GCM with PBKDF2
- 🎨 **Beautiful UI** - Elegant lock overlays and modern password prompts
- ⚡ **Blazing fast** - Instant lock/unlock operations
- 📁 **Flexible** - Lock individual files or entire folders
- 🔑 **Root password** - Optional master password for all files

---

## Installation

### From Community Plugins (Recommended)

1. Open **Settings** → **Community Plugins**
2. Click **Browse** and search for "Lockdown"
3. Click **Install**, then **Enable**

### Manual Installation

1. **Download** the latest release from [GitHub Releases](https://github.com/Rynaro/lockdown/releases)
2. **Extract** `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/lockdown/` folder
3. **Reload** Obsidian (Cmd/Ctrl + R or restart the app)
4. **Enable** the plugin in **Settings** → **Community Plugins** → Enable "Lockdown"

---

## Quick Start

### Lock a File

```
1. Open any note
2. Cmd/Ctrl + P → "Lock current file"
3. Enter password
```

### Unlock a File

```
1. Click locked file
2. Click "Unlock" button
3. Enter password
```

### Use Root Password (Optional)

```
Cmd/Ctrl + P → "Set root password"
```

All future locks will use this master password.

---

## Features

### Security
- **AES-256-GCM** encryption
- **PBKDF2-SHA512** key derivation (1M iterations)
- **Zero plain-text** password storage
- **Session timeout** for auto-locking

### Functionality
- Lock individual files
- Lock entire folders
- Change file passwords
- Bulk unlock operations
- Automatic backups

### User Interface
- Beautiful lock overlay
- Password strength indicator
- File explorer indicators
- Status bar integration
- Locked files manager

---

## Configuration

**Settings** → **Lockdown**

| Setting | Description | Default |
|---------|-------------|---------|
| Lock Icon | Icon for locked files | 🔒 |
| Use Encryption | Enable AES-256 encryption | ✅ |
| Show Status Bar | Display lock status | ✅ |
| Show File Explorer Indicators | Lock icons in sidebar | ✅ |
| Session Timeout | Auto-lock after inactivity (min) | 0 (off) |
| Enable Backup | Backup before encryption | ✅ |

---

## Security

### Encryption Details

- **Algorithm**: AES-256-GCM
- **Key Derivation**: PBKDF2-SHA512 (1,000,000 iterations)
- **Salt**: 128-bit random per file
- **IV**: 96-bit random per encryption

### What's Encrypted?

✅ All file content and metadata  
❌ File names and folder structure

### ⚠️ Important

**If you forget your password, your data is unrecoverable.** There are no backdoors or password recovery mechanisms.

**Best Practices:**
- Use strong, memorable passwords (12+ characters)
- Consider a password manager for root password
- Keep backups of important files

---

## Commands

| Command | Description |
|---------|-------------|
| Lock current file | Lock the active note |
| Unlock current file | Unlock the active note |
| Toggle lock | Lock/unlock current note |
| Set root password | Set master password |
| Change password | Change file's password |
| Lock folder | Lock entire folder |
| Unlock folder | Unlock entire folder |
| Show locked files manager | Manage all locked files |
| Unlock all files | Bulk unlock |

---

## Building from Source

```bash
git clone https://github.com/Rynaro/lockdown.git
cd lockdown
npm install
npm run build
```

Development mode:
```bash
npm run dev
```

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open Pull Request

---

## Roadmap

- [ ] Biometric unlock
- [ ] Sync integration
- [ ] Custom keyboard shortcuts
- [ ] Multi-language support
- [ ] Inline encrypted blocks

---

## License

MIT License - see [LICENSE](LICENSE) for details.

**TL;DR:** Free to use, modify, and distribute.

---

## Acknowledgments

- **Obsidian Team** - For the amazing platform
- **Contributors** - Everyone who helps improve Lockdown
- **You** - For trusting Lockdown with your sensitive notes

---

<div align="center">

**Made with ❤️ for the Obsidian community**

[Report Bug](https://github.com/Rynaro/lockdown/issues) • [Request Feature](https://github.com/Rynaro/lockdown/issues) • [Discussions](https://github.com/Rynaro/lockdown/discussions)

</div>

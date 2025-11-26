# Contributing to Lockdown

First off, thank you for considering contributing to Lockdown! 🎉

It's people like you that make Lockdown such a great tool. We welcome contributions from everyone, whether it's:

- 🐛 Reporting bugs
- 💡 Suggesting new features
- 📝 Improving documentation
- 🔧 Submitting code changes
- 🎨 Improving UI/UX

## 📋 Table of Contents

- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)
- [Community](#community)

## 🤝 How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [existing issues](https://github.com/Rynaro/lockdown/issues) to avoid duplicates.

When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the behavior
- **Expected vs actual behavior**
- **Screenshots** if applicable
- **Environment details**:
  - Obsidian version
  - Operating system
  - Lockdown plugin version
  - Any error messages from console

**Use the bug report template** when creating a new issue.

### Suggesting Features

Feature suggestions are welcome! Before creating a feature request:

1. **Check if it already exists** in the issues
2. **Provide a clear use case** - why would this be useful?
3. **Describe the solution** you'd like to see
4. **Consider alternatives** - are there other ways to achieve this?

**Use the feature request template** when creating a new issue.

### Code Contributions

Want to contribute code? Great! Here's how:

1. **Fork the repository**
2. **Create a feature branch** from `main`
3. **Make your changes**
4. **Test thoroughly**
5. **Submit a pull request**

## 🛠️ Development Setup

### Prerequisites

- Node.js 16+ and npm
- Obsidian (for testing)
- Git

### Setup Steps

```bash
# 1. Fork and clone the repository
git clone https://github.com/Rynaro/lockdown.git
cd lockdown

# 2. Install dependencies
npm install

# 3. Build the plugin
npm run build

# 4. Link to your Obsidian vault for testing
# Create a symbolic link from the built plugin to your vault's plugins folder
ln -s $(pwd) /path/to/your/vault/.obsidian/plugins/lockdown

# 5. Enable the plugin in Obsidian
# Settings → Community Plugins → Enable Lockdown
```

### Development Workflow

```bash
# Development mode (auto-rebuild on changes)
npm run dev

# Build for production
npm run build

# Type check only (no build)
npm run check
```

### Testing Your Changes

1. Make changes to the code
2. Reload Obsidian (Ctrl/Cmd + R)
3. Test the functionality thoroughly
4. Check for errors in Developer Console (Ctrl/Cmd + Shift + I)
5. Test in both light and dark themes
6. Test with different file types and sizes

## 🔄 Pull Request Process

### Before Submitting

- [ ] Code builds without errors (`npm run build`)
- [ ] Changes are tested in Obsidian
- [ ] No console errors or warnings
- [ ] Code follows the style guidelines
- [ ] Commits have clear, descriptive messages
- [ ] Documentation is updated if needed

### Submitting

1. **Update documentation** if you're changing functionality
2. **Write clear commit messages**:
   ```
   ✨ Add new feature
   🐛 Fix bug in encryption
   📝 Update documentation
   🎨 Improve UI design
   ♻️ Refactor code
   ```
3. **Create a pull request** with:
   - Clear title describing the change
   - Description of what changed and why
   - Screenshots/GIFs if UI changed
   - Link to related issues

### Review Process

1. Maintainers will review your PR
2. Feedback may be provided for improvements
3. Once approved, your PR will be merged
4. You'll be added to the contributors list! 🎉

## 📐 Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Follow existing code style
- Use meaningful variable names
- Add comments for complex logic
- Prefer `const` over `let`
- Use async/await instead of promises chains

### Code Example

```typescript
// Good ✅
async function encryptContent(content: string, password: string): Promise<string> {
  // Validate inputs
  if (!content || !password) {
    throw new Error('Content and password are required');
  }
  
  // Encrypt with AES-256-GCM
  const encrypted = await this.performEncryption(content, password);
  return encrypted;
}

// Avoid ❌
async function enc(c: string, p: string) {
  return this.encrypt(c, p); // No validation, unclear names
}
```

### CSS

- Use CSS variables for colors
- Follow BEM-like naming: `.lockdown-component-element`
- Group related styles together
- Add comments for complex layouts

### Git Commits

Use conventional commit messages:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc)
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

Example:
```
feat: add folder locking support
fix: prevent double encryption on save
docs: update installation instructions
```

## 🏗️ Project Structure

```
lockdown/
├── main.ts              # Plugin entry point & core logic
├── styles.css           # All styling
├── manifest.json        # Plugin metadata
├── esbuild.config.mjs   # Build configuration
├── tsconfig.json        # TypeScript config
├── package.json         # Dependencies
└── README.md           # Main documentation
```

### Key Files

- **main.ts**: Contains all plugin logic - classes, encryption, UI
- **styles.css**: All styles - modals, overlays, indicators
- **manifest.json**: Plugin metadata shown in Obsidian

## 🧪 Testing Checklist

Before submitting, test these scenarios:

### Core Functionality
- [ ] Lock a file with a password
- [ ] Unlock a locked file
- [ ] Change a file's password
- [ ] Lock/unlock folders
- [ ] Root password works correctly

### Edge Cases
- [ ] Lock empty file
- [ ] Lock very large file (10MB+)
- [ ] Rapid lock/unlock
- [ ] Switch between locked files quickly
- [ ] Lock file, close Obsidian, reopen

### UI/UX
- [ ] Overlay appears correctly
- [ ] Modals are centered and responsive
- [ ] Animations are smooth
- [ ] Works in light theme
- [ ] Works in dark theme
- [ ] Status bar updates correctly
- [ ] File explorer indicators show correctly

### Security
- [ ] Wrong password shows error
- [ ] Encrypted files can't be read in text editor
- [ ] Password strength indicator works
- [ ] Session timeout works (if enabled)

## 💬 Community

### Where to Get Help

- **GitHub Discussions**: Ask questions, share ideas
- **GitHub Issues**: Report bugs, request features
- **Code Review**: Learn from PR reviews
- **Documentation**: Check README and inline help

### Communication Guidelines

- **Be respectful** and constructive
- **Be patient** - maintainers are volunteers
- **Be clear** - provide context and details
- **Be helpful** - assist others when you can

## 🎉 Recognition

Contributors are recognized in:

- GitHub contributors page
- README acknowledgments
- Release notes for significant contributions

## 📝 License

By contributing to Lockdown, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

Thank you for contributing to Lockdown! 🔒✨

Your efforts help make secure note-taking better for everyone in the Obsidian community.

**Questions?** Open a discussion or reach out to the maintainers.

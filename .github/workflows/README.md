# GitHub Actions Workflows

This directory contains CI/CD workflows for the Lockdown plugin.

## Workflows

### 1. `lint.yml` - Code Quality & Linting

**Triggers:** Push to `main`/`develop`, Pull requests to `main`/`develop`

**Purpose:** Comprehensive code quality checks with detailed metrics and reporting.

**Checks:**
- ✅ **TypeScript Type Checking** - Ensures no type errors
- ✅ **ESLint Validation** - Code style and best practices
- ✅ **Architectural Rules** - Enforces layered architecture
  - Core layer cannot import from upper layers
  - Core layer cannot import Obsidian
  - Dependency flow is inward only
- ✅ **Code Metrics** - Tracks files per layer and LOC

**Features:**
- Detailed error reports in GitHub summaries
- JSON reports uploaded as artifacts (30-day retention)
- Automatic PR comments with results
- Color-coded status indicators
- Metrics table by architecture layer

**Local Commands:**
```bash
npm run lint        # Check linting
npm run lint:fix    # Auto-fix issues
npm run type-check  # TypeScript only
npm run validate    # Run all checks
```

### 2. `pr-checks.yml` - PR Quality Gate

**Triggers:** Pull request events (opened, synchronize, reopened, ready_for_review)

**Purpose:** Quality gate for pull requests with comprehensive metrics.

**Checks:**
- ✅ **Full Validation** - TypeScript + ESLint
- ✅ **Build Test** - Ensures plugin builds successfully
- ✅ **PR Size Analysis** - Tracks complexity
  - 🟢 Small: < 100 lines (easy to review)
  - 🟡 Medium: 100-500 lines
  - 🟠 Large: 500-1000 lines
  - 🔴 Very Large: > 1000 lines (consider breaking down)
- ✅ **Commit Quality** - Conventional commits compliance
- ✅ **Security Checks** - Detects potential issues
  - Password/secret logging
  - localStorage usage review

**Features:**
- Automatic PR summary comment
- Files/lines changed statistics
- Commit message format validation
- Security issue warnings

**Best Practices:**
- Keep PRs small (< 500 lines when possible)
- Use conventional commit format
- Avoid logging sensitive data
- Review security warnings

### 3. `release.yml` - Build and Package

**Triggers:** Push to `main` branch

**Purpose:** Build plugin and create artifacts for every commit to main.

**Outputs:**
- `main.js` - Compiled plugin
- `manifest.json` - Plugin metadata
- `styles.css` - Plugin styles
- `lockdown-{sha}.zip` - Release package

**Artifact Retention:** 90 days

### 4. `release-tag.yml` - Create Release

**Triggers:** Version tags (`v*.*.*`)

**Purpose:** Create GitHub releases with changelog and download links.

**Features:**
- Version verification (tag matches manifest.json)
- Automatic changelog extraction
- Multiple download formats
- Installation instructions in release notes
- Auto-generated release notes

**Usage:**
```bash
# Create a release
npm run version      # Update version
git add manifest.json versions.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push --tags
```

## Architecture Enforcement

### Core Layer Rules

The `lint.yml` workflow enforces architectural purity:

```typescript
// ❌ NOT ALLOWED in src/core/**
import { Plugin } from 'obsidian';
import { something } from '../application/...';
import { something } from '../infrastructure/...';
import { something } from '../ui/...';

// ✅ ALLOWED in src/core/**
import { OtherCore } from './OtherCore';
import { Model } from '../model/Model';
```

**Why?**
- Core domain must be framework-independent
- Easy to test without Obsidian
- Easy to port to other platforms
- Clear dependency flow

### Quality Metrics

Tracked in every lint run:

| Metric | Description |
|--------|-------------|
| Files per Layer | Core, Application, Infrastructure, UI |
| Lines of Code | Modular vs Main plugin |
| Type Check Status | Pass/Fail with error details |
| ESLint Status | Errors + Warnings count |
| Architecture Violations | Core layer purity check |

## Local Development

### Before Committing

Run these commands locally to catch issues early:

```bash
# Quick check
npm run validate

# Fix auto-fixable issues
npm run lint:fix

# Full build test
npm run build
```

### Pre-commit Hook (Recommended)

Create `.git/hooks/pre-commit`:

```bash
#!/bin/sh
npm run validate
if [ $? -ne 0 ]; then
  echo "❌ Linting failed. Please fix errors before committing."
  exit 1
fi
```

Make it executable:
```bash
chmod +x .git/hooks/pre-commit
```

## Workflow Status Badges

Add to README.md:

```markdown
[![Lint](https://github.com/your-username/lockdown/actions/workflows/lint.yml/badge.svg)](https://github.com/your-username/lockdown/actions/workflows/lint.yml)
[![Build](https://github.com/your-username/lockdown/actions/workflows/release.yml/badge.svg)](https://github.com/your-username/lockdown/actions/workflows/release.yml)
```

## Troubleshooting

### Workflow Fails on Architectural Rules

**Error:** "Found Obsidian imports in core domain"

**Fix:** Move Obsidian-dependent code to infrastructure layer.

```typescript
// Before (in src/core/)
import { App } from 'obsidian';

// After (move to src/infrastructure/)
// Create wrapper in infrastructure layer
```

### Workflow Fails on TypeScript

**Error:** Type check failed

**Fix:**
```bash
npm run type-check  # See errors locally
# Fix type errors
npm run build       # Verify fix
```

### Workflow Fails on ESLint

**Error:** Linting errors

**Fix:**
```bash
npm run lint        # See errors
npm run lint:fix    # Auto-fix
npm run lint        # Verify remaining issues
```

## Maintenance

### Updating Node Version

When updating Node.js version, update in all workflows:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '18'  # ← Update this
    cache: 'npm'
```

### Updating Actions

Keep actions up to date:
- `actions/checkout@v4`
- `actions/setup-node@v4`
- `actions/upload-artifact@v4`
- `actions/github-script@v7`
- `softprops/action-gh-release@v1`

Check for updates: https://github.com/actions

## Performance

All workflows use:
- ✅ `npm ci` (faster, reproducible)
- ✅ npm cache (speeds up installs)
- ✅ Parallel jobs where possible
- ✅ Conditional execution (draft PRs skipped)
- ✅ Artifact retention limits

Typical execution times:
- `lint.yml`: ~2-3 minutes
- `pr-checks.yml`: ~2-3 minutes
- `release.yml`: ~2 minutes
- `release-tag.yml`: ~3 minutes

## Security

- ✅ Workflows run in isolated environments
- ✅ `GITHUB_TOKEN` is automatically provided
- ✅ Artifacts have retention limits
- ✅ No sensitive data in workflow logs
- ✅ Security checks for password logging

## Contributing

When adding new workflows:
1. Follow existing patterns (actions@v4, Node 18, npm ci)
2. Add descriptive summaries with `$GITHUB_STEP_SUMMARY`
3. Include error handling and validation
4. Add metrics and status indicators
5. Document in this README

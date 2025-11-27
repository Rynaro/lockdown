# CSS Architecture Documentation

## Overview

The Lockdown plugin CSS follows **BEM (Block Element Modifier)** methodology for maximum maintainability, scalability, and isolation. This document explains the architecture, naming conventions, and provides migration guides.

---

## Table of Contents

1. [BEM Methodology](#bem-methodology)
2. [Naming Convention](#naming-convention)
3. [Design Tokens (CSS Variables)](#design-tokens)
4. [Component Catalog](#component-catalog)
5. [Migration Guide](#migration-guide)
6. [Best Practices](#best-practices)
7. [File Organization](#file-organization)

---

## BEM Methodology

### What is BEM?

BEM stands for **Block Element Modifier**:

- **Block**: Standalone, independent component (`ld-modal`, `ld-overlay`)
- **Element**: Part of a block that has no meaning outside of it (`ld-modal__title`, `ld-overlay__icon`)
- **Modifier**: A variant or state of a block or element (`ld-button--primary`, `ld-modal--password`)

### Why BEM?

✅ **Isolation**: Components don't conflict with each other or Obsidian's styles  
✅ **Reusability**: Clear component boundaries make reuse easier  
✅ **Maintainability**: Easy to find and understand styles  
✅ **Scalability**: Grows cleanly as the codebase expands  
✅ **No Specificity Wars**: Flat structure with consistent specificity  

---

## Naming Convention

### Prefix

All Lockdown classes use the **`ld-`** prefix to avoid conflicts:

```css
.ld-modal      /* ✅ Good - namespaced */
.modal         /* ❌ Bad - conflicts with Obsidian */
```

### Structure

```
.ld-block__element--modifier
 │   │      │        │
 │   │      │        └─ Variation (optional)
 │   │      └────────── Part of block (optional)
 │   └───────────────── Component name
 └───────────────────── Namespace prefix
```

### Examples

```css
/* Block */
.ld-modal

/* Element */
.ld-modal__title
.ld-modal__button-container
.ld-modal__icon

/* Modifier */
.ld-modal--password
.ld-modal--manager

/* Element with Modifier */
.ld-button--primary
.ld-button--warning
.ld-password-strength__meter--weak
```

### Rules

1. **Use lowercase** for all names
2. **Use hyphens** (`-`) for compound words in blocks/elements
3. **Use double underscores** (`__`) to separate elements from blocks
4. **Use double hyphens** (`--`) to separate modifiers from blocks/elements
5. **Avoid nesting** beyond 3 levels (`.ld-block__element__sub-element` ❌)
6. **No IDs**: Always use classes
7. **Semantic names**: Describe what it IS, not what it LOOKS LIKE

```css
/* ✅ Good - semantic */
.ld-button--primary
.ld-button--warning

/* ❌ Bad - presentational */
.ld-button--blue
.ld-button--red
```

---

## Design Tokens

All magic numbers and colors are extracted to CSS variables (design tokens) for consistency and easy theming.

### Spacing Scale

```css
--ld-space-xs: 4px;
--ld-space-sm: 8px;
--ld-space-md: 12px;
--ld-space-lg: 16px;
--ld-space-xl: 20px;
--ld-space-2xl: 24px;
--ld-space-3xl: 32px;
--ld-space-4xl: 40px;
--ld-space-5xl: 60px;
```

### Typography Scale

```css
--ld-text-xs: 12px;
--ld-text-sm: 13px;
--ld-text-base: 14px;
--ld-text-md: 15px;
--ld-text-lg: 16px;
--ld-text-xl: 24px;
--ld-text-2xl: 32px;
--ld-text-3xl: 80px;
--ld-text-4xl: 120px;
```

### Border Radius

```css
--ld-radius-sm: 4px;
--ld-radius-md: 6px;
--ld-radius-lg: 8px;
```

### Transitions

```css
--ld-transition-fast: 0.15s ease;
--ld-transition-base: 0.2s ease;
--ld-transition-slow: 0.3s ease;
--ld-transition-slower: 0.4s ease;
```

### Shadows

```css
--ld-shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.15);
--ld-shadow-md: 0 2px 8px rgba(0, 0, 0, 0.15);
--ld-shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.15);
--ld-shadow-xl: 0 4px 16px rgba(0, 0, 0, 0.2);
```

### Usage

```css
/* ✅ Good - using design tokens */
.ld-button {
	padding: var(--ld-space-md);
	border-radius: var(--ld-radius-lg);
	transition: all var(--ld-transition-base);
}

/* ❌ Bad - magic numbers */
.ld-button {
	padding: 12px;
	border-radius: 8px;
	transition: all 0.2s;
}
```

---

## Component Catalog

### 1. Modal (`.ld-modal`)

**Purpose**: Base component for all modals in the plugin.

**Structure**:
```
.ld-modal
├── .ld-modal__title-container
│   ├── .ld-modal__icon
│   └── .ld-modal__title
├── .ld-modal__message
└── .ld-modal__button-container
    └── .ld-button (multiple)
```

**Modifiers**:
- `.ld-modal--password` - Wider modal for password input
- `.ld-modal--manager` - Full-width manager modal

**Usage**:
```typescript
modal.contentEl.addClass('ld-modal', 'ld-modal--password');
```

---

### 2. Button (`.ld-button`)

**Purpose**: Reusable button component.

**Modifiers**:
- `.ld-button--primary` - Primary action (accent color)
- `.ld-button--secondary` - Secondary action (neutral)
- `.ld-button--warning` - Destructive action (red)

**Usage**:
```typescript
const button = createEl('button', { 
	cls: 'ld-button ld-button--primary' 
});
```

---

### 3. Input (`.ld-input`)

**Purpose**: Form input fields (text, password, search).

**Structure**:
```
.ld-input-container
├── .ld-input__label
└── .ld-input
```

**Modifiers**:
- `.ld-input--password` - Password-specific styles
- `.ld-input--search` - Search-specific styles

**Usage**:
```typescript
const input = createEl('input', { 
	cls: 'ld-input ld-input--password',
	type: 'password'
});
```

---

### 4. Overlay (`.ld-overlay`)

**Purpose**: Full-screen overlay shown when a note is locked.

**Structure**:
```
.ld-overlay
├── .ld-overlay__icon
├── .ld-overlay__message
└── .ld-overlay__button
```

**Usage**:
```typescript
const overlay = createDiv({ cls: 'ld-overlay' });
const icon = createDiv({ cls: 'ld-overlay__icon', text: '🔒' });
const message = createDiv({ cls: 'ld-overlay__message', text: 'Locked' });
const button = createEl('button', { cls: 'ld-overlay__button', text: 'Unlock' });
```

---

### 5. File Explorer Indicator (`.ld-file-explorer-indicator`)

**Purpose**: Lock icons in the file explorer sidebar.

**Modifiers**:
- `.ld-file-explorer-indicator--folder` - Folder indicator variant

**Usage**:
```typescript
const indicator = createSpan({ 
	cls: 'ld-file-explorer-indicator',
	text: '🔒'
});

// For folders
indicator.addClass('ld-file-explorer-indicator--folder');
```

---

### 6. Empty State (`.ld-empty-state`)

**Purpose**: Displayed when there are no items to show.

**Structure**:
```
.ld-empty-state
├── .ld-empty-state__icon
└── .ld-empty-state__message
```

**Usage**:
```typescript
const emptyState = createDiv({ cls: 'ld-empty-state' });
emptyState.createDiv({ cls: 'ld-empty-state__icon', text: '🔓' });
emptyState.createDiv({ cls: 'ld-empty-state__message', text: 'No locked files' });
```

---

### 7. Manager (`.ld-manager`)

**Purpose**: Locked files manager modal components.

**Elements**:
- `.ld-manager__tabs` - Tab container
- `.ld-manager__tab` - Individual tab
- `.ld-manager__tab--active` - Active tab state
- `.ld-manager__search-container` - Search input container
- `.ld-manager__files-list` - Scrollable files list
- `.ld-manager__bulk-actions` - Bulk action buttons

**Usage**:
```typescript
const modal = createDiv({ cls: 'ld-modal ld-modal--manager' });
const tabs = modal.createDiv({ cls: 'ld-manager__tabs' });
const tab = tabs.createEl('button', { 
	cls: 'ld-manager__tab ld-manager__tab--active',
	text: 'Files' 
});
```

---

### 8. File Item (`.ld-file-item`)

**Purpose**: Individual file in the manager list.

**Structure**:
```
.ld-file-item
├── .ld-file-item__name
├── .ld-file-item__path
├── .ld-file-item__status
└── .ld-file-item__actions
```

**Usage**:
```typescript
const item = createDiv({ cls: 'ld-file-item' });
item.createDiv({ cls: 'ld-file-item__name', text: 'Note.md' });
item.createDiv({ cls: 'ld-file-item__path', text: 'folder/Note.md' });
item.createDiv({ cls: 'ld-file-item__status', text: '🔒' });
const actions = item.createDiv({ cls: 'ld-file-item__actions' });
```

---

### 9. Password Strength (`.ld-password-strength`)

**Purpose**: Password strength indicator.

**Structure**:
```
.ld-password-strength
├── .ld-password-strength__bar-container
│   └── .ld-password-strength__meter
│       ├── .ld-password-strength__meter--weak
│       ├── .ld-password-strength__meter--fair
│       ├── .ld-password-strength__meter--good
│       └── .ld-password-strength__meter--strong
└── .ld-password-strength__text
    ├── .ld-password-strength__text--weak
    ├── .ld-password-strength__text--fair
    ├── .ld-password-strength__text--good
    └── .ld-password-strength__text--strong
```

**Usage**:
```typescript
const strength = createDiv({ cls: 'ld-password-strength' });
const barContainer = strength.createDiv({ cls: 'ld-password-strength__bar-container' });
const meter = barContainer.createDiv({ cls: 'ld-password-strength__meter' });
const text = strength.createDiv({ cls: 'ld-password-strength__text' });

// Update based on strength
meter.className = 'ld-password-strength__meter ld-password-strength__meter--strong';
text.className = 'ld-password-strength__text ld-password-strength__text--strong';
```

---

## Migration Guide

### From Legacy Classes to BEM

| **Legacy Class** | **New BEM Class** | **Notes** |
|------------------|-------------------|-----------|
| `.lockdown-modal` | `.ld-modal` | Base modal |
| `.lockdown-password-modal` | `.ld-modal--password` | Add to `.ld-modal` |
| `.lockdown-modal-title` | `.ld-modal__title` | Element of modal |
| `.lockdown-modal-button-primary` | `.ld-button--primary` | Standalone button |
| `.lockdown-overlay` | `.ld-overlay` | Lock overlay |
| `.lockdown-overlay-button` | `.ld-overlay__button` | Element of overlay |
| `.lockdown-file-indicator` | `.ld-file-explorer-indicator` | File indicator |
| `.lockdown-folder-indicator` | `.ld-file-explorer-indicator--folder` | Folder variant |
| `.lockdown-password-strength-meter` | `.ld-password-strength__meter` | Element |
| `.strength-weak` | `.ld-password-strength__meter--weak` | Modifier |

### Migration Steps

1. **Search and replace** class names in TypeScript files:
   ```typescript
   // Before
   modal.addClass('lockdown-modal', 'lockdown-password-modal');
   
   // After
   modal.addClass('ld-modal', 'ld-modal--password');
   ```

2. **Update dynamic class additions**:
   ```typescript
   // Before
   button.className = 'lockdown-modal-button lockdown-modal-button-primary';
   
   // After
   button.className = 'ld-button ld-button--primary';
   ```

3. **Update modifiers**:
   ```typescript
   // Before
   meter.classList.add('strength-weak');
   
   // After
   meter.classList.add('ld-password-strength__meter--weak');
   ```

### Backward Compatibility

**All legacy classes are still supported** until v2.0.0. They are aliased to the new BEM classes in `styles.css` (line 793-861).

However, **new code should use BEM classes** to future-proof.

### Automated Migration Script

```bash
# Run this script to update all class names in src/
find src -type f -name "*.ts" -exec sed -i '' \
  -e 's/lockdown-modal-button-primary/ld-button ld-button--primary/g' \
  -e 's/lockdown-modal-button-secondary/ld-button ld-button--secondary/g' \
  -e 's/lockdown-modal-button-warning/ld-button ld-button--warning/g' \
  -e 's/lockdown-password-modal/ld-modal ld-modal--password/g' \
  -e 's/lockdown-manager-modal/ld-modal ld-modal--manager/g' \
  -e 's/lockdown-modal/ld-modal/g' \
  -e 's/lockdown-overlay-button/ld-overlay__button/g' \
  -e 's/lockdown-overlay-icon/ld-overlay__icon/g' \
  -e 's/lockdown-overlay-message/ld-overlay__message/g' \
  -e 's/lockdown-overlay/ld-overlay/g' \
  -e 's/lockdown-file-indicator/ld-file-explorer-indicator/g' \
  -e 's/lockdown-folder-indicator/ld-file-explorer-indicator ld-file-explorer-indicator--folder/g' \
  {} \;
```

---

## Best Practices

### ✅ DO

1. **Use BEM consistently**:
   ```css
   .ld-modal__title { /* Good */ }
   ```

2. **Use design tokens**:
   ```css
   padding: var(--ld-space-md);
   ```

3. **Keep blocks independent**:
   ```css
   /* Each block can live on its own */
   .ld-button { /* ... */ }
   .ld-modal { /* ... */ }
   ```

4. **Use modifiers for variations**:
   ```css
   .ld-button--primary { /* ... */ }
   .ld-button--warning { /* ... */ }
   ```

5. **Scope elements to blocks**:
   ```css
   .ld-modal__title { /* Only makes sense inside modal */ }
   ```

### ❌ DON'T

1. **Don't nest elements**:
   ```css
   /* ❌ Bad */
   .ld-modal__header__title__icon { }
   
   /* ✅ Good */
   .ld-modal__header-icon { }
   ```

2. **Don't use blocks as elements**:
   ```css
   /* ❌ Bad */
   .ld-modal__button { }
   
   /* ✅ Good - button is its own block */
   .ld-button { }
   ```

3. **Don't use element selectors**:
   ```css
   /* ❌ Bad - breaks isolation */
   .ld-modal div { }
   
   /* ✅ Good */
   .ld-modal__content { }
   ```

4. **Don't use IDs**:
   ```css
   /* ❌ Bad */
   #lockdown-modal { }
   
   /* ✅ Good */
   .ld-modal { }
   ```

5. **Don't mix modifiers with elements**:
   ```css
   /* ❌ Bad */
   .ld-modal--password__title { }
   
   /* ✅ Good */
   .ld-modal--password .ld-modal__title { }
   ```

---

## File Organization

### Current Structure

```
styles.css (862 lines)
├── 1. CSS Variables (Design Tokens)         ← Lines 1-70
├── 2. Global Utilities                      ← Lines 72-90
├── 3. Components (BEM Blocks)               ← Lines 92-690
│   ├── Modal
│   ├── Button
│   ├── Input
│   ├── Overlay
│   ├── File Explorer Indicator
│   ├── Empty State
│   ├── Manager
│   ├── File Item
│   └── Password Strength
├── 4. Animations                            ← Lines 692-740
├── 5. Obsidian-specific Overrides           ← Lines 742-791
└── 6. Legacy Class Support                  ← Lines 793-862
```

### Future: Component-Based Files

For better scalability, consider splitting into component files:

```
styles/
├── base/
│   ├── variables.css      ← Design tokens
│   └── utilities.css      ← Global utilities
├── components/
│   ├── modal.css
│   ├── button.css
│   ├── input.css
│   ├── overlay.css
│   ├── file-explorer.css
│   ├── manager.css
│   └── password-strength.css
├── animations/
│   └── keyframes.css
├── overrides/
│   └── obsidian.css
└── legacy.css             ← Deprecated classes
```

Then use a build tool (e.g., `postcss-import`) to combine them.

---

## Testing CSS Changes

### Manual Testing Checklist

- [ ] **Modals**: Open password prompt, confirmation, and manager modals
- [ ] **Buttons**: Test hover, active, and all modifiers (primary, secondary, warning)
- [ ] **Overlays**: Lock a note and verify overlay appearance
- [ ] **File Explorer**: Check indicators on files and folders
- [ ] **Password Strength**: Type in password field and verify meter updates
- [ ] **Manager**: Open locked files manager, test tabs, search, and file actions
- [ ] **Empty State**: View manager with no locked files
- [ ] **Responsive**: Test at different window sizes
- [ ] **Themes**: Test with multiple Obsidian themes (light/dark)

### Visual Regression Testing

Use Percy, Chromatic, or BackstopJS for automated visual testing:

```bash
npm install --save-dev backstopjs
backstop test
```

### Browser DevTools

1. Open Obsidian with dev tools (Ctrl/Cmd + Shift + I)
2. Inspect element
3. Check computed styles
4. Verify CSS variables are resolved correctly

---

## Versioning & Deprecation

### Current Version: v1.0.0

- **Stable**: BEM classes with `ld-` prefix
- **Deprecated**: Legacy `lockdown-*` classes (will be removed in v2.0.0)

### Deprecation Timeline

| **Version** | **Status** | **Action** |
|-------------|------------|------------|
| v1.0.0 | ✅ Current | Both BEM and legacy classes supported |
| v1.5.0 | 📋 Planned | Console warnings for legacy classes |
| v2.0.0 | 🚫 Breaking | Remove legacy classes entirely |

---

## Resources

- **BEM Official**: [getbem.com](http://getbem.com/)
- **CSS Guidelines**: [cssguidelin.es](https://cssguidelin.es/)
- **CUBE CSS**: [cube.fyi](https://cube.fyi/) (complementary methodology)
- **Every Layout**: [every-layout.dev](https://every-layout.dev/) (layout primitives)

---

## Questions & Contributions

For questions about CSS architecture:

1. Check this document first
2. Search existing issues on GitHub
3. Open a new issue with the `css` label

When contributing CSS:

1. Follow BEM naming convention
2. Use design tokens (CSS variables)
3. Update this document if adding new components
4. Test in multiple themes
5. Add comments for complex selectors

---

**Last Updated**: 2025-11-27  
**Maintained By**: Lockdown Plugin Team

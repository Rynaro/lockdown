# GitHub Actions Troubleshooting

## Common Issues and Solutions

### 1. 403 Resource not accessible by integration

**Error:**
```
HttpError: Resource not accessible by integration
status: 403
x-accepted-github-permissions: 'issues=write; pull_requests=write'
```

**Cause:** Missing permissions for `GITHUB_TOKEN` to write comments on PRs.

**Solution:** ✅ Fixed in workflows

We've added the required permissions block:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

And made PR comments non-blocking with `continue-on-error: true`.

**If still failing:**
1. Check repository settings → Actions → General → Workflow permissions
2. Ensure "Read and write permissions" is enabled
3. Or enable "Allow GitHub Actions to create and approve pull requests"

### 2. fatal: ambiguous argument 'origin/main..HEAD'

**Error:**
```
fatal: ambiguous argument 'origin/main..HEAD': unknown revision or path not in the working tree.
Error: Process completed with exit code 128.
```

**Cause:** Shallow checkout doesn't have full git history.

**Solution:** ✅ Fixed in workflows

Set `fetch-depth: 0` to get full history:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0  # 0 = full history
```

And fetch base branch explicitly:

```yaml
git fetch origin ${{ github.base_ref }}:${{ github.base_ref }}
```

### 3. Workflow doesn't run on PR

**Cause:** Workflow permissions or branch protection.

**Solution:**
- Check if workflow file is on the base branch (main/develop)
- Verify `on: pull_request:` trigger is correct
- Check repository → Settings → Actions → General

### 4. ESLint fails with "Cannot find module"

**Cause:** Dependencies not installed correctly.

**Solution:**
```yaml
- name: Install dependencies
  run: npm ci  # ✅ Already using this
```

We use `npm ci` instead of `npm install` for reproducible builds.

### 5. Type check fails

**Cause:** TypeScript compilation errors.

**Local debugging:**
```bash
npm run type-check
# Or with details
tsc -noEmit
```

**Fix:** Resolve TypeScript errors in code.

### 6. Architecture rule violations

**Error:**
```
Found Obsidian imports in core domain
```

**Cause:** Core layer importing from forbidden layers.

**Solution:**
Move code to appropriate layer:
- Core → No Obsidian, no application/infrastructure/ui imports
- Application → Can import core only
- Infrastructure → Can import core, application
- UI → Can import all layers

### 7. Workflow times out

**Cause:** Long-running operation or infinite loop.

**Solution:**
- Check for watch commands (dev scripts)
- Ensure build completes
- Add timeout to job:

```yaml
jobs:
  lint:
    timeout-minutes: 10  # Add this
```

### 8. Cache not working

**Symptom:** Slow npm install every time.

**Check:**
```yaml
- uses: actions/setup-node@v4
  with:
    cache: 'npm'  # ✅ Already configured
```

**If still slow:**
- Check if `package-lock.json` is committed
- Verify `npm ci` is used (not `npm install`)

### 9. Artifacts not uploading

**Check:**
- Artifact name is unique
- Path exists
- File isn't empty

```yaml
- uses: actions/upload-artifact@v4
  if: always()  # Upload even if previous steps fail
```

### 10. Summary not showing

**Symptom:** `$GITHUB_STEP_SUMMARY` not appearing.

**Cause:** Syntax error in summary generation.

**Debug:**
```bash
echo "Test" >> $GITHUB_STEP_SUMMARY
```

Check for:
- Proper escaping
- Valid markdown
- No binary data

### 11. Secrets not working

**Symptom:** `GITHUB_TOKEN` is undefined.

**Solution:**
`GITHUB_TOKEN` is automatically provided, don't add it to secrets.

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # ✅ Automatic
```

## Permissions Reference

### Minimum Required Permissions

For read-only checks:
```yaml
permissions:
  contents: read
```

For PR comments:
```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

For releases:
```yaml
permissions:
  contents: write
```

### Repository Settings

**Workflow permissions:**
Settings → Actions → General → Workflow permissions

Options:
- ✅ **Read and write permissions** (Recommended for this project)
- ❌ Read repository contents permission only

## Testing Workflows Locally

### Using act

```bash
# Install act (GitHub Actions local runner)
brew install act

# Run lint workflow
act pull_request -W .github/workflows/lint.yml

# Run with secrets
act -s GITHUB_TOKEN=your_token
```

### Manual Testing

```bash
# Run the same commands locally
npm ci
npm run type-check
npm run lint
npm run build
```

## Performance Optimization

### Current Optimizations

✅ npm cache enabled
✅ Using `npm ci` instead of `npm install`
✅ Parallel independent steps
✅ Conditional execution (`if` statements)
✅ Artifact retention limits (30 days)

### Improving Speed

1. **Cache more aggressively:**
```yaml
- uses: actions/cache@v3
  with:
    path: |
      node_modules
      ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

2. **Skip on draft PRs:**
```yaml
if: github.event.pull_request.draft == false
```

3. **Fail fast:**
```yaml
strategy:
  fail-fast: true
```

## Debugging Tips

### Enable debug logging

In repository secrets, add:
- `ACTIONS_STEP_DEBUG` = `true`
- `ACTIONS_RUNNER_DEBUG` = `true`

### Check workflow runs

1. Go to Actions tab
2. Click on failed workflow
3. Expand failed step
4. Check "View raw logs"

### Download artifacts

Even if workflow fails, artifacts might contain useful info:
- `eslint-report.json`
- `eslint-output.log`

## Getting Help

1. **Check workflow status:**
   - Repository → Actions tab

2. **View logs:**
   - Click on workflow run
   - Expand steps to see details

3. **Re-run workflow:**
   - Click "Re-run all jobs"
   - Or "Re-run failed jobs"

4. **GitHub Actions docs:**
   - https://docs.github.com/actions

## Best Practices Applied

✅ Use `continue-on-error` for non-critical steps
✅ Add `if: always()` to cleanup steps
✅ Use specific action versions (@v4 not @latest)
✅ Set permissions explicitly
✅ Use `npm ci` for reproducibility
✅ Enable caching
✅ Upload artifacts for debugging
✅ Create detailed summaries
✅ Add timeout limits

## Maintenance Checklist

- [ ] Update action versions quarterly
- [ ] Review artifact retention policies
- [ ] Check workflow performance metrics
- [ ] Update Node version when needed
- [ ] Review and update permissions as needed
- [ ] Clean up old workflow runs (Settings → Actions)

## Contact

For issues specific to this repository:
1. Check this troubleshooting guide
2. Review workflow logs in Actions tab
3. Check repository settings
4. Open an issue if problem persists

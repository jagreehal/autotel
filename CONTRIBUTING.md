# Contributing to Autotel

Thank you for your interest in contributing to Autotel! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18+ (22+ recommended)
- pnpm 8+
- Git

### Getting Started

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/autotel.git
   cd autotel
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Build all packages:**
   ```bash
   pnpm build
   ```

4. **Run tests:**
   ```bash
   pnpm test
   ```

5. **Run quality checks:**
   ```bash
   pnpm quality  # Runs build + lint + format + type-check + test
   ```

## Project Structure

```
autotel/
├── packages/
│   ├── autotel/          # Core library
│   ├── autotel-subscribers/ # Events adapters (PostHog, Mixpanel, etc.)
│   └── autotel-edge/     # Edge runtime support (Cloudflare Workers, etc.)
├── apps/
│   ├── example-basic/        # Basic usage example
│   ├── example-http/         # Express server example
│   └── cloudflare-example/   # Cloudflare Workers example
├── README.md                 # Main documentation
├── CONTRIBUTING.md           # This file
└── CHANGELOG.md              # Version history
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation only
- `refactor/*` - Code refactoring
- `test/*` - Adding tests

### 2. Make Your Changes

- Write clear, concise code
- Follow existing code style (enforced by ESLint + Prettier)
- Add tests for new features
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run all quality checks
pnpm quality
```

### 4. Commit Your Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat(adapters): add Slack webhook adapter"
git commit -m "fix(core): resolve race condition in span processor"
git commit -m "docs(readme): update installation instructions"
```

**Commit types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks
- `perf:` - Performance improvements

**Scope examples:**
- `core` - autotel package
- `adapters` - autotel-subscribers package
- `edge` - autotel-edge package
- `examples` - example apps

### 5. Create a Changeset

For changes that affect published packages, create a changeset:

```bash
pnpm changeset
```

Follow the prompts:
1. Select which packages changed (autotel, autotel-subscribers, autotel-edge)
2. Choose the semver bump type:
   - **Patch** (0.0.x) - Bug fixes, docs
   - **Minor** (0.x.0) - New features, backwards-compatible
   - **Major** (x.0.0) - Breaking changes
3. Write a summary of your changes

**Example changeset:**
```markdown
---
"autotel": minor
"autotel-subscribers": minor
---

Add Slack webhook adapter for sending events to Slack channels
```

### 6. Push and Create a Pull Request

```bash
git push origin feature/my-feature
```

Then open a pull request on GitHub with:
- **Clear title** describing the change
- **Description** explaining what and why
- **Related issues** (if applicable)
- **Testing notes** for reviewers

## Code Guidelines

### TypeScript

- Use **strict mode** (already configured)
- Avoid `any` - use proper types
- Export types alongside implementation
- Document complex types with JSDoc comments

```typescript
/**
 * Configuration options for the PostHog adapter
 */
export interface PostHogConfig {
  /** PostHog API key (starts with 'phc_') */
  apiKey: string
  /** PostHog instance URL (default: 'https://us.i.posthog.com') */
  host?: string
}
```

### Testing

- Write tests for all new features
- Aim for >80% code coverage
- Use descriptive test names

```typescript
describe('trace()', () => {
  it('should create a span with the function name', () => {
    // Test implementation
  })

  it('should propagate context to nested spans', () => {
    // Test implementation
  })
})
```

### Documentation

- Update README.md if adding features
- Add JSDoc comments for public APIs
- Include code examples for new functionality
- Update CHANGELOG.md (via changesets)

## Package-Specific Guidelines

### autotel (Core)

- Keep bundle size minimal
- Avoid adding dependencies unless necessary
- Maintain backwards compatibility
- Test in both Node.js and edge environments

### autotel-subscribers

- Each adapter should be **tree-shakeable**
- Follow the `EventsAdapter` interface
- Include tests using `AdapterTestHarness`
- Document adapter-specific configuration

```typescript
export class MyAdapter extends EventsAdapter {
  readonly name = 'MyAdapter'

  protected async sendToDestination(payload: AdapterPayload): Promise<void> {
    // Implementation
  }
}
```

### autotel-edge

- Ensure compatibility with:
  - Cloudflare Workers
  - Vercel Edge Functions
  - Deno Deploy
- Test with `nodejs_compat` flag (Cloudflare Workers)
- Keep bundle size minimal (<50KB)

## Pull Request Process

1. **Ensure all checks pass:**
   - ✅ `pnpm quality` passes
   - ✅ Tests pass
   - ✅ No lint errors
   - ✅ Changeset created (if needed)

2. **Wait for review:**
   - Maintainers will review your PR
   - Address any feedback
   - Make requested changes

3. **After approval:**
   - PR will be merged by a maintainer
   - Changesets will be used for versioning
   - Your contribution will be credited

## Release Process

**For Maintainers:**

1. **Create a version PR:**
   ```bash
   pnpm changeset version
   ```

2. **Review and merge the version PR**

3. **Publish to npm:**
   ```bash
   pnpm changeset publish
   git push --follow-tags
   ```

## Need Help?

- **Questions?** Open a [Discussion](https://github.com/jagreehal/autotel/discussions)
- **Found a bug?** Open an [Issue](https://github.com/jagreehal/autotel/issues)
- **Want to chat?** Join our community (link TBD)

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build something great together.

## License

By contributing to Autotel, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉

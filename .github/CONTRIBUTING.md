# Contributing to Ai Norx

Thank you for your interest in contributing to Ai Norx! This document outlines the process for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Ai-Agnet.git`
3. Install dependencies: `npm install`
4. Copy the example config: `cp librechat.example.yaml librechat.yaml`
5. Copy the example env: `cp .env.example .env` and fill in your values
6. Start the dev server: `npm run dev`

## Development Workflow

1. Create a branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run linting: `npm run lint`
4. Run tests: `npm test`
5. Commit with clear messages: `git commit -m "feat: add X feature"`
6. Push to your fork: `git push origin feature/your-feature-name`
7. Open a Pull Request

## Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `style:` formatting, no code change
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding tests
- `chore:` build process, auxiliary tools

## Pull Request Process

1. Update the README.md if needed
2. Update the documentation if needed
3. The PR should work without new errors
4. PRs require review before merging

## Code Style

- Use TypeScript for frontend code
- Use ESLint + Prettier (config provided)
- Follow the existing code style

## Reporting Bugs

Open a GitHub issue with:
- Description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment info (browser, OS)

## Suggesting Features

Open a GitHub issue with the `enhancement` label:
- Description of the feature
- Use case
- Alternatives considered

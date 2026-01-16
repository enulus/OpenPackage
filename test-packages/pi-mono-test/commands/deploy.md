# Deploy Command

Deploy application to production environment.

## Usage

```bash
/deploy [environment]
```

## Arguments

- `environment` - Target environment (staging, production). Default: staging

## Behavior

1. Run tests to ensure code is working
2. Build production assets
3. Deploy to specified environment
4. Run smoke tests
5. Report deployment status

## Pre-requisites

- All tests must pass
- No uncommitted changes
- Version tag must be created

## Tags

- deployment
- ci-cd
- production

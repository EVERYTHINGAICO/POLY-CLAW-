# Security Policy

## Supported Status

POLY-CLAW is experimental research software. It should be treated as pre-production unless a separate deployment review says otherwise.

## Reporting Security Issues

Please do not open public issues containing secrets, private keys, wallet details, credentials, or exploit details. Report sensitive findings privately to the repository owner.

## Secret Handling

Never commit:

- Private keys or wallet seed phrases
- Polymarket credentials or API keys
- `.env` files
- Local SQLite databases
- Runtime logs containing identifiers or account state
- Exchange responses containing sensitive account data

The `.gitignore` excludes common local environment and runtime artifacts, but users remain responsible for reviewing staged files before commit.

## Deployment Warning

This repository does not currently claim live-trading readiness. Before any live deployment, perform a separate review covering:

- Key isolation
- Exchange adapter permissions
- Rate limits and retries
- Order cancellation guarantees
- Reconciliation recovery
- Incident response
- Capital limits
- Monitoring and alerting

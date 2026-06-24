# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Ai Norx, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email: security@ai-norx.com (replace with your actual email)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Time

- Acknowledgment: within 48 hours
- Initial assessment: within 7 days
- Fix timeline: depends on severity (critical: 7 days, high: 30 days, medium: 90 days)

## Scope

The following are in scope:
- Production deployment at https://agent-platform-production-de14.up.railway.app
- Authentication and authorization bypass
- Data exposure (user data, API keys, conversation history)
- Code execution vulnerabilities
- SQL/NoSQL injection

The following are out of scope:
- Vulnerabilities in third-party services (Railway, MongoDB, Redis, etc.)
- Social engineering attacks
- Physical attacks
- DoS attacks

## Acknowledgments

We thank security researchers who help keep Ai Norx secure.

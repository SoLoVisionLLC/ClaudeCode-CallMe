# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-01-22

### Added
- HTTP (Streamable HTTP) transport support for MCP protocol 2025-03-26
- Comprehensive request logging for debugging
- npm publishing support with `npx solo-callme`
- GitHub Actions for CI/CD and releases
- Docker image publishing to GitHub Container Registry

### Changed
- Renamed from `callme` to `solo-callme`
- SSE transport marked as deprecated (use HTTP transport instead)
- Improved OAuth 2.1 implementation for MCP authentication

### Fixed
- MCP connection issues with Claude Code cloud deployment
- Session management for Streamable HTTP transport

## [1.0.3] - 2026-01-21

### Added
- Cloud deployment support via Coolify/Railway
- SSE transport for remote MCP connections
- OAuth 2.1 with Dynamic Client Registration

### Changed
- Unified HTTP server handling all endpoints on single port
- Improved ngrok pooling support

## [1.0.0] - 2026-01-15

### Added
- Initial release
- Phone calling via Telnyx and Twilio
- Text-to-speech with OpenAI, LemonFox, Deepgram
- Speech-to-text with Deepgram
- Multi-turn conversation support
- ngrok tunnel for local development

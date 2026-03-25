# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-25

### Added
- **YouTube Data API Integration**: Discover videos reliably using the official YouTube Data API v3.
- **AI Fallback (Gemini)**: When native captions are disabled or unavailable, the system uses `youtube-dl-exec` to extract audio and the Gemini Files API to transcribe it using `gemini-3.1-flash-preview`.
- **Multiple Export Formats**: Export transcripts as `.txt`, `.json`, `.ndjson`, or `.zip` (one file per video).
- **Language Selector**: Choose to prioritize Spanish, English, or auto-detect the original language.
- **Summary Dashboard**: View total videos, successes, failures, AI-generated transcripts, and estimated Gemini API costs.
- **PWA Support**: Added `manifest.json` and icons for Progressive Web App installation.
- **CI/CD Workflows**: Added GitHub Actions for linting and building.
- **Issue Templates**: Added templates for Bug Reports and Feature Requests.

### Changed
- Replaced `cobalt` with `youtube-dl-exec` for more robust local audio extraction.
- Refactored `app/api/get-videos/route.ts` to prioritize YouTube Data API over `ytpl` scraping.
- Updated repository metadata, SEO tags, and `package.json` to reflect the new project identity (`youtube-transcript-bulk-exporter`).

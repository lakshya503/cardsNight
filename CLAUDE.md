# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**cardsNight** is a platform for creating and hosting multiple card games for people to play online. The project is in early/planning stage — no tech stack or implementation has been committed yet.

## Getting Started

No build system or tooling has been set up yet. Once a stack is chosen, update this file with:
- How to install dependencies
- How to run the dev server
- How to run tests (including how to run a single test)
- How to build for production

## Planned Architecture

When implementing, consider:
- A frontend for rendering card game UIs and player interactions
- Game state management (real-time multiplayer likely requires WebSockets or a service like Supabase Realtime / Socket.io)
- A backend or serverless functions for game logic validation and persistence
- Separate game modules so each card game is independently maintainable
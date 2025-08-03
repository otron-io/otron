/**
 * REFACTORED: This file now serves as a clean interface to the modular response generation system.
 * The original 3200+ line monolith has been split into focused, maintainable modules:
 *
 * - response-generation/core/: Main response logic and types
 * - response-generation/session/: Session and message queue management
 * - response-generation/tools/: Tool definitions and execution
 * - response-generation/context/: Context extraction and repository info
 * - response-generation/utils/: Utilities and cleanup functions
 */

// Re-export everything from the new modular response generation system
export * from "./response-generation/index.js";

// For backward compatibility, also provide the old generateResponse export
export { generateResponse as generateResponseLegacy } from "./response-generation/index.js";

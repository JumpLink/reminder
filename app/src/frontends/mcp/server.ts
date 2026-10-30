/**
 * The reminder MCP server — calendars, events and reminders over stdio.
 *
 * `applyGrantGate` decides what is served: every read tool declares `readOnlyHint: true` and is
 * always registered; the two create tools declare a capability and appear only when the config
 * carries a grant for it. The gate fails CLOSED — a tool with neither an annotation nor a granted
 * capability is dropped from the catalogue, not served unguarded. The grant check is repeated at
 * call time (exact target), and again inside `@reminder/core` (docs/adr/0001 §4).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyGrantGate, serveStdio } from '@gjsify/mcp';

import { createContext, type Context } from '../../core/context.ts';
import { VERSION } from '../../core/runtime.ts';
import { registerReadTools } from './tools/read.ts';
import { registerWriteTools } from './tools/write.ts';

const SERVER_NAME = 'reminder';

/** Every tool, on any server — split from createMcpServer so tests can pass a recorder. */
export function registerTools(server: McpServer, context: Context): void {
  // Before any registration — the gate wraps registerTool, so anything registered earlier would
  // slip past it. It fails CLOSED: an unannotated tool goes missing instead of being reachable.
  applyGrantGate(server, context.config().grants);
  registerReadTools(server, context);
  registerWriteTools(server, context);
}

export function createMcpServer(context: Context = createContext()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerTools(server, context);
  return server;
}

export async function startMcpServer(): Promise<void> {
  await serveStdio(createMcpServer(), SERVER_NAME);
}

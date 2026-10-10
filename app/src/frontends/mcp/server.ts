/**
 * The reminder MCP server — calendars, events and reminders over stdio.
 *
 * Read-only, and `applyReadOnlyGate` ENFORCES that: a tool without `readOnlyHint: true` is dropped
 * from the catalogue. Creating items exists in `@reminder/core` behind per-calendar grants, but no
 * MCP tool exposes it until `@gjsify/mcp` ships the grant gate (docs/adr/0001).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyReadOnlyGate, serveStdio } from '@gjsify/mcp';

import { createContext, type Context } from '../../core/context.ts';
import { VERSION } from '../../core/runtime.ts';
import { registerReadTools } from './tools/read.ts';

const SERVER_NAME = 'reminder';

/** Every tool, on any server — split from createMcpServer so tests can pass a recorder. */
export function registerTools(server: McpServer, context: Context): void {
  // Before any registration — the gate wraps registerTool, so anything registered earlier would
  // slip past it. It fails CLOSED: an unannotated tool goes missing instead of being reachable.
  applyReadOnlyGate(server, false);
  registerReadTools(server, context);
}

export function createMcpServer(context: Context = createContext()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerTools(server, context);
  return server;
}

export async function startMcpServer(): Promise<void> {
  await serveStdio(createMcpServer(), SERVER_NAME);
}

/**
 * The reminder MCP server — calendars, events and reminders over stdio.
 *
 * Read-only unless the config holds grants, and `applyGrantGate` ENFORCES that: a tool is dropped
 * from the catalogue unless it is read-only or declares a capability that has a grant, and a create
 * call reaches its handler only for a target granted exactly (docs/adr/0001).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyGrantGate, serveStdio } from '@gjsify/mcp';

import { ConfigError } from '@reminder/core';

import { createContext, type Context } from '../../core/context.ts';
import { VERSION } from '../../core/runtime.ts';
import { registerCreateTools } from './tools/create.ts';
import { registerReadTools } from './tools/read.ts';

const SERVER_NAME = 'reminder';

/** A config that does not load means no grants: the server stays read-only instead of not starting. */
function grantsOf(context: Context) {
  try {
    return context.config().grants;
  } catch (err) {
    if (err instanceof ConfigError) return [];
    throw err;
  }
}

/** Every tool, on any server — split from createMcpServer so tests can pass a recorder. */
export function registerTools(server: McpServer, context: Context): void {
  // Before any registration — the gate wraps registerTool, so anything registered earlier would
  // slip past it. It fails CLOSED: an undeclared tool goes missing instead of being reachable.
  applyGrantGate(server, grantsOf(context));
  registerReadTools(server, context);
  registerCreateTools(server, context);
}

export function createMcpServer(context: Context = createContext()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerTools(server, context);
  return server;
}

export async function startMcpServer(): Promise<void> {
  await serveStdio(createMcpServer(), SERVER_NAME);
}

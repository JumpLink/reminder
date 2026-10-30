/**
 * `reminder mcp` — the long-lived stdio server. Not wrapped in `runAndExit`: it serves until the
 * client closes stdin, and `serveStdio` from `@gjsify/mcp` owns that exit.
 */

import type { CommandModule } from 'yargs';

import { _ } from '@reminder/core';

import { startMcpServer } from '../mcp/server.ts';

export const mcpCommand: CommandModule = {
  command: 'mcp',
  describe: _('Run as an MCP server over stdio'),
  builder: (yargs) => yargs,
  handler: () => {
    startMcpServer().catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
  },
};

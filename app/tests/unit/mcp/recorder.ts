/**
 * A stand-in for McpServer that records registrations and keeps the handlers, so the catalogue,
 * the read-only gate and the tool results are asserted on both runtimes without a transport.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

export interface RecordedTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean };
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface Recorder {
  server: McpServer;
  tools: RecordedTool[];
  names(): string[];
  call(name: string, params?: Record<string, unknown>): Promise<ToolResult>;
}

export function createRecorder(): Recorder {
  const tools: RecordedTool[] = [];
  const server = {
    registerTool: (
      name: string,
      config: Omit<RecordedTool, 'name' | 'handler'>,
      handler: RecordedTool['handler'],
    ) => {
      tools.push({ name, ...config, handler });
      return undefined;
    },
  } as unknown as McpServer;
  return {
    server,
    tools,
    names: () => tools.map((t) => t.name),
    call: async (name, params = {}) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`no tool ${name}`);
      return tool.handler(params);
    },
  };
}

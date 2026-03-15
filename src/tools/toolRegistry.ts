import { CliTool, ToolId } from '../types';
import { ClaudeTool } from './ClaudeTool';
import { CodexTool } from './CodexTool';
import { GeminiTool } from './GeminiTool';
import { OpenCodeTool } from './OpenCodeTool';

const tools = {
    claude: new ClaudeTool(),
    codex: new CodexTool(),
    gemini: new GeminiTool(),
    opencode: new OpenCodeTool(),
} satisfies { [K in ToolId]: CliTool<K> };

export function getTool(toolId: 'claude'): ClaudeTool;
export function getTool(toolId: 'codex'): CodexTool;
export function getTool(toolId: 'gemini'): GeminiTool;
export function getTool(toolId: 'opencode'): OpenCodeTool;
export function getTool(toolId: ToolId): CliTool<ToolId>;
export function getTool(toolId: ToolId): CliTool<ToolId> {
    return tools[toolId];
}

export function requireTool(toolId: 'claude'): ClaudeTool;
export function requireTool(toolId: 'codex'): CodexTool;
export function requireTool(toolId: 'gemini'): GeminiTool;
export function requireTool(toolId: 'opencode'): OpenCodeTool;
export function requireTool(toolId: ToolId): CliTool<ToolId>;
export function requireTool(toolId: ToolId): CliTool<ToolId> {
    const tool = getTool(toolId);
    if (!tool) {
        throw new Error(`Unknown tool ID "${toolId}"`);
    }
    return tool;
}

export function listTools(): CliTool<ToolId>[] {
    return Object.values(tools);
}

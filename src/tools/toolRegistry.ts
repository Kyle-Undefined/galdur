import { CliTool, ToolId } from '../types';
import { ClaudeTool } from './ClaudeTool';
import { CodexTool } from './CodexTool';
import { GeminiTool } from './GeminiTool';
import { OpenCodeTool } from './OpenCodeTool';

const tools: CliTool<ToolId>[] = [new ClaudeTool(), new CodexTool(), new GeminiTool(), new OpenCodeTool()];
const toolMap = new Map<ToolId, CliTool<ToolId>>(tools.map((tool) => [tool.id, tool]));

export function getTool<TToolId extends ToolId>(toolId: TToolId): CliTool<TToolId> | undefined {
    return toolMap.get(toolId) as CliTool<TToolId> | undefined;
}

export function requireTool<TToolId extends ToolId>(toolId: TToolId): CliTool<TToolId> {
    const tool = getTool(toolId);
    if (!tool) {
        throw new Error(`Unknown tool ID "${toolId}"`);
    }
    return tool;
}

export function listTools(): CliTool<ToolId>[] {
    return tools;
}

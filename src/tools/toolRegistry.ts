import { CliTool, ToolId } from '../types';
import { swallowError } from '../utils/logging';
import { ClaudeTool } from './ClaudeTool';
import { CodexTool } from './CodexTool';
import { GeminiTool } from './GeminiTool';
import { OpenCodeTool } from './OpenCodeTool';

const tools: CliTool<ToolId>[] = [new ClaudeTool(), new CodexTool(), new GeminiTool(), new OpenCodeTool()];
const toolMap = new Map<ToolId, CliTool<ToolId>>(tools.map((tool) => [tool.id, tool]));

export function getTool(toolId: ToolId): CliTool<ToolId> {
    const tool = toolMap.get(toolId);
    if (!tool) {
        swallowError(new Error(`Unknown tool ID "${toolId}", falling back to default`));
        if (tools.length === 0) {
            throw new Error('No tools registered in the registry');
        }
        return tools[0];
    }
    return tool;
}

export function listTools(): CliTool<ToolId>[] {
    return tools;
}

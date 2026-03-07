import { CliTool, ToolId } from '../types';
import { swallowError } from '../utils/logging';
import { ClaudeTool } from './ClaudeTool';

const tools: CliTool[] = [new ClaudeTool()];
const toolMap = new Map<ToolId, CliTool>(tools.map((tool) => [tool.id, tool]));

export function getTool(toolId: ToolId): CliTool {
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

export function listTools(): CliTool[] {
    return tools;
}

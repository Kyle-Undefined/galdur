import { CliToolAdapter, ToolId } from "../types";
import { ClaudeToolAdapter } from "./ClaudeToolAdapter";

const tools: CliToolAdapter[] = [new ClaudeToolAdapter()];
const toolMap = new Map<ToolId, CliToolAdapter>(
  tools.map((tool) => [tool.id, tool])
);

export function getTool(toolId: ToolId): CliToolAdapter {
  return toolMap.get(toolId) ?? tools[0];
}

export function listTools(): CliToolAdapter[] {
  return tools;
}

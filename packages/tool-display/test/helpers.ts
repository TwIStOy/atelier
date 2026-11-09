import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { setThoughtMember, setThoughtTransparent } from "@htwang-contrib/common/tool-rail";
import { Type } from "@sinclair/typebox";

export type FakeRoot = { children: unknown[] };

let callSeq = 0;

export function makeComponent(
  toolName: string,
  root: FakeRoot,
  args: Record<string, unknown> = {},
): ToolExecutionComponent {
  const toolDefinition: ToolDefinition = {
    name: toolName,
    label: toolName,
    description: "test tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
  };
  return new ToolExecutionComponent(
    toolName,
    `call-${toolName}-${callSeq++}`,
    args,
    {},
    toolDefinition,
    root as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
    process.cwd(),
  );
}

export function withResult(component: ToolExecutionComponent, isError = false): ToolExecutionComponent {
  component.updateResult({ content: [{ type: "text", text: isError ? "boom" : "done" }], details: {}, isError }, false);
  return component;
}

export function textBlock(lines: string[]): { render: (width: number) => string[] } {
  return { render: () => lines };
}

export function fakeThoughtMember(lines: string[] = ["     ◆ Thought for 5s"]): object {
  const fake = { render: () => lines };
  setThoughtMember(fake, true);
  return fake;
}

export function fakeTransparentThought(lines: string[] = ["     ◆ Thinking..."]): object {
  const fake = { render: () => lines };
  setThoughtTransparent(fake, true);
  return fake;
}

import { Group, Panel, Separator } from "react-resizable-panels";
import { PaneView } from "./PaneView";
import { useLayoutStore } from "../../stores/layoutStore";
import type { LayoutNode } from "../../types";

interface LayoutRendererProps {
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
}

function RenderNode({
  node,
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
  isFirstLeaf,
}: {
  node: LayoutNode;
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  isFirstLeaf: boolean;
}) {
  if (node.type === "leaf") {
    return (
      <PaneView
        paneId={node.paneId}
        worktreeId={worktreeId}
        onToggleServer={isFirstLeaf ? onToggleServer : undefined}
        isServerRunning={isFirstLeaf ? isServerRunning : undefined}
        runScriptName={isFirstLeaf ? runScriptName : undefined}
      />
    );
  }

  const updateSplitRatio = useLayoutStore.getState().updateSplitRatio;
  const defaultSize = node.ratio * 100;

  return (
    <Group
      orientation={node.direction === "horizontal" ? "horizontal" : "vertical"}
      onLayoutChanged={(layout) => {
        const values = Object.values(layout);
        if (values.length === 2) {
          updateSplitRatio(worktreeId, values[0] / 100);
        }
      }}
    >
      <Panel defaultSize={defaultSize} minSize={20}>
        <RenderNode
          node={node.children[0]}
          worktreeId={worktreeId}
          onToggleServer={onToggleServer}
          isServerRunning={isServerRunning}
          runScriptName={runScriptName}
          isFirstLeaf={true}
        />
      </Panel>
      <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary" />
      <Panel defaultSize={100 - defaultSize} minSize={20}>
        <RenderNode
          node={node.children[1]}
          worktreeId={worktreeId}
          isFirstLeaf={false}
        />
      </Panel>
    </Group>
  );
}

function LayoutRenderer({
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
}: LayoutRendererProps) {
  const layout = useLayoutStore((s) => s.layout[worktreeId]);

  if (!layout) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
        <span className="text-sm">Select a worktree to get started</span>
        <span className="text-xs">Each worktree gets its own branch, terminal, and agent</span>
      </div>
    );
  }

  return (
    <RenderNode
      node={layout}
      worktreeId={worktreeId}
      onToggleServer={onToggleServer}
      isServerRunning={isServerRunning}
      runScriptName={runScriptName}
      isFirstLeaf={true}
    />
  );
}

export { LayoutRenderer };

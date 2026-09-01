import { Group, Panel, Separator } from "react-resizable-panels";
import { PaneView } from "./PaneView";
import { SectionErrorBoundary } from "../shared/SectionErrorBoundary";
import { SettingsStatusBar } from "../terminal/SettingsStatusBar";
import { useLayoutStore } from "../../stores/layoutStore";
import { CatLogo } from "../ui/CatLogo";
import type { LayoutNode } from "../../types";

interface LayoutRendererProps {
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  runScriptUrl?: string;
  assignedPort?: number | null;
  hasWorktreeRepos?: boolean;
}

function RenderNode({
  node,
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
  runScriptUrl,
  assignedPort,
  isFirstLeaf,
}: {
  node: LayoutNode;
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  runScriptUrl?: string;
  assignedPort?: number | null;
  isFirstLeaf: boolean;
}) {
  if (node.type === "leaf") {
    return (
      <SectionErrorBoundary name={node.paneId}>
        <PaneView
          paneId={node.paneId}
          worktreeId={worktreeId}
          onToggleServer={isFirstLeaf ? onToggleServer : undefined}
          isServerRunning={isFirstLeaf ? isServerRunning : undefined}
          runScriptName={isFirstLeaf ? runScriptName : undefined}
          runScriptUrl={isFirstLeaf ? runScriptUrl : undefined}
          assignedPort={isFirstLeaf ? assignedPort : undefined}
        />
      </SectionErrorBoundary>
    );
  }

  const updateSplitRatio = useLayoutStore.getState().updateSplitRatio;
  const defaultSize = node.ratio * 100;

  return (
    <Group
      orientation={node.direction === "horizontal" ? "horizontal" : "vertical"}
      onLayoutChanged={(layout) => {
        // react-resizable-panels fires partial payloads while panels are
        // (un)mounting — same invariant as AppShell's changes-panel guard, but
        // these panels are anonymous, so completeness is a count check here.
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
          runScriptUrl={runScriptUrl}
          assignedPort={assignedPort}
          isFirstLeaf={true}
        />
      </Panel>
      <Separator className={[
        node.direction === "horizontal" ? "w-px" : "h-px",
        "bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary",
      ].join(" ")} />
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
  runScriptUrl,
  assignedPort,
  hasWorktreeRepos,
}: LayoutRendererProps) {
  const layout = useLayoutStore((s) => s.layout[worktreeId]);

  if (!layout) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-3">
        <CatLogo aria-hidden className="w-16 h-16 opacity-[0.15] select-none pointer-events-none text-white" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-sm">
            {hasWorktreeRepos === false
              ? "Select a repo to get started"
              : "Select a worktree to get started"}
          </span>
          {hasWorktreeRepos === true && (
            <span className="text-xs">Each worktree gets its own branch, terminal, and agent</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <RenderNode
          node={layout}
          worktreeId={worktreeId}
          onToggleServer={onToggleServer}
          isServerRunning={isServerRunning}
          runScriptName={runScriptName}
          runScriptUrl={runScriptUrl}
          assignedPort={assignedPort}
          isFirstLeaf={true}
        />
      </div>
      <SectionErrorBoundary name="SettingsStatusBar" variant="inline">
        <SettingsStatusBar worktreeId={worktreeId} />
      </SectionErrorBoundary>
    </div>
  );
}

export { LayoutRenderer };

function ServerIndicator({ port }: { port?: number }) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <div className="flex items-end gap-[1.5px] h-[14px]" title={port ? `Server running on port ${port}` : "Server running"}>
        <span className="w-[2.5px] rounded-[1px] bg-status-idle animate-eq-bar-1" />
        <span className="w-[2.5px] rounded-[1px] bg-status-idle animate-eq-bar-2" />
        <span className="w-[2.5px] rounded-[1px] bg-status-idle animate-eq-bar-3" />
        <span className="w-[2.5px] rounded-[1px] bg-status-idle animate-eq-bar-4" />
      </div>
      {port && (
        <span className="text-[11px] font-medium text-text-secondary tabular-nums leading-none">:{port}</span>
      )}
    </div>
  );
}

export { ServerIndicator };

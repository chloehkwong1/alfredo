function ServerIndicator() {
  return (
    <div className="flex items-end gap-[1.5px] h-[14px] flex-shrink-0" title="Server running">
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-1" />
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-2" />
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-3" />
      <span className="w-[2.5px] rounded-[1px] bg-green-400 animate-eq-bar-4" />
    </div>
  );
}

export { ServerIndicator };

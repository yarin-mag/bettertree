export function SkeletonLine({ width = "100%", height = "0.75rem" }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  const widths = ["90%", "75%", "85%", "60%", "95%"];
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}

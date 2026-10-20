import { useSaveStatus } from '../workspace/sync';

/** Shown while saving to the workspace folder fails, so the owner knows edits aren't reaching the disk. */
export function SaveWarning() {
  const error = useSaveStatus((s) => s.error);
  if (!error) return null;
  return (
    <div className="migration-banner storage-warning" role="alert">
      <p>Changes aren't being saved: {error}</p>
    </div>
  );
}

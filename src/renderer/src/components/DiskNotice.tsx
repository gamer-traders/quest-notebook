import { useDiskNotice } from '../workspace/session';

/** Says when a change made on disk outside the app didn't simply happen, such as a page kept because it was being edited. */
export function DiskNotice() {
  const text = useDiskNotice((s) => s.text);
  if (!text) return null;
  return (
    <div className="migration-banner" role="status">
      <p>{text}</p>
      <button className="quiet" onClick={() => useDiskNotice.setState({ text: null })}>
        Dismiss
      </button>
    </div>
  );
}

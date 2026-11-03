/** A thin chevron pointing right. Inside an element with aria-expanded="true" it turns to point down (styles.css). */
export function Chevron() {
  return (
    <svg className="chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 1.8 L6.7 5 L3.5 8.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

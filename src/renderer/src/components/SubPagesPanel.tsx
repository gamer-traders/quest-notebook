import { childrenOf, displayTitle } from '../page/tree';
import { useStore } from '../store';
import type { Notebook } from '../types';

/** The page's direct sub-pages, below its title. Only drawn when it has some. */
export function SubPagesPanel({ page }: { page: Notebook }) {
  const notebooks = useStore((s) => s.notebooks);
  const collapsed = useStore((s) => s.panelCollapsed[page.id] === true);
  const children = childrenOf(notebooks, page.spaceId, page.id);
  if (children.length === 0) return null;
  const { setPanelCollapsed, openNotebook, createPage } = useStore.getState();
  const bodyId = `subpages-${page.id}`;

  return (
    <section className="subpages" aria-label="Sub-pages">
      <button className="subpages-head" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setPanelCollapsed(page.id, !collapsed)}>
        <span className="subpages-twisty" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        Sub-pages ({children.length})
      </button>
      {!collapsed && (
        <ul id={bodyId} className="subpages-list">
          {children.map((child) => {
            const n = childrenOf(notebooks, child.spaceId, child.id).length;
            return (
              <li key={child.id}>
                <button className="subpages-row" onClick={() => openNotebook(child.id)}>
                  <span className="subpages-title">{displayTitle(child.title)}</span>
                  {n > 0 && <span className="subpages-count">{n === 1 ? '1 sub-page' : `${n} sub-pages`}</span>}
                </button>
              </li>
            );
          })}
          <li>
            <button className="subpages-row subpages-add" onClick={() => createPage(page.spaceId, page.id)}>
              + Add sub-page
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}

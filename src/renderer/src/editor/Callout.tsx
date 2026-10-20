import { createReactBlockSpec } from '@blocknote/react';

/** A paragraph set apart: prose on the highlighter's tint, with a rule in its ink down the left. */
export const CalloutBlock = createReactBlockSpec(
  { type: 'callout', propSchema: {}, content: 'inline' },
  {
    render: ({ contentRef }) => <div className="callout" ref={contentRef} />,
  },
);

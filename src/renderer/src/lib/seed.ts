import type { ChartCell, ItemData, Notebook, Space } from '../types';
import { ITEM_BLOCK_FOR, type PageBlock, type StyledText } from '../page/blockTypes';
import { newChart, randomMoment, uid } from './cells';
import { todayDate, todayLabel } from './format';

/** The spaces sample pages go in: a new workspace starts with these three. */
export const SAMPLE_SPACES: Space[] = [
  { id: 'space-journal', name: 'Journal' },
  { id: 'space-market', name: 'Markets' },
  { id: 'space-lesson', name: 'Lessons' },
];

const plain = (text: string): StyledText => ({ type: 'text', text, styles: {} });
const bold = (text: string): StyledText => ({ type: 'text', text, styles: { bold: true } });

const textBlock = (type: string, props: Record<string, unknown>, runs: (string | StyledText)[]): PageBlock => ({
  id: uid(),
  type,
  props,
  content: runs.map((r) => (typeof r === 'string' ? plain(r) : r)),
  children: [],
});

export const paragraph = (...runs: (string | StyledText)[]): PageBlock => textBlock('paragraph', {}, runs);
const heading = (text: string): PageBlock => textBlock('heading', { level: 2 }, [text]);
const bullet = (text: string): PageBlock => textBlock('bulletListItem', {}, [text]);

/** An item block's id is its item's id, so search and review can find it on the page. */
export const itemBlock = (item: ItemData): PageBlock => ({ id: item.id, type: ITEM_BLOCK_FOR[item.type], props: { itemId: item.id }, children: [] });

/** A page built from text blocks and items, in order. */
function page(parts: (PageBlock | ItemData)[]): Pick<Notebook, 'blocks' | 'items'> {
  const items: Record<string, ItemData> = {};
  const blocks = parts.map((part) => {
    if ('children' in part) return part;
    items[part.id] = part;
    return itemBlock(part);
  });
  return { blocks, items };
}

/** Today's journal: a chart, then room to write what you see and what you're watching. */
export function journalPage(chart: ChartCell): Pick<Notebook, 'blocks' | 'items'> {
  return page([chart, heading('What I see'), paragraph(), heading("What I'm watching"), paragraph(), paragraph('#journal')]);
}

export function seedNotebooks(): Notebook[] {
  const now = Date.now();
  // Bitcoin's 2024 range: stuck between ~54k and ~70k from July, broke out on 29 Oct.
  const rangeChart = newChart({
    symbol: 'BTCUSDT',
    interval: '1d',
    asOf: 1730073600,
    levels: [
      { id: uid(), price: 70000 },
      { id: uid(), price: 54000 },
    ],
    trends: [{ id: uid(), a: { time: 1725580800, price: 52550 }, b: { time: 1728518400, price: 58946 } }],
    pins: [
      { id: uid(), time: 1722816000, text: 'Wicked to 49k, closed back near 54k' },
      { id: uid(), time: 1730073600, text: 'Third push into 70k' },
    ],
  });

  const srId = uid();
  // One page in each of the three first spaces, and a practice page under the lesson to show nesting.
  return [
    {
      id: uid(),
      title: todayLabel(),
      journalDate: todayDate(),
      spaceId: 'space-journal',
      parentId: null,
      position: 0,
      createdAt: now,
      updatedAt: now,
      ...journalPage(newChart({ symbol: 'BTCUSDT', interval: '4h' })),
    },
    {
      id: uid(),
      title: 'Bitcoin, big picture',
      spaceId: 'space-market',
      parentId: null,
      position: 0,
      createdAt: now - 3,
      updatedAt: now - 3,
      ...page([
        paragraph('Weekly candles cut out the day-to-day noise. Check this once a week. #bitcoin'),
        newChart({ symbol: 'BTCUSDT', interval: '1w' }),
      ]),
    },
    {
      id: srId,
      title: 'Support and resistance',
      spaceId: 'space-lesson',
      parentId: null,
      position: 0,
      createdAt: now - 1,
      updatedAt: now - 1,
      ...page([
        heading('Support and resistance'),
        paragraph(
          'Support is a price where buyers keep showing up. Resistance is where sellers do. The more times price bounces off a level, the more traders notice it, and the bigger the move when it finally breaks.',
        ),
        paragraph('From July to October 2024, Bitcoin was stuck between roughly ', bold('54k'), ' and ', bold('70k'), '. #support #resistance'),
        rangeChart,
        paragraph('The lows have been rising since September (the trend line), and price is pushing into 70k for the third time. #range'),
        {
          id: uid(),
          type: 'call',
          direction: 'up',
          bars: 20,
          reason: 'Higher lows into resistance. Buyers step in sooner every time. #breakout',
        },
        {
          id: uid(),
          type: 'plan',
          side: 'long',
          entry: 70500,
          stop: 66500,
          target: 78500,
          reason: 'Buy only if it breaks above 70k. Stop back inside the range. #breakout',
        },
        paragraph('Before you reveal, write down what would prove you wrong.'),
        bullet('A daily close back under 66.5k means the breakout failed.'),
      ]),
    },
    {
      id: uid(),
      title: 'Practice: guess the next move',
      spaceId: 'space-lesson',
      parentId: srId,
      position: 0,
      createdAt: now - 2,
      updatedAt: now - 2,
      ...page([
        heading('Guess the next move'),
        paragraph(
          'The chart below is frozen at a random moment with the dates hidden. Mark the levels you see, make a call, then press ',
          bold('What happened next?'),
        ),
        paragraph('Press ', bold('Random moment'), ' on the chart for a fresh one. #practice'),
        newChart({ symbol: 'ETHUSDT', interval: '1d', asOf: randomMoment('1d'), practice: true }),
        { id: uid(), type: 'call', direction: 'up', bars: 10, reason: '' },
      ]),
    },
  ];
}

/** The sample pages, in the given workspace's spaces: matched to the sample spaces by name. Others are left out. */
export function seedFor(spaces: Space[]): Notebook[] {
  const idFor = new Map(SAMPLE_SPACES.flatMap((sample) => {
    const space = spaces.find((s) => s.name === sample.name);
    return space ? [[sample.id, space.id] as const] : [];
  }));
  const pages = seedNotebooks().flatMap((nb) => {
    const spaceId = idFor.get(nb.spaceId);
    return spaceId ? [{ ...nb, spaceId }] : [];
  });
  const kept = new Set(pages.map((p) => p.id));
  return pages.filter((p) => p.parentId === null || kept.has(p.parentId));
}

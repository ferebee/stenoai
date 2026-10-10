import * as React from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CHART_COPY, parseChatChart } from '@/lib/chatChart';
import { ChartErrorBoundary } from '@/components/ChartErrorBoundary';
import yaml from 'js-yaml';
import { t } from '@/i18n';

const ChatChart = React.lazy(() => import('@/components/ChatChart'));
const MarkdownSource = React.createContext('');

function ChartCodeBlock({ node, children, ...props }: React.ComponentProps<'pre'> & ExtraProps) {
  const source = React.useContext(MarkdownSource);
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const language = Array.isArray(classes)
    ? classes
        .find((name) => typeof name === 'string' && name.startsWith('language-'))
        ?.toString()
        .slice(9)
    : undefined;
  const fallback = (
    <pre {...props} data-lang={language}>
      {children}
    </pre>
  );
  if (language !== 'steno-chart' || code?.type !== 'element') return fallback;

  // CommonMark also produces a code node for an unfinished streaming fence.
  // Inspect the source span so charts only render once the fence is closed.
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (start === undefined || end === undefined) return fallback;
  const lines = source.slice(start, end).trimEnd().split(/\r?\n/);
  const opening = lines[0].trimStart().match(/^(`{3,}|~{3,})steno-chart\s*$/)?.[1];
  const closing = lines[lines.length - 1].trim().match(/^(`{3,}|~{3,})$/)?.[1];
  if (!opening || !closing || opening[0] !== closing[0] || closing.length < opening.length)
    return fallback;
  const content = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
  const spec = parseChatChart(content);
  if (!spec) return fallback;
  return (
    <ChartErrorBoundary fallback={fallback}>
      <React.Suspense fallback={<p role="status">{CHART_COPY.loading}</p>}>
        <ChatChart spec={spec} />
      </React.Suspense>
    </ChartErrorBoundary>
  );
}

const markdownComponents = { pre: ChartCodeBlock };

export function stripReasoning(text: string): string {
  if (!text) return text;

  const startsWithReasoning = /^\s*<(think|thought|thinking|reasoning)>/i.test(text);

  // Consumes optional leading spaces on the line, the block, and one optional trailing newline.
  let result = text.replace(
    /(?:^[ \t]*)?<(think|thought|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$(?![\s\S]))\n?/gim,
    ''
  );

  if (startsWithReasoning) {
    result = result.replace(/^\n+/, '');
  }

  return result;
}

// Some providers use typographic bullets rather than Markdown markers. Keep
// those lists readable without changing literal examples inside code fences.
function normalizeBullets(text: string): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim())
          fence = null;
        return line;
      }
      return fence ? line : line.replace(/^( {0,3})•[ \t]+/, '$1- ');
    })
    .join('\n');
}

/** Shared safe Markdown rendering for saved and in-flight chat answers.
 * CommonMark keeps loose lists (blank lines between items) in a single ol,
 * preserves explicit starts and nesting, and handles incomplete streaming text.
 * Raw HTML is never interpreted. GFM retains the existing table support.
 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const source = normalizeBullets(stripReasoning(text));
  return (
    <MarkdownSource.Provider value={source}>
      <div className="chat-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {source}
        </ReactMarkdown>
      </div>
    </MarkdownSource.Provider>
  );
}


// ---------------------------------------------------------------------------
// Report front matter
// ---------------------------------------------------------------------------

// A template that declares fields produces a report whose content OPENS with
// YAML front matter. Markdown has no concept of it, so a renderer handed the
// whole document turns `---` into a horizontal rule and collapses the keys into
// one run-on paragraph — which is what the report view did.
//
// Keys Steno already shows in its own header are dropped here rather than
// repeated: the date and duration sit in the meeting chrome a few pixels above.
const HEADER_DUPLICATE_KEYS = new Set(['date', 'duration_seconds', 'duration', 'language']);

export type ReportProperty = [string, unknown];

/**
 * Split leading YAML front matter from a report.
 *
 * Parsed with js-yaml rather than by hand. Three hand-rolled front matter
 * parsers in this codebase each mangled a different real value — a colon in a
 * title, a list item that looked like a key — and a real loader has none of
 * those edges.
 *
 * Returns no properties for ordinary reports, which have no front matter, so
 * the caller renders exactly what it always did.
 */
export function splitFrontmatter(text: string): { properties: ReportProperty[]; body: string } {
  const empty = { properties: [] as ReportProperty[], body: text ?? '' };
  if (!text || !text.startsWith('---\n')) return empty;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return empty;
  const raw = text.slice(4, end + 1);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    // Unparseable front matter is left in the body rather than thrown away:
    // showing it badly beats losing it silently.
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const properties = Object.entries(parsed as Record<string, unknown>).filter(
    ([k, v]) => !HEADER_DUPLICATE_KEYS.has(k) && v !== null && v !== undefined && v !== '' &&
      !(Array.isArray(v) && v.length === 0),
  );
  return { properties, body };
}

// Keys Steno writes for its own bookkeeping, not facts about the call. They
// stay in the vault's front matter and the PDF; on screen they go under Details.
const STENO_KEYS = new Set(['template_id', 'inferred', 'title_source', 'client_source', 'source_app']);

/**
 * Split a report's properties into what the call established and the rest.
 *
 * Details gets Steno's bookkeeping, the title (the note's heading already shows
 * it) and every field the template marks `(inferred)`: the model's judgement
 * rather than something said on the call. The split follows that mark rather
 * than a list of field names, so a template author decides it. Both halves
 * keep the front matter's order.
 */
export function groupReportProperties(properties: ReportProperty[]): {
  main: ReportProperty[];
  details: ReportProperty[];
} {
  const inferredValue = properties.find(([k]) => k === 'inferred')?.[1];
  const inferred = new Set(
    Array.isArray(inferredValue) ? inferredValue.map(String)
      : typeof inferredValue === 'string' ? [inferredValue] : [],
  );
  const main: ReportProperty[] = [];
  const details: ReportProperty[] = [];
  for (const property of properties) {
    const [key] = property;
    (STENO_KEYS.has(key) || key === 'title' || inferred.has(key) ? details : main).push(property);
  }
  return { main, details };
}

function PropertyValue({ value }: { value: unknown }): React.ReactElement {
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-0.5">
        {value.map((v, i) => (
          <div key={i}>{String(v)}</div>
        ))}
      </div>
    );
  }
  if (typeof value === 'boolean') {
    return <span>{value ? t('report.properties.yes') : t('report.properties.no')}</span>;
  }
  return <span>{String(value)}</span>;
}

/** Key/value rows for a list of properties, without a frame. */
export function PropertyList({
  properties,
  testId,
}: {
  properties: ReportProperty[];
  testId?: string;
}): React.ReactElement {
  return (
    <dl
      className="grid gap-x-4 gap-y-1 text-[13px]"
      style={{ gridTemplateColumns: 'minmax(6rem, max-content) minmax(0, 1fr)' }}
      data-testid={testId}
    >
      {properties.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt style={{ color: 'var(--fg-2)' }}>{key}</dt>
          <dd className="min-w-0" style={{ color: 'var(--fg-1)' }}>
            <PropertyValue value={value} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The lighter, framed box shared by the PDF's header and the on-screen
 *  panel. Colours are inline because the PDF's HTML has no stylesheet. */
export function PropertiesFrame({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      {...rest}
      className={`rounded-lg px-3 py-2.5 ${className ?? ''}`}
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}
    >
      {children}
    </div>
  );
}

/** Every property of a report as one compact header: the PDF's version, which
 *  has no disclosure to open. */
export function ReportProperties({ properties }: { properties: ReportProperty[] }): React.ReactElement | null {
  if (!properties.length) return null;
  return (
    <PropertiesFrame className="mb-4">
      <PropertyList properties={properties} testId="report-properties" />
    </PropertiesFrame>
  );
}

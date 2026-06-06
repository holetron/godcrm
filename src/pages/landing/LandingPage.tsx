import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { TorusBrand } from '@/components/brand/TorusBrand';
import { useTheme } from '@/shared/hooks/useTheme';
import { marketingAuthHref } from '@/shared/utils/marketingBounce';

// Public flip pinned to Pacific Time (06:06:06 PT). June → PDT (UTC−07:00).
const PUBLIC_FLIP = Date.parse('2026-06-06T06:06:06-07:00');

const PublicFlipCountdown = () => {
  const [remaining, setRemaining] = useState(() => PUBLIC_FLIP - Date.now());
  useEffect(() => {
    if (remaining <= 0) return;
    const id = window.setInterval(() => setRemaining(PUBLIC_FLIP - Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [remaining]);
  if (remaining <= 0) return <span>· public flip LIVE</span>;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1_000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <span>
      · public flip 2026-06-06 06:06:06 PT · T-{days}d {pad(hours)}h {pad(mins)}m {pad(secs)}s
    </span>
  );
};

type CapabilityDownload = { label: string; url: string; filename: string; meta: string };
const CAPABILITIES: Array<{
  num: string;
  label: string;
  span: string;
  body: string;
  long: string;
  live?: boolean;
  download?: CapabilityDownload;
}> = [
  {
    num: '01', label: 'TABLES', span: 'md:col-span-7',
    body: 'Programmable schema. 15+ column types, relations, formulas, JSON, files.',
    long: 'Text, number, date, relation, formula, JSON, file, image, AI-generated. Schema mutates live — no downtime, no migrations. Up to 50 columns per table, soft-cap 10M rows. Row-level policies for fine-grained access.',
  },
  {
    num: '02', label: 'VIEWS', span: 'md:col-span-5',
    body: 'Table, Kanban, Calendar, Timeline, Gallery. Same data, any shape.',
    long: 'Same rows, six shapes: table for power-users, kanban for flow, calendar for time, timeline for gantt, gallery for image-first records, list for mobile. Save filters/sorts per view. Share any view publicly by slug — read-only, no login.',
  },
  {
    num: '03', label: 'WIDGETS', span: 'md:col-span-4',
    body: 'Dashboards from any table. Charts, kanban, counters, docs.',
    long: 'Mount any view + KPI counters + chart blocks on a project dashboard. Drag-resize grid, per-widget settings. Embed widget rows inside documents. Snapshot a widget into chat as a live mini-board.',
  },
  {
    num: '04', label: 'AUTOMATIONS', span: 'md:col-span-8',
    body: 'Triggers and actions on row events. Webhooks, notifications, hot-reload every 5 min.',
    long: 'Trigger on row insert/update/delete, schedule, or external webhook. Actions: HTTP call, post chat message, mutate another row, run an agent, send Telegram. Hot-reloads from DB every 5 min — no restart, no deploy.',
  },
  {
    num: '05', label: 'AGENTS', span: 'md:col-span-6',
    body: 'Native first-class. They read, write, chat, and orchestrate other agents.',
    long: 'Agents are rows in a table. Each has a prompt, a tool whitelist, a model (Claude / GPT-5 / local). Mention with @slug in any chat — they read history, call MCP tools, mutate rows, spawn other agents. First-class participants, not a chatbot bolted on the side.',
  },
  {
    num: '06', label: 'API', span: 'md:col-span-6',
    body: 'REST v3 on every table, row, widget. JWT, OpenAPI, signed webhooks.',
    long: 'REST v3 on every entity — tables, rows, widgets, chats, projects. JWT auth, full OpenAPI 3.1 spec, signed webhooks with token-hash. Pagination, filters, sort, search — the same engine your views use is the same API external systems get.',
  },
  {
    num: '07', label: 'MCP', span: 'md:col-span-6',
    body: 'Native MCP server. Claude Desktop, Cursor, any MCP client drives your CRM.',
    long: 'Native Model Context Protocol server exposes 70+ tools — query tables, create rows, manage widgets, spawn agents, search globally. Point Claude Desktop, Cursor, Zed, or any MCP client at your workspace and it operates the CRM like a power user. No glue code, no scraping.',
  },
  {
    num: '08', label: 'ARTIFACTS', span: 'md:col-span-6',
    body: 'Real apps, not browser-only. Android, desktop, Photoshop plugin.',
    long: 'Android app (Flutter) — chat, tables, agents in your pocket. Desktop client for Linux and Windows — file uploads, offline cache. Photoshop plugin — push designs straight into CRM rows. iOS in active development. One platform, many surfaces.',
    live: true,
    download: {
      label: 'PHOTOSHOP PLUGIN',
      url: 'https://crm.hltrn.cc/uploads/general/file_1774675604_godcrm_v17.3.ccx',
      filename: 'godcrm-photoshop-v17.3.ccx',
      meta: 'v17.3 · 40 KB · .ccx',
    },
  },
];

const QUICKSTART_STEPS = [
  { num: '01', label: 'CREATE A SPACE',   time: '60 sec'  },
  { num: '02', label: 'ADD A TABLE',      time: '60 sec'  },
  { num: '03', label: 'DEFINE COLUMNS',   time: '120 sec' },
  { num: '04', label: 'DROP IN ROWS',     time: '30 sec'  },
  { num: '05', label: 'SWITCH TO KANBAN', time: '30 sec'  },
];

const AUDIENCE = [
  { label: 'COMPANIES',       body: 'Customers, products, orders, finance. Daily revenue and overdue invoices at a glance.' },
  { label: 'TEAMS',           body: 'Kanban tasks, shared docs, common calendar. One system, zero SaaS sprawl.' },
  { label: 'BUILDERS & DEVS', body: 'Programmable database with built-in frontend. Full v3 API, agents, open-core.' },
];

const PROOF = [
  { big: '10–200',        small: 'USERS PER WORKSPACE' },
  { big: 'OPEN-CORE',     small: 'SELF-HOST OR HOSTED' },
  { big: 'AGENTS NATIVE', small: 'FIRST-CLASS, NOT BOLTED ON' },
  { big: 'ALPHA',         small: '2026-06-06 · OPEN ACCESS' },
];

const LandingThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => {
        sessionStorage.setItem('welcome-theme-touched', '1');
        toggleTheme();
      }}
      className="brutal-edge border-2 p-2 transition-colors hover:bg-[var(--text-primary)] hover:text-[var(--bg-primary)]"
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

type KbDoc = { name: string; slug: string };

const LandingPage = () => {
  const { setTheme } = useTheme();
  const [kbDocs, setKbDocs] = useState<KbDoc[] | null>(null);
  const [kbCount, setKbCount] = useState<number | null>(null);

  useEffect(() => {
    const userDefault = localStorage.getItem('god-crm-default-theme');
    const touched = sessionStorage.getItem('welcome-theme-touched');
    if ((!userDefault || userDefault === 'system') && !touched) {
      setTheme('dark');
    }
  }, [setTheme]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/v3/public/s/help/docs?limit=100', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        const data = json as { data?: { documents?: Array<{ name?: string; slug?: string }> } } | null;
        const list = data?.data?.documents;
        if (!Array.isArray(list)) return;
        setKbCount(list.length);
        setKbDocs(
          list
            .filter((d): d is { name: string; slug: string } => typeof d.name === 'string' && typeof d.slug === 'string')
            .slice(0, 3)
            .map((d) => ({ name: d.name, slug: d.slug })),
        );
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <main className="brutal-root relative min-h-screen overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <style>{`
        .brutal-edge { border-color: var(--text-primary); }
        .brutal-shadow {
          transition: transform 150ms ease-out, box-shadow 150ms ease-out;
        }
        .brutal-shadow:hover {
          box-shadow: 6px 6px 0 var(--text-primary);
          transform: translate(-2px, -2px);
        }
        .brutal-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(var(--text-primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--text-primary) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.05;
        }
        .brutal-glow {
          text-shadow: 0 0 24px var(--accent-primary);
        }
        .brutal-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 3px,
            var(--text-primary) 3px,
            var(--text-primary) 4px
          );
          opacity: 0.025;
        }
        .cap-card { position: relative; cursor: pointer; }
        .cap-card > summary {
          list-style: none;
          cursor: pointer;
          display: block;
          padding: 1.5rem;
        }
        @media (min-width: 768px) {
          .cap-card > summary { padding: 2rem; }
        }
        .cap-card > summary::-webkit-details-marker { display: none; }
        .cap-card-toggle {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          width: 1.75rem;
          height: 1.75rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 1.1rem;
          font-weight: 900;
          color: var(--text-secondary);
          pointer-events: none;
          transition: color 150ms ease-out;
        }
        .cap-card:hover .cap-card-toggle { color: var(--text-primary); }
        .cap-card-toggle::before { content: '+'; }
        .cap-card[open] .cap-card-toggle::before { content: '–'; }
        .cap-card-body {
          padding: 0 1.5rem 1.5rem;
        }
        @media (min-width: 768px) {
          .cap-card-body { padding: 0 2rem 2rem; }
        }
        .video-tile {
          background-image:
            radial-gradient(ellipse at center, rgba(96, 165, 250, 0.18) 0%, transparent 60%),
            repeating-linear-gradient(
              45deg,
              transparent 0px,
              transparent 12px,
              rgba(96, 165, 250, 0.06) 12px,
              rgba(96, 165, 250, 0.06) 14px
            );
        }
        @media (prefers-reduced-motion: reduce) {
          .brutal-shadow { transition: none; }
          .brutal-shadow:hover { box-shadow: none; transform: none; }
          .brutal-glow { text-shadow: none; }
          .brutal-scanlines { display: none; }
        }
      `}</style>

      {/* Top bar */}
      <header className="brutal-edge sticky top-0 z-40 flex h-14 items-center justify-between border-b-2 bg-[var(--bg-primary)] px-4 md:px-6">
        <div className="flex items-center gap-2 font-mono text-sm font-black uppercase tracking-widest">
          <span>GOD CRM</span>
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-red-500"
            style={{ animation: 'pulse 2s ease-in-out infinite' }}
          />
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <LandingThemeToggle />
          <a
            href={marketingAuthHref('/auth/login')}
            className="brutal-edge brutal-shadow border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest"
          >
            SIGN IN
          </a>
          <a
            href={marketingAuthHref('/auth/register')}
            className="brutal-shadow inline-flex items-center justify-center border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest text-white"
            style={{
              background: 'var(--color-primary-500)',
              borderColor: 'var(--color-primary-500)',
            }}
          >
            SIGN UP
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-start overflow-hidden px-6 pt-0 pb-6 md:pt-0 md:pb-12">
        <div className="brutal-grid" aria-hidden />
        <div className="relative flex w-full flex-col items-center">
          <TorusBrand
            size="hero"
            interactive
            className="origin-top scale-[0.9] md:scale-[1.5] -mt-12 md:-mt-24"
          />
          <h1 className="brutal-glow mt-0 w-full max-w-4xl text-balance break-words text-center text-2xl font-black uppercase leading-[0.95] tracking-tighter text-[var(--text-primary)] sm:text-4xl md:mt-64 md:text-6xl">
            The CRM where agents are<br className="hidden sm:inline" /> first-class citizens.
          </h1>
          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4 md:mt-8">
            <a
              href="https://t.me/god_crm"
              target="_blank"
              rel="noopener noreferrer"
              className="brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest text-white"
              style={{
                background: 'var(--color-primary-500)',
                borderColor: 'var(--color-primary-500)',
              }}
            >
              ▶ JOIN TELEGRAM
            </a>
            <a
              href={marketingAuthHref('/auth/register')}
              className="brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest text-white"
              style={{
                background: 'var(--color-primary-500)',
                borderColor: 'var(--color-primary-500)',
              }}
            >
              SIGN UP
            </a>
            <a
              href={marketingAuthHref('/auth/login')}
              className="brutal-edge brutal-shadow inline-flex items-center justify-center border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest"
            >
              SIGN IN
            </a>
          </div>

          {/* Hero KB preview — live proof that /s/help is a real public surface */}
          <div className="mt-6 flex max-w-md flex-col items-center gap-1.5 text-center md:items-start md:text-left">
            <Link
              to="/s/help"
              className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] underline decoration-dotted underline-offset-4 hover:text-[var(--text-primary)] md:text-xs"
            >
              NEW HERE? → KNOWLEDGE BASE{kbCount !== null ? ` (${kbCount} ARTICLES)` : ''}
            </Link>
            {kbDocs && kbDocs.length > 0 && (
              <ul className="space-y-0.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] md:text-xs">
                {kbDocs.map((d) => (
                  <li key={d.slug} className="truncate">
                    · {d.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-8 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
            v1.0.0-alpha <PublicFlipCountdown />
          </div>
        </div>
      </section>

      {/* Manifesto */}
      <section className="brutal-edge relative overflow-hidden border-y-2 px-6 py-24 md:py-32">
        <div className="brutal-scanlines" aria-hidden />
        <div className="relative mx-auto max-w-5xl space-y-8 text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
          <p>
            We started from a simple question.<br />
            Why do all CRMs assume the operator is a <span className="brutal-glow">human</span>?
          </p>
          <p>
            GOD CRM is built the other way around. <span className="brutal-glow">Agents</span> read rows,
            mutate state, and talk back — through the same <span className="brutal-glow">API</span> you use.
            No plugins. No <span className="brutal-glow">bolt-ons</span>.
          </p>
        </div>
      </section>

      {/* Video showcase — 90s walkthrough */}
      <section className="px-6 py-12 md:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              90 SECONDS · WHAT IT FEELS LIKE
            </h2>
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)]">
              WATCH
            </span>
          </div>
          <div className="brutal-edge brutal-shadow video-tile relative aspect-video overflow-hidden border-2">
            <iframe
              className="absolute inset-0 h-full w-full"
              src="https://www.youtube-nocookie.com/embed/3SCSoX9x0Z8?rel=0"
              title="GOD CRM · 90 second walkthrough"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              CAPABILITIES
            </h2>
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)]">
              08 / 08
            </span>
          </div>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-12">
            {CAPABILITIES.map((cap) => (
              <details
                key={cap.num}
                className={`cap-card brutal-edge brutal-shadow border-2 ${cap.span} -mt-[2px] md:-ml-[2px] md:mt-0 first:mt-0 md:first:ml-0`}
              >
                <summary aria-label={`Toggle ${cap.label} details`}>
                  <span className="cap-card-toggle" aria-hidden />
                  <div className="flex items-baseline gap-4 pr-8">
                    <span className="font-mono text-4xl font-black opacity-30 md:text-5xl">{cap.num}</span>
                    <h3 className="text-xl font-black uppercase tracking-tighter md:text-2xl">{cap.label}</h3>
                    {cap.live && (
                      <span
                        aria-label="Live now"
                        className="ml-1 inline-flex items-center gap-1 border-2 border-green-500 px-1.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-green-500"
                      >
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        LIVE
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                    {cap.body}
                  </p>
                </summary>
                <div className="cap-card-body">
                  {cap.download && (
                    <a
                      href={cap.download.url}
                      download={cap.download.filename}
                      onClick={(e) => e.stopPropagation()}
                      className="brutal-edge brutal-shadow mb-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest text-[var(--text-primary)] hover:text-[var(--text-primary)]"
                    >
                      <span>↓ DOWNLOAD {cap.download.label}</span>
                      <span className="font-mono text-[10px] font-normal tracking-widest text-[var(--text-secondary)]">
                        {cap.download.meta}
                      </span>
                    </a>
                  )}
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {cap.long}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Quickstart */}
      <section className="brutal-edge border-y-2 bg-[var(--bg-secondary)] px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 flex flex-col items-baseline gap-2 md:flex-row md:justify-between">
            <h2 className="text-5xl font-black uppercase tracking-tighter md:text-7xl">5 MINUTES</h2>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)] md:text-sm">
              FROM ZERO TO RUNNING CRM
            </p>
          </div>
          <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 md:grid-cols-5">
            {QUICKSTART_STEPS.map((step) => (
              <div
                key={step.num}
                className="brutal-edge -mt-[2px] border-2 p-5 first:mt-0 sm:-ml-[2px] sm:mt-0 sm:first:ml-0"
              >
                <div className="font-mono text-xs font-black uppercase tracking-widest opacity-50">
                  STEP {step.num}
                </div>
                <div className="mt-3 text-lg font-black uppercase leading-tight tracking-tighter">
                  {step.label}
                </div>
                <div className="mt-4 font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)]">
                  {step.time}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <a
              href="https://t.me/god_crm"
              target="_blank"
              rel="noopener noreferrer"
              className="brutal-edge brutal-shadow inline-flex w-full max-w-2xl items-center justify-center border-2 px-6 py-5 font-mono text-sm font-black uppercase tracking-widest md:text-base"
            >
              ▶ TRY IT NOW — JOIN TELEGRAM
            </a>
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-10 font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
            WHO IT'S FOR
          </h2>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-3">
            {AUDIENCE.map((aud) => (
              <article
                key={aud.label}
                className="brutal-edge -mt-[2px] border-2 p-6 first:mt-0 md:-ml-[2px] md:mt-0 md:first:ml-0"
              >
                <h3 className="text-2xl font-black uppercase tracking-tighter md:text-3xl">{aud.label}</h3>
                <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                  {aud.body}
                </p>
                <div className="mt-6 font-mono text-xl font-black">→</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Proof */}
      <section className="brutal-edge border-y-2 bg-[var(--bg-secondary)] px-6 py-16">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 md:grid-cols-4">
          {PROOF.map((p) => (
            <div key={p.small} className="text-center">
              <div className="text-3xl font-black uppercase tracking-tighter md:text-4xl">{p.big}</div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
                {p.small}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-4 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
          <p>© 2026 HOLETRON LTD</p>
          <p className="flex flex-wrap gap-x-3 gap-y-2">
            <a
              href="https://hltrn.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              HLTRN.CC
            </a>
            <span aria-hidden>·</span>
            <a
              href="https://github.com/holetron"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              GITHUB.COM/HOLETRON
            </a>
            <span aria-hidden>·</span>
            <Link
              to="/s/help"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              CHARTER
            </Link>
          </p>
          <div className="brutal-edge mt-6 border-t-2 pt-4 leading-relaxed">
            <p>GENERATIVE ORCHESTRATION & DEVELOPMENT</p>
            <p>CRITICAL RESOURCE MANAGER</p>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default LandingPage;

import prisma from '@/lib/prisma';
import { json, unauthorized } from '@/lib/response';

// Deletes visitor data older than 24 months, as the privacy policy of kopetzki.law states.
// Vercel calls this route once a day (vercel.json); same tables as the retention job of the
// Arbitration Agreement Builder's instance.
const MONTHS = 24;
const TABLES = [
  'event_data',
  'session_data',
  'website_event',
  'revenue',
  'session_replay',
  'heatmap_event',
  'session_link',
];

// With CRON_SECRET set, Vercel sends it as a bearer token; without it, only Vercel's cron agent
// is accepted. Either way the route can only delete what is past the retention period.
function isCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    return request.headers.get('authorization') === `Bearer ${secret}`;
  }

  return (request.headers.get('user-agent') || '').startsWith('vercel-cron/');
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return unauthorized();
  }

  const cutoff = `now() - interval '${MONTHS} months'`;
  const deleted: Record<string, number> = {};

  for (const table of TABLES) {
    deleted[table] = Number(
      await prisma.client.$executeRawUnsafe(`delete from ${table} where created_at < ${cutoff}`),
    );
  }

  deleted.session = Number(
    await prisma.client.$executeRawUnsafe(
      `delete from session s where s.created_at < ${cutoff}
         and not exists (select 1 from website_event e where e.session_id = s.session_id)`,
    ),
  );

  return json({ months: MONTHS, deleted });
}

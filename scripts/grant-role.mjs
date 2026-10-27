#!/usr/bin/env node
/**
 * Grant a role to an existing user.
 *
 *   npm run grant -- <email> <role> [market-slug]
 *   npm run grant -- kareemgad@gmail.com reviewer dubai
 *   npm run grant -- kareemgad@gmail.com global_admin
 *   npm run grant -- --list
 *
 * A script rather than a migration, deliberately: migrations must not hardcode
 * generated ids, and who holds which role is operational state rather than
 * schema. It also means granting is an explicit, auditable act someone
 * performed, not something that happened silently on deploy.
 *
 * This creates no accounts. The user must already exist, created through the
 * Supabase dashboard, so account creation and credential handling stay outside
 * this repository entirely.
 */

import postgres from 'postgres';

const ROLES = ['global_admin', 'market_manager', 'reviewer', 'venue_operator', 'end_user'];

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  onnotice: () => {},
});

const args = process.argv.slice(2).filter((a) => a !== '--');

async function list() {
  const rows = await sql`
    select u.email, ra.role, coalesce(m.slug, '(all markets)') as market, ra.granted_at
    from role_assignments ra
    join auth.users u on u.id = ra.user_id
    left join markets m on m.id = ra.market_id
    order by u.email, ra.role, market
  `;
  if (rows.length === 0) {
    console.log('No roles granted yet.');
    return;
  }
  console.log('\ncurrent role assignments:');
  for (const r of rows) {
    console.log(`  ${String(r.email).padEnd(28)} ${String(r.role).padEnd(15)} ${r.market}`);
  }
}

try {
  if (args.length === 0 || args[0] === '--list') {
    await list();
  } else {
    const [email, role, marketSlug] = args;

    if (!email || !role) {
      console.error('Usage: npm run grant -- <email> <role> [market-slug]');
      process.exit(1);
    }
    if (!ROLES.includes(role)) {
      console.error(`Unknown role "${role}". One of: ${ROLES.join(', ')}`);
      process.exit(1);
    }

    const users = await sql`select id, email from auth.users where email = ${email}`;
    const user = users[0];
    if (!user) {
      console.error(
        `No user with email ${email}. Create the account in the Supabase dashboard first ` +
          `(Authentication -> Users -> Add user); this script never creates accounts.`,
      );
      process.exit(1);
    }

    let marketId = null;
    if (role !== 'global_admin') {
      if (!marketSlug) {
        console.error(`Role "${role}" is market-scoped. Pass a market slug.`);
        process.exit(1);
      }
      const markets = await sql`select id, slug from markets where slug = ${marketSlug}`;
      const market = markets[0];
      if (!market) {
        console.error(`No market with slug "${marketSlug}".`);
        process.exit(1);
      }
      marketId = market.id;
    } else if (marketSlug) {
      console.error('global_admin covers every market and takes no market slug.');
      process.exit(1);
    }

    await sql`
      insert into role_assignments (user_id, role, market_id)
      values (${user.id}, ${role}::app_role, ${marketId})
      on conflict (user_id, role, market_id) do nothing
    `;

    console.log(
      `granted ${role}${marketSlug ? ` on ${marketSlug}` : ' (all markets)'} to ${email}`,
    );
    await list();
  }
} catch (error) {
  console.error(`\nGrant failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

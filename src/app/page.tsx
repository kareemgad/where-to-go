/**
 * Holding page. The real entry point is the market selector; until the market
 * model lands there is nothing to select, and inventing a default here would
 * be the first hardcoded market (ADR-009).
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Where to Go</h1>
      <p className="mt-2 text-neutral-600">Find your kind of night.</p>
      <p className="mt-6 text-sm text-neutral-500">
        Prototype scaffold. Money, time and the market-literal guard are in place; the
        market model, venues and search are next.
      </p>
    </main>
  );
}

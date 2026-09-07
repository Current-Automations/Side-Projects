export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <span className="text-lg font-bold tracking-tight text-white">CardSnap</span>
        <a
          href="#"
          className="rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          Install Extension
        </a>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 py-24 max-w-3xl mx-auto">
        <h1 className="text-5xl font-bold tracking-tight text-white leading-tight mb-6">
          ID any sports card in{" "}
          <span className="text-orange-500">3 seconds</span>
          <br />
          without leaving the stream
        </h1>
        <p className="text-xl text-zinc-400 mb-10 leading-relaxed">
          Press a hotkey while watching Whatnot, TikTok Live, or Instagram Live.
          CardSnap captures the frame, identifies the card, and returns price data — instantly.
        </p>
        <a
          href="#"
          className="inline-block rounded-full bg-orange-500 px-8 py-4 text-base font-semibold text-white hover:bg-orange-400 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          Install Free Extension
        </a>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 max-w-4xl mx-auto" aria-labelledby="how-it-works-heading">
        <h2
          id="how-it-works-heading"
          className="text-2xl font-bold text-center text-white mb-12"
        >
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-8 sm:grid-cols-3" role="list">
          {[
            {
              step: "1",
              title: "Press the hotkey",
              body: "Hit your assigned shortcut while the card is on screen. No pausing, no switching tabs.",
            },
            {
              step: "2",
              title: "AI identifies the card",
              body: "CardSnap captures the frame and identifies the card — set, year, player, variant.",
            },
            {
              step: "3",
              title: "See the price",
              body: "Recent sold listings surface in seconds so you know exactly what it's worth.",
            },
          ].map(({ step, title, body }) => (
            <li key={step} className="flex flex-col items-center text-center sm:items-start sm:text-left">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 text-white font-bold text-sm mb-4">
                {step}
              </span>
              <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
              <p className="text-zinc-400 leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16 max-w-5xl mx-auto" aria-labelledby="pricing-heading">
        <h2
          id="pricing-heading"
          className="text-2xl font-bold text-center text-white mb-4"
        >
          Plans
        </h2>
        <p className="text-center text-zinc-400 mb-12">
          Start free. Upgrade when you need more.
        </p>

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th scope="col" className="px-6 py-4 text-left font-semibold text-zinc-300">
                  Plan
                </th>
                <th scope="col" className="px-6 py-4 text-left font-semibold text-zinc-300">
                  Price
                </th>
                <th scope="col" className="px-6 py-4 text-left font-semibold text-zinc-300">
                  Scans / day
                </th>
                <th scope="col" className="px-6 py-4 text-left font-semibold text-zinc-300">
                  Includes
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  name: "Free",
                  price: "$0",
                  scans: "10",
                  includes: "Card ID + price data",
                  highlight: false,
                },
                {
                  name: "Basic",
                  price: "$7 / mo",
                  scans: "100",
                  includes: "Card ID + price data",
                  highlight: false,
                },
                {
                  name: "Pro",
                  price: "$15 / mo",
                  scans: "Unlimited",
                  includes: "Card ID + price data",
                  highlight: true,
                },
                {
                  name: "Streamer",
                  price: "$29 / mo",
                  scans: "Unlimited",
                  includes: "Card ID + price data + API access",
                  highlight: false,
                },
              ].map(({ name, price, scans, includes, highlight }) => (
                <tr
                  key={name}
                  className={`border-b border-zinc-800 last:border-0 transition-colors ${
                    highlight ? "bg-zinc-800/60" : "bg-zinc-900/30"
                  }`}
                >
                  <td className="px-6 py-4 font-semibold text-white">
                    {name}
                    {highlight && (
                      <span className="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
                        Popular
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-zinc-300">{price}</td>
                  <td className="px-6 py-4 text-zinc-300">{scans}</td>
                  <td className="px-6 py-4 text-zinc-400">{includes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 text-center">
          <a
            href="#"
            className="inline-block rounded-full bg-orange-500 px-8 py-4 text-base font-semibold text-white hover:bg-orange-400 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            Install Free Extension
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-8 text-center text-sm text-zinc-500">
        <p>&copy; {new Date().getFullYear()} CardSnap. Built for collectors.</p>
      </footer>
    </div>
  );
}

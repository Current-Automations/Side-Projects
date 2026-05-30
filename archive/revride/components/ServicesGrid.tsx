const services = [
  {
    icon: "🛢️",
    title: "Oil Changes",
    desc: "Conventional, synthetic, and full synthetic options — done fast at your location.",
  },
  {
    icon: "🔧",
    title: "Brake Service",
    desc: "Pad replacements, rotor resurfacing, and brake fluid flushes for safe stopping.",
  },
  {
    icon: "🚗",
    title: "Suspension & Steering",
    desc: "Shocks, struts, tie rods, and alignment checks — keep your ride smooth and straight.",
  },
  {
    icon: "⚡",
    title: "Spark Plugs & Ignition",
    desc: "New plugs and ignition system service for a strong, reliable start every time.",
  },
  {
    icon: "🔩",
    title: "Belts & Hoses",
    desc: "Timing belts, serpentine belts, and coolant hoses inspected and replaced on-site.",
  },
  {
    icon: "🔍",
    title: "Diagnostics",
    desc: "OBD-II scanning and full diagnostic checks to find what's wrong before it gets worse.",
  },
  {
    icon: "🛠️",
    title: "General Maintenance",
    desc: "Fluid top-ups, filter replacements, and seasonal checks to keep you on the road.",
  },
];

export default function ServicesGrid() {
  return (
    <section
      id="services"
      className="section-spacing"
      style={{ background: "rgba(255,255,255,0.018)" }}
    >
      <div className="container-shell">
        {/* Header */}
        <div className="mb-14 text-center">
          <span className="gold-tag">What We Fix</span>
          <h2
            className="mt-5 text-4xl font-bold uppercase tracking-tight sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "var(--font-oswald), sans-serif" }}
          >
            Services We Offer
          </h2>
          <p
            className="mt-4 max-w-xl mx-auto text-base sm:text-lg leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Professional mechanical work — brought to your driveway, parking
            lot, or workplace.
          </p>
        </div>

        {/* Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {services.map((s) => (
            <div
              key={s.title}
              className="service-card transition-all duration-200"
            >
              <span className="text-3xl">{s.icon}</span>
              <h3
                className="mt-4 text-lg font-bold uppercase tracking-wide"
                style={{
                  fontFamily: "var(--font-oswald), sans-serif",
                  color: "var(--gold)",
                }}
              >
                {s.title}
              </h3>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: "var(--muted)" }}
              >
                {s.desc}
              </p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <p
            className="mb-5 text-sm uppercase tracking-widest"
            style={{ color: "var(--muted)" }}
          >
            Not sure if we cover your job? Just ask.
          </p>
          <a href="tel:+13435520222" className="btn-primary">
            Call to Book
          </a>
        </div>
      </div>
    </section>
  );
}

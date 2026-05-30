const steps = [
  {
    number: "01",
    title: "Book via Call or DM",
    desc: "Call us at +1 (343) 552-0222 or send a DM on Instagram @RevRide.Auto. Tell us what's going on and we'll get you scheduled fast.",
    cta: { label: "Call Now", href: "tel:+13435520222" },
  },
  {
    number: "02",
    title: "We Come To You",
    desc: "A certified mechanic arrives at your home, office, or wherever your vehicle is parked in Ottawa or surrounding areas. No towing, no waiting room.",
    cta: null,
  },
  {
    number: "03",
    title: "Job Done",
    desc: "We complete the work on-site and get you back on the road. Straightforward service, no surprises.",
    cta: null,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="section-spacing">
      <div className="container-shell">
        {/* Header */}
        <div className="mb-14 text-center">
          <span className="gold-tag">Simple Process</span>
          <h2
            className="mt-5 text-4xl font-bold uppercase tracking-tight sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "var(--font-oswald), sans-serif" }}
          >
            How It Works
          </h2>
          <p
            className="mt-4 text-base sm:text-lg"
            style={{ color: "var(--muted)" }}
          >
            Three steps. No shop. No waiting room.
          </p>
        </div>

        {/* Steps */}
        <div className="grid gap-6 lg:grid-cols-3">

          {steps.map((step, i) => (
            <div
              key={step.number}
              className="relative flex flex-col items-center rounded-2xl p-8 text-center"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
              }}
            >
              {/* Number bubble */}
              <div
                className="relative z-10 mb-6 flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold"
                style={{
                  background:
                    i === 1 ? "var(--gold)" : "rgba(201,168,76,0.08)",
                  color: i === 1 ? "#0a0a0a" : "var(--gold)",
                  border: i === 1 ? "none" : "1px solid var(--gold-border)",
                  fontFamily: "var(--font-oswald), sans-serif",
                }}
              >
                {step.number}
              </div>

              <h3
                className="text-xl font-bold uppercase tracking-wide"
                style={{ fontFamily: "var(--font-oswald), sans-serif" }}
              >
                {step.title}
              </h3>
              <p
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "var(--muted)" }}
              >
                {step.desc}
              </p>

              {step.cta && (
                <a
                  href={step.cta.href}
                  className="btn-primary mt-6 px-6 py-3 text-xs"
                >
                  {step.cta.label}
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <a
            href="https://www.instagram.com/RevRide.Auto"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline px-8 py-4"
          >
            DM @RevRide.Auto on Instagram
          </a>
        </div>
      </div>
    </section>
  );
}

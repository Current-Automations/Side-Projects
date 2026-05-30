export default function Hero() {
  return (
    <section
      className="relative flex min-h-[92vh] flex-col items-center justify-center overflow-hidden py-24 text-center"
      style={{
        background:
          "radial-gradient(ellipse 90% 55% at 50% 0%, rgba(201,168,76,0.13) 0%, transparent 65%), #0a0a0a",
      }}
    >
      {/* Subtle grid texture */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Gold top border accent */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }}
      />

      <div className="container-shell relative z-10 flex flex-col items-center gap-8">
        {/* Badge */}
        <span className="gold-tag">Ottawa & Surrounding Areas</span>

        {/* Main heading */}
        <h1
          className="max-w-4xl text-4xl font-bold uppercase leading-[1.04] tracking-tight sm:text-6xl lg:text-[5.5rem]"
          style={{ fontFamily: "var(--font-oswald), sans-serif" }}
        >
          Your Mechanic,{" "}
          <span style={{ color: "var(--gold)" }}>At Your Door.</span>
        </h1>

        {/* Tagline */}
        <p
          className="max-w-xl text-lg leading-relaxed sm:text-xl"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Skip the shop, the wait, and the tow truck. RevRide Auto brings
          certified mechanical service straight to your driveway or parking lot.
        </p>

        {/* CTAs */}
        <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row sm:items-center">
          <a
            href="tel:+13435520222"
            className="btn-primary justify-center py-5 text-sm sm:px-8"
          >
            <svg
              width="18"
              height="18"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              className="shrink-0"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
              />
            </svg>
            Call +1 (343) 552-0222
          </a>

          <a
            href="https://www.instagram.com/RevRide.Auto"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline justify-center py-5 text-sm sm:px-8"
          >
            <svg
              width="18"
              height="18"
              fill="currentColor"
              viewBox="0 0 24 24"
              className="shrink-0"
            >
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
            DM on Instagram
          </a>
        </div>

        {/* Trust strip */}
        <div
          className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-bold uppercase tracking-widest"
          style={{ color: "rgba(255,255,255,0.38)" }}
        >
          {[
            "No Shop, No Waiting",
            "Certified Mechanics",
            "We Come To You",
          ].map((item) => (
            <span key={item} className="flex items-center gap-2">
              <span style={{ color: "var(--gold)" }}>✓</span>
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom fade */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
        style={{
          background:
            "linear-gradient(to bottom, transparent, #0a0a0a)",
        }}
      />
    </section>
  );
}

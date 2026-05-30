import type { Metadata } from "next";
import { Oswald } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "RevRide Auto | Mobile Mechanic — Ottawa & Surrounding Areas",
  description:
    "RevRide Auto brings certified mechanical service to your door. Oil changes, brake service, diagnostics and more — serving Ottawa and surrounding areas.",
  openGraph: {
    title: "RevRide Auto | Mobile Mechanic — Ottawa",
    description:
      "We come to you. Mobile mechanic serving Ottawa & surrounding areas.",
    type: "website",
    siteName: "RevRide Auto",
  },
  twitter: {
    card: "summary_large_image",
    title: "RevRide Auto | Mobile Mechanic — Ottawa",
    description: "We come to you. Mobile mechanic serving Ottawa & surrounding areas.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={oswald.variable}>
      <body>
        <div className="site-shell">
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}

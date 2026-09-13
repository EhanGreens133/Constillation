import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "Constellation",
  description: "A personal archive. The export is the artifact; this application is the convenience.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistrar />
        <Nav />
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}

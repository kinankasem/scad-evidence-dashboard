import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCAD | Evidence & Gap Assessment Dashboard",
  description: "Interactive dashboard for evidence tracking, gap assessment, and procedural file completion.",
  openGraph: {
    title: "SCAD Evidence & Gap Assessment Dashboard",
    description: "Evidence tracking, gap assessment, and procedural file completion",
    images: ["/dashboard/assets/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SCAD Evidence & Gap Assessment Dashboard",
    description: "Evidence tracking, gap assessment, and procedural file completion",
    images: ["/dashboard/assets/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" dir="ltr"><body>{children}</body></html>;
}

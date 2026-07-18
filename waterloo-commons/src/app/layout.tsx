import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waterloo Commons Events",
  description: "Submit, curate, and publish Waterloo Commons event posts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

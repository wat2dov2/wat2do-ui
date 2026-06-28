import type { Metadata } from "next";
import type { ReactNode } from "react";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "../index.css";

export const metadata: Metadata = {
  title: "Wat2Do Pitch Deck",
  description: "Wat2Do investor and product pitch deck.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

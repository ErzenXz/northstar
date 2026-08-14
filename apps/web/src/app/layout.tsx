import type { Metadata } from "next";
import { Header } from "@/components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Origin — The open AI software forge", template: "%s · Origin" },
  description: "Host code, move projects, and let humans and agents build together on an open forge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}

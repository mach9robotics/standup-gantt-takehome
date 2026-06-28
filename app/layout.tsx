import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Standup Gantt Takehome",
  description: "Build a per-person Gantt of Linear issues and GitHub pull requests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pulse Pomodoro Next",
  description: "Pomodoro tracker with project analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

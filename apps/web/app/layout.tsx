import type { Metadata } from "next";
import { Sora, Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";

const display = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dock2Door — Move anything. Anywhere. On time.",
  description:
    "The all-in-one logistics network connecting shippers, warehouses, drayage, trucking and labour on one operating system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable}`}>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}

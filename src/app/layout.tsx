import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Freat Editz — Download Gateway",
  description: "Secure, simple access to Freat Editz resources.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable}`}>
      <body className="font-sans bg-bg text-text-primary min-h-screen antialiased">
        <div className="grid-bg min-h-screen">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppKitProvider } from "@/components/AppKitProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chog Mischief — a daily prank war for Chog Genesis holders",
  description:
    "Every Chog Genesis NFT is a player. Prank other Chogs, get pranked back, and carry your chaos history forever. Free to play — no gas, ever.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppKitProvider>{children}</AppKitProvider>
      </body>
    </html>
  );
}

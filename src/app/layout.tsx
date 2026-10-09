import type { Metadata } from "next";
import { Geist, Geist_Mono, Lilita_One } from "next/font/google";
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

// Lilita One is the design's display face - the heavy cartoon lettering behind
// every headline and the HIT!/DODGED! stings. Mandated by
// design/source/design/UI_RULES.md; do not substitute.
const lilitaOne = Lilita_One({
  variable: "--font-lilita-one",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Chog Mischief - a daily prank war for Chog Genesis holders",
  description:
    "Every Chog Genesis NFT is a player. Prank other Chogs, get pranked back, and carry your chaos history forever. Free to play. No gas, ever.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${lilitaOne.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <AppKitProvider>{children}</AppKitProvider>
      </body>
    </html>
  );
}
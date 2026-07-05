import type { Metadata } from "next";
import { Lilita_One, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const lilita = Lilita_One({
  variable: "--font-lilita",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DancingGrandma — put your grandma in the dance",
  description:
    "Upload a photo of grandma, pick a TikTok dance, and get a video of her nailing every move. Music included. Group chat not ready.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lilita.variable} ${schibsted.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

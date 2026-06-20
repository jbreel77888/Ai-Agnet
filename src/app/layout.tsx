import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Platform — Cloud Native AI Agents",
  description: "Production-ready cloud platform for AI agents inspired by Manus. Multi-provider LLM, dynamic tools, MCP integration, workflows, RAG, and full observability.",
  keywords: ["AI Agents", "LLM", "OpenAI", "Anthropic", "MCP", "Workflows", "Next.js", "Drizzle", "PostgreSQL"],
  authors: [{ name: "Platform Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Agent Platform",
    description: "Cloud-native AI Agent platform — production ready",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Platform",
    description: "Cloud-native AI Agent platform — production ready",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });
const ui = Work_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-ui" });

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't. A neighbourhood tool-lending board.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#f0a54a",
              colorPrimaryForeground: "#2a1806",
              colorBackground: "#ffffff",
              colorForeground: "#2a1806",
              colorInput: "#ffffff",
              colorInputForeground: "#2a1806",
              colorMutedForeground: "#6e5843",
              colorNeutral: "#2a1806",
              borderRadius: "12px",
            },
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

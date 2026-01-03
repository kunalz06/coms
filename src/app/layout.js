import { Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { StorageProvider } from "@/context/StorageContext";
import { UIProvider } from "@/context/UIContext";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata = {
  title: "Coms",
  description: "Advanced Agentic Coding Chat App",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={outfit.className}>
        <AuthProvider>
          <StorageProvider>
            <UIProvider>
              {children}
            </UIProvider>
          </StorageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

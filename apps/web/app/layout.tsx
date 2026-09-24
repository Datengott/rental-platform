import type { Metadata } from "next";
import Footer from "@/components/Footer";
import NavBar from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rental Platform — homes & offices for rent in Cameroon",
  description:
    "Browse verified homes and offices for rent in Douala, Yaoundé, Buea, Limbe and beyond. Express interest in one tap.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        {children}
        <Footer />
      </body>
    </html>
  );
}

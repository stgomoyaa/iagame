import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Oswald } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Las dos fuentes de las pantallas de progresión (ver el bloque `.pg` de
// globals.css). Oswald es la display condensada de los rangos y los banners
// de fin de partida; Inter es el cuerpo. Se cargan por `next/font` y no por
// un <link> a Google como el diseño original, para que no haya request
// bloqueante ni salto de layout al cambiar de fuente.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arcade FPS",
  description: "Shooter arcade en el navegador, sin instalar nada.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${oswald.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

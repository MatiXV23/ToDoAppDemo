import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { BASE_PATH } from "@/demo/base-path";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ToDoApp", template: "%s · ToDoApp" },
  description: "Demo interactiva de ToDoApp: tablero de tareas Scrum/Kanban con automatizaciones, GitHub e IA. Los datos son de ejemplo.",
  applicationName: "ToDoApp",
  // Ícono de iOS estático: los íconos generados por Next no llevan la ruta base de GitHub Pages.
  icons: { icon: { url: `${BASE_PATH}/icon.svg`, type: "image/svg+xml" }, apple: `${BASE_PATH}/apple-touch-icon.png` },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Questrial, Gruppo } from "next/font/google";
import "./globals.css";
const questrial = Questrial({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-questrial",
});
const gruppo = Gruppo({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-gruppo",
});
export const metadata: Metadata = {
  title: "GaussMark — Graphics observatory",
  description:
    "An open graphics laboratory for reproducible Gaussian rendering benchmarks.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${questrial.variable} ${gruppo.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('gaussmark.theme')||'dark'}catch{document.documentElement.dataset.theme='dark'}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

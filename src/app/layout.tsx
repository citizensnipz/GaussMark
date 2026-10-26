import type { Metadata } from "next";
import "./globals.css";
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
    <html lang="en" suppressHydrationWarning>
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

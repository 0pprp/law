import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pdfkit', 'arabic-persian-reshaper', 'bidi-js'],
  outputFileTracingIncludes: {
    '/api/admin/debtor-petition': [
      './fonts/NotoNaskhArabic-Regular.ttf',
      './public/fonts/NotoNaskhArabic-Regular.ttf',
    ],
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(self), payment=()',
        },
      ],
    },
  ],
};

export default nextConfig;

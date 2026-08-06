declare module 'arabic-persian-reshaper' {
  export const ArabicShaper: {
    convertArabic(text: string): string
  }
  export const PersianShaper: {
    convertArabic(text: string): string
  }
}

declare module 'bidi-js' {
  interface BidiApi {
    getEmbeddingLevels(text: string): unknown
    getReorderedString(text: string, embeddingLevels: unknown): string
  }
  export default function bidiFactory(): BidiApi
}
